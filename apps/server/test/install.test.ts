import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { manifest, npmPackage, testDatabase } from './fixtures.ts';

const exec = promisify(execFile);
let database: Awaited<ReturnType<typeof testDatabase>>;
let app: FastifyInstance;
let directory: string;
let cookie: string;
let otherCookie: string;
let userId: string;
let otherUserId: string;
let origin: string;
let release: { id: string };
let second: { id: string };
let plain: { id: string };
let failed: { id: string };
let upgrade: { id: string };
let mismatch: { id: string };
let unready: { id: string };
let startFailure: { id: string };
let next: { id: string };
let coreRoutes: string;
const signupOrigin = 'http://localhost:3000';

before(async () => {
  process.env.BETTER_AUTH_SECRET = 'isola-test-only-secret-with-at-least-32-characters';
  database = await testDatabase();
  coreRoutes = await (await import('node:fs/promises')).readFile('/proc/net/route', 'utf8');
  directory = await mkdtemp(join(tmpdir(), 'isola-install-'));
  app = await buildApp({ db: database.db, dataDir: directory, origin: signupOrigin });
  origin = await app.listen({ host: '0.0.0.0', port: 0 });
  origin = origin.replace('0.0.0.0', '127.0.0.1');
  for (const other of [false, true]) {
    const response = await app.inject({ method: 'POST', url: '/api/auth/sign-up/email', headers: { origin: signupOrigin }, payload: { name: 'Installer', email: `${other ? 'other' : 'owner'}@example.test`, password: 'test-password-123' } });
    assert.equal(response.statusCode, 200, response.body);
    const headers = response.headers['set-cookie'];
    const value = (Array.isArray(headers) ? headers[0] : headers)!.split(';')[0]!;
    if (other) { otherCookie = value; otherUserId = response.json().user.id; }
    else { cookie = value; userId = response.json().user.id; }
  }
  await exec('docker', ['build', '-t', 'isola-test-backend', '-f', 'test/fixtures/backend/Dockerfile', '.']);
  await exec('docker', ['build', '-t', 'isola-test-unhealthy', '--build-arg', 'HEALTH_VERSION=wrong', '--build-arg', 'DESTRUCTIVE_STARTUP=1', '-f', 'test/fixtures/backend/Dockerfile', '.']);
  await exec('docker', ['build', '-t', 'isola-test-unready', '--build-arg', 'HEALTH_VERSION=unready', '-f', 'test/fixtures/backend/Dockerfile', '.']);
  const publish = async (name: string, version: string, image?: string) => {
    const response = await app.inject({ method: 'POST', url: '/api/market/releases', headers: { cookie, 'content-type': 'application/octet-stream' }, payload: await npmPackage({ ...manifest, name, version, isola: { ...manifest.isola, ...(image ? { server: { image } } : {}) } }) });
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  };
  release = await publish('@isola-test/install', '1.0.0', 'isola-test-backend');
  second = await publish('@isola-test/second', '1.0.0', 'isola-test-backend');
  plain = await publish('@isola-test/plain', '1.0.0');
  failed = await publish('@isola-test/failure', '1.0.0', 'invalid.invalid/missing:image');
  upgrade = await publish('@isola-test/install', '2.0.0', 'invalid.invalid/missing:image');
  mismatch = await publish('@isola-test/install', '3.0.0', 'isola-test-unhealthy');
  unready = await publish('@isola-test/unready', '1.0.0', 'isola-test-unready');
  startFailure = await publish('@isola-test/start-failure', '1.0.0', 'isola-test-backend');
  next = await publish('@isola-test/install', '1.0.1', 'isola-test-backend');
});

after(async () => {
  app?.server.closeAllConnections();
  await app?.close();
  if (database) {
    const names = await database.db.query('SELECT backend_database FROM plugins WHERE backend_database IS NOT NULL').catch(() => ({ rows: [] }));
    for (const row of (await database.db.query('SELECT id FROM releases')).rows) {
      await exec('docker', ['rm', '-f', `isola-${row.id}`]).catch(() => {});
    }
    for (const { backend_database: name } of names.rows) {
      const network = `isola-${name}`;
      await exec('docker', ['network', 'disconnect', '-f', network, process.env.HOSTNAME!]).catch(() => {});
      await exec('docker', ['network', 'disconnect', '-f', network, process.env.POSTGRES_CONTAINER!]).catch(() => {});
      await exec('docker', ['network', 'rm', network]).catch(() => {});
      await exec('docker', ['network', 'rm', `${network}-egress`]).catch(() => {});
      await database.db.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      await database.db.query(`DROP ROLE "${name}"`);
    }
    await database.close();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

function install(id: string, session = cookie) {
  return app.inject({ method: 'POST', url: '/api/installations', headers: { cookie: session }, payload: { releaseId: id } });
}
function call(id: string, path: string, session = cookie) {
  return fetch(`${origin}/api/plugins/${id}/api${path}`, { headers: { cookie: session } });
}

test('native session is required and a frontend-only duplicate install has one row', async () => {
  assert.equal((await install(plain.id, '')).statusCode, 401);
  const responses = await Promise.all([install(plain.id), install(plain.id)]);
  for (const response of responses) assert.equal(response.statusCode, 201, response.body);
  assert.equal((await database.db.query('SELECT * FROM installations WHERE release_id = $1', [plain.id])).rowCount, 1);
  assert.equal((await app.inject({ url: '/api/installations', headers: { cookie: otherCookie } })).json().length, 0);
});

test('real backend concurrent installation reuses one healthy container and unique installation', async () => {
  for (const response of await Promise.all([install(release.id), install(release.id)])) assert.equal(response.statusCode, 201, response.body);
  assert.equal((await database.db.query('SELECT * FROM installations WHERE release_id = $1', [release.id])).rowCount, 1);
  const listed = await app.inject({ url: '/api/installations', headers: { cookie } });
  assert.ok(listed.json().some((item: { id: string }) => item.id === release.id));
  const container = JSON.parse((await exec('docker', ['inspect', `isola-${release.id}`])).stdout)[0];
  assert.equal(container.State.Running, true);
  assert.equal(Object.keys(container.NetworkSettings.Networks).length, 2);
  const routes = await (await import('node:fs/promises')).readFile('/proc/net/route', 'utf8');
  const gateway = (text: string) => text.split('\n').find(line => line.split(/\s+/)[1] === '00000000');
  assert.equal(gateway(routes), gateway(coreRoutes));
  assert.deepEqual(container.HostConfig.PortBindings, {});
  assert.equal(container.Mounts.length, 0);
});

test('failed first backend startup returns 502 and records no installation', async () => {
  const response = await install(failed.id);
  assert.equal(response.statusCode, 502, response.body);
  assert.deepEqual(response.json(), { statusCode: 502, error: 'Bad Gateway', message: 'Plugin backend container creation failed' });
  assert.equal((await database.db.query('SELECT * FROM installations WHERE release_id = $1', [failed.id])).rowCount, 0);
});

test('plugin backend can call a controlled HTTP endpoint outside its own network', async () => {
  assert.equal((await install(release.id)).statusCode, 201);
  const endpoint = (await exec('docker', ['run', '--rm', '-d', '--network', 'host', 'node:24-bookworm-slim', 'node', '-e',
    'const server = require("node:http").createServer((req, res) => res.end("controlled egress")); server.listen(0, "0.0.0.0", () => console.log(server.address().port));',
  ])).stdout.trim();
  try {
    const bridge = JSON.parse((await exec('docker', ['network', 'inspect', 'bridge'])).stdout)[0];
    let port = '';
    for (let attempt = 0; attempt < 100 && !port; attempt++) {
      port = (await exec('docker', ['logs', endpoint])).stdout.trim();
      if (!port) await setTimeout(50);
    }
    assert.match(port, /^\d+$/);
    const url = `http://${bridge.IPAM.Config[0].Gateway}:${port}`;
    const result = await exec('docker', ['exec', `isola-${release.id}`, 'node', '-e',
      'fetch(process.argv[1], { signal: AbortSignal.timeout(2000) }).then(response => response.text()).then(console.log)', url,
    ]);
    assert.equal(result.stdout.trim(), 'controlled egress');
  } finally { await exec('docker', ['rm', '-f', endpoint]); }
});

test('failed upgrade preserves the working release and its actual PostgreSQL business data', async () => {
  assert.equal((await install(release.id)).statusCode, 201);
  const saved = await fetch(`${origin}/api/plugins/${release.id}/api/notes`, { method: 'POST', headers: { cookie, 'content-type': 'text/plain' }, body: 'preserve my note' });
  assert.equal(saved.status, 200);
  const before = await saved.json();
  assert.equal((await install(upgrade.id)).statusCode, 502);
  assert.equal((await database.db.query('SELECT release_id FROM installations WHERE user_id = $1 AND plugin_name = $2', [userId, '@isola-test/install'])).rows[0].release_id, release.id);
  assert.deepEqual(await (await call(release.id, '/notes')).json(), before);
});

test('uninstalled and forged plugin identity cannot invoke another release', async () => {
  assert.equal((await call(release.id, '/notes', otherCookie)).status, 403);
  assert.equal((await call(second.id, '/notes')).status, 403);
  assert.equal((await call(upgrade.id, '/notes')).status, 403);
});

test('mismatched health fails installation and removes only the new container', async () => {
  const response = await install(mismatch.id);
  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.json(), { statusCode: 502, error: 'Bad Gateway', message: 'Backend health does not match its release' });
  assert.equal((await database.db.query('SELECT * FROM installations WHERE release_id = $1', [mismatch.id])).rowCount, 0);
  await assert.rejects(exec('docker', ['inspect', `isola-${mismatch.id}`]));
  assert.equal((await database.db.query('SELECT release_id FROM installations WHERE user_id = $1 AND plugin_name = $2', [userId, '@isola-test/install'])).rows[0].release_id, release.id);
  assert.deepEqual(await (await call(release.id, '/notes')).json(), [{ body: 'preserve my note' }]);
});

test('proxy uses native session identity, never forwards cookies, and preserves exact request bytes', async () => {
  assert.equal((await install(release.id, otherCookie)).statusCode, 201);
  for (const [contentType, body] of [['application/json', Buffer.from('{ "a" : 1 }')], ['application/octet-stream', Buffer.from([0, 255, 13, 10, 128])]] as const) {
    const response = await fetch(`${origin}/api/plugins/${release.id}/api/echo?target=elsewhere`, { method: 'POST', headers: { cookie, 'content-type': contentType, 'x-isola-user-id': otherUserId, authorization: 'Bearer host-secret' }, body });
    assert.equal(response.status, 200);
    const echo = await response.json();
    assert.equal(echo.user, userId);
    assert.equal(echo.body, body.toString('base64'));
    assert.equal(echo.headers.cookie, undefined);
    assert.equal(echo.headers.authorization, undefined);
    assert.equal(echo.path, '/echo?target=elsewhere');
  }
  assert.deepEqual(await (await call(release.id, '/notes', otherCookie)).json(), []);
  const document = await call(release.id, '/document');
  assert.equal(document.status, 200);
  assert.equal(document.headers.get('set-cookie'), null);
  assert.equal(document.headers.get('content-security-policy'), 'sandbox allow-scripts');
  assert.match(await document.text(), /<script>/);
  assert.equal((await call(release.id, '/empty')).status, 204);
});

test('unready backend reports readiness failure without recording an installation', async () => {
  const response = await install(unready.id);
  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.json(), { statusCode: 502, error: 'Bad Gateway', message: 'Backend did not become healthy' });
  assert.equal((await database.db.query('SELECT * FROM installations WHERE release_id = $1', [unready.id])).rowCount, 0);
  await assert.rejects(exec('docker', ['inspect', `isola-${unready.id}`]));
});

test('container start failure returns a safe operation reason without an installation', async () => {
  await exec('docker', ['create', '--name', `isola-${startFailure.id}`, '--entrypoint', '/isola-test-missing-executable', 'isola-test-backend']);
  const response = await install(startFailure.id);
  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.json(), { statusCode: 502, error: 'Bad Gateway', message: 'Plugin backend container start failed' });
  assert.equal((await database.db.query('SELECT * FROM installations WHERE release_id = $1', [startFailure.id])).rowCount, 0);
});

test('fixed upstream origin survives double-slash paths and upstream redirects', async () => {
  const response = await call(release.id, '//outside.invalid/echo');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).path, '//outside.invalid/echo');
  assert.equal((await call(release.id, '/redirect')).status, 502);
});

test('each plugin has a separate database role and Docker network', async () => {
  assert.equal((await install(second.id)).statusCode, 201);
  const inspect = async (id: string) => JSON.parse((await exec('docker', ['inspect', `isola-${id}`])).stdout)[0];
  const a = await inspect(release.id);
  const b = await inspect(second.id);
  assert.notDeepEqual(Object.keys(a.NetworkSettings.Networks), Object.keys(b.NetworkSettings.Networks));
  const internal = Object.keys(a.NetworkSettings.Networks).find(name => !name.endsWith('-egress'))!;
  const network = JSON.parse((await exec('docker', ['network', 'inspect', internal])).stdout)[0];
  assert.equal(network.Internal, true);
  assert.equal(Object.keys(network.Containers).length, 3);
  const egress = JSON.parse((await exec('docker', ['network', 'inspect', `${internal}-egress`])).stdout)[0];
  assert.equal(egress.Internal, false);
  assert.equal(Object.keys(egress.Containers).length, 1);
  const url = new URL(a.Config.Env.find((value: string) => value.startsWith('DATABASE_URL=')).slice(13));
  const bUrl = new URL(b.Config.Env.find((value: string) => value.startsWith('DATABASE_URL=')).slice(13));
  assert.ok(!a.Config.Env.some((value: string) => /^(PGPASSWORD|POSTGRES_PASSWORD)=/.test(value)));
  const proof = await exec('docker', ['exec', `isola-${release.id}`, 'node', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { Pool } from 'pg';
    const own = new Pool({ connectionString: process.env.DATABASE_URL });
    try { await own.query('SELECT * FROM notes'); } finally { await own.end(); }
    const url = new URL(process.env.DATABASE_URL);
    for (const target of [process.argv[1], process.argv[2]]) {
      url.pathname = target;
      const foreign = new Pool({ connectionString: url.toString() });
      try { await assert.rejects(foreign.query('SELECT * FROM plugins'), /permission denied/); }
      finally { await foreign.end(); }
    }
    url.username = 'isola'; url.password = 'isola'; url.pathname = '/postgres';
    const publicLogin = new Pool({ connectionString: url.toString() });
    try { await assert.rejects(publicLogin.query('SELECT 1'), /password authentication failed/); }
    finally { await publicLogin.end(); }
    console.log('Plugin network: own role works; foreign/framework/public-admin access denied');
  `, bUrl.pathname, `/${(await database.db.query('SELECT current_database() AS name')).rows[0].name}`]);
  assert.match(proof.stdout, /own role works; foreign\/framework\/public-admin access denied/);
  const plugin = new Pool({ connectionString: url.toString() });
  try {
    assert.equal((await plugin.query('SELECT body FROM notes WHERE user_id = $1', [userId])).rows[0].body, 'preserve my note');
    const role = (await plugin.query('SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user')).rows[0];
    assert.deepEqual(role, { rolsuper: false, rolcreatedb: false, rolcreaterole: false });
  } finally { await plugin.end(); }
  url.pathname = bUrl.pathname;
  const foreign = new Pool({ connectionString: url.toString() });
  try { await assert.rejects(foreign.query('SELECT * FROM notes'), /permission denied for database/); } finally { await foreign.end(); }
  url.pathname = `/${(await database.db.query('SELECT current_database() AS name')).rows[0].name}`;
  const framework = new Pool({ connectionString: url.toString() });
  try { await assert.rejects(framework.query('SELECT backend_password FROM plugins'), /permission denied for table plugins/); } finally { await framework.end(); }
});

test('SSE uses real HTTP streaming and upstream closes on client abort', async () => {
  const controller = new AbortController();
  const response = await fetch(`${origin}/api/plugins/${release.id}/api/events`, { headers: { cookie }, signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /text\/event-stream/);
  const reader = response.body!.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /"ready":true/);
  controller.abort();
  await reader.cancel().catch(() => {});
  let active = 1;
  for (let attempt = 0; attempt < 30 && active; attempt++) {
    active = (await (await call(release.id, '/streams')).json()).streams;
    if (active) await setTimeout(50);
  }
  assert.equal(active, 0);
});

test('successful upgrade keeps the database and old version available to its other installed user', async () => {
  const before = await database.db.query('SELECT backend_database FROM plugins WHERE name = $1', ['@isola-test/install']);
  const response = await install(next.id);
  assert.equal(response.statusCode, 201, response.body);
  assert.deepEqual((await database.db.query('SELECT backend_database FROM plugins WHERE name = $1', ['@isola-test/install'])).rows, before.rows);
  assert.deepEqual(await (await call(next.id, '/notes')).json(), [{ body: 'preserve my note' }]);
  assert.equal((await call(release.id, '/notes')).status, 403);
  assert.equal((await call(release.id, '/notes', otherCookie)).status, 200);
  assert.equal((await call(next.id, '/notes', otherCookie)).status, 403);
  const networks = async (id: string) => Object.keys(JSON.parse((await exec('docker', ['inspect', `isola-${id}`])).stdout)[0].NetworkSettings.Networks).sort();
  assert.deepEqual(await networks(next.id), await networks(release.id));
});
