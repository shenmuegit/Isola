import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, Pool } from 'pg';
import { buildApp } from '../src/app.ts';
import { installRelease } from '../src/install.ts';
import { startBackend } from '../src/backend.ts';
import { manifest, testDatabase } from './fixtures.ts';

const exec = promisify(execFile);
let database: Awaited<ReturnType<typeof testDatabase>>;
let directory: string;
let userId: string;
const owned: string[] = [];

before(async () => {
  process.env.BETTER_AUTH_SECRET = 'isola-test-only-secret-with-at-least-32-characters';
  database = await testDatabase();
  directory = await mkdtemp(join(tmpdir(), 'isola-recovery-'));
  const app = await buildApp({ db: database.db, dataDir: directory, origin: 'http://localhost:3000' });
  const response = await app.inject({ method: 'POST', url: '/api/auth/sign-up/email', headers: { origin: 'http://localhost:3000' }, payload: { name: 'Recovery', email: 'recovery@example.test', password: 'test-password-123' } });
  assert.equal(response.statusCode, 200, response.body);
  userId = response.json().user.id;
  await app.close();
  for (const [tag, args] of [
    ['isola-recovery-good', []],
    ['isola-recovery-bad', ['--build-arg', 'DESTRUCTIVE_STARTUP=1', '--build-arg', 'HEALTH_VERSION=wrong']],
    ['isola-recovery-mutating', ['--build-arg', 'DESTRUCTIVE_STARTUP=1']],
  ] as const) await exec('docker', ['build', '-t', tag, ...args, '-f', 'test/fixtures/backend/Dockerfile', '.']);
});

afterEach(async () => {
  if (database) {
    for (const row of (await database.db.query('SELECT id FROM releases')).rows) await exec('docker', ['rm', '-f', `isola-${row.id}`]).catch(() => {});
    for (const row of (await database.db.query('SELECT backend_database, backend_backup FROM plugins')).rows) {
      const name = row.backend_database;
      if (!name) continue;
      const network = `isola-${name}`;
      for (const container of [process.env.HOSTNAME!, process.env.POSTGRES_CONTAINER!]) await exec('docker', ['network', 'disconnect', '-f', network, container]).catch(() => {});
      for (const item of [network, `${network}-egress`]) await exec('docker', ['network', 'rm', item]).catch(() => {});
      for (const item of [name, row.backend_backup, ...owned]) if (item) await database.db.query(`DROP DATABASE IF EXISTS "${item}" WITH (FORCE)`);
      await database.db.query(`DROP ROLE "${name}"`);
    }
    await database.db.query('DELETE FROM installations; DELETE FROM releases; DELETE FROM plugins');
    owned.length = 0;
  }
});

after(async () => {
  await database?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function publish(name: string, version = '1.0.0', image = 'isola-recovery-good') {
  await database.db.query('INSERT INTO plugins (name, publisher_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [name, userId]);
  const id = randomUUID();
  const release = { id, entryUrl: `/plugins/${id}/dist/index.html`, manifest: { ...manifest, name, version, isola: { ...manifest.isola, apiVersion: 1 as const, entry: 'dist/index.html' as const, server: { image } } } };
  await database.db.query('INSERT INTO releases VALUES ($1, $2, $3, $4)', [release.id, name, version, release.manifest]);
  return release;
}
async function credentials(name: string) {
  return (await database.db.query('SELECT backend_database, backend_password, backend_backup FROM plugins WHERE name = $1', [name])).rows[0];
}
async function business(name: string) {
  const row = await credentials(name);
  const url = new URL(process.env.DATABASE_URL!);
  url.username = row.backend_database;
  url.password = row.backend_password;
  url.pathname = row.backend_database;
  return new Pool({ connectionString: url.toString() });
}
async function contents(name: string) {
  const pool = await business(name);
  try { return (await pool.query('SELECT * FROM public.notes ORDER BY user_id')).rows; }
  finally { await pool.end(); }
}
async function installed(name: string) {
  const release = await publish(name);
  await installRelease(database.db, userId, release.id);
  const pool = await business(name);
  try { await pool.query("INSERT INTO notes VALUES ('owner', 'original'), ('another-user', 'private')"); }
  finally { await pool.end(); }
  return release;
}
async function assertOriginal(name: string, releaseId: string) {
  assert.deepEqual(await contents(name), [{ user_id: 'another-user', body: 'private' }, { user_id: 'owner', body: 'original' }]);
  assert.equal((await database.db.query('SELECT release_id FROM installations WHERE user_id = $1 AND plugin_name = $2', [userId, name])).rows[0].release_id, releaseId);
  assert.equal((await credentials(name)).backend_backup, null);
  const state = JSON.parse((await exec('docker', ['inspect', `isola-${releaseId}`])).stdout)[0];
  assert.equal(state.State.Running, true);
}

async function restoreRetained(name: string) {
  const row = await credentials(name);
  assert.ok(row.backend_backup);
  await database.db.query(`DROP DATABASE IF EXISTS "${row.backend_database}" WITH (FORCE)`);
  const admin = await database.db.connect();
  await admin.query('BEGIN');
  try {
    await admin.query(`ALTER DATABASE "${row.backend_backup}" RENAME TO "${row.backend_database}"`);
    await admin.query(`ALTER DATABASE "${row.backend_database}" OWNER TO "${row.backend_database}"`);
    await admin.query(`ALTER DATABASE "${row.backend_database}" ALLOW_CONNECTIONS true`);
    await admin.query('UPDATE plugins SET backend_backup = NULL WHERE name = $1', [name]);
    await admin.query('COMMIT');
  } catch (error) { await admin.query('ROLLBACK'); throw error; }
  finally { admin.release(); }
}

test('destructive unhealthy startup restores native schema, users, settings and private ownership', async () => {
  const old = await installed('@recovery/destructive');
  const unrelated = await installed('@recovery/unrelated');
  const { backend_database: name } = await credentials(old.manifest.name);
  const pool = await business(old.manifest.name);
  try {
    await pool.query(`CREATE SEQUENCE retained_sequence START 41;
      CREATE FUNCTION restricted_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF current_user <> '${name}' THEN RAISE EXCEPTION 'plugin SQL executed as admin'; END IF;
        RETURN NEW; END $$;
      CREATE TRIGGER restricted_write BEFORE INSERT OR UPDATE ON notes FOR EACH ROW EXECUTE FUNCTION restricted_trigger()`);
    await pool.query("SELECT nextval('retained_sequence')");
  } finally { await pool.end(); }
  await database.db.query(`ALTER DATABASE "${name}" CONNECTION LIMIT 7`);
  await database.db.query(`ALTER DATABASE "${name}" SET search_path TO "odd,space", public`);
  await database.db.query(`ALTER DATABASE "${name}" SET isola.fixture TO 'value=one,two;''quoted'`);
  await database.db.query(`ALTER ROLE "${name}" IN DATABASE "${name}" SET statement_timeout TO '4s'`);
  const bad = await publish(old.manifest.name, '2.0.0', 'isola-recovery-bad');
  await assert.rejects(installRelease(database.db, userId, bad.id), /Backend health does not match its release/);
  await assertOriginal(old.manifest.name, old.id);
  await assertOriginal(unrelated.manifest.name, unrelated.id);
  await assert.rejects(exec('docker', ['inspect', `isola-${bad.id}`]));
  const restored = await business(old.manifest.name);
  try {
    assert.equal((await restored.query("SELECT nextval('retained_sequence') AS n")).rows[0].n, '42');
    assert.equal((await restored.query('SHOW search_path')).rows[0].search_path, '"odd,space", public');
    assert.equal((await restored.query('SHOW statement_timeout')).rows[0].statement_timeout, '4s');
    assert.equal((await restored.query('SHOW isola.fixture')).rows[0]['isola.fixture'], "value=one,two;'quoted");
    await restored.query("UPDATE notes SET body = body WHERE user_id = 'owner'");
    assert.equal((await restored.query("SELECT to_regclass('candidate_only') AS name")).rows[0].name, null);
  } finally { await restored.end(); }
  const metadata = (await database.db.query('SELECT datconnlimit, pg_get_userbyid(datdba) AS owner, has_database_privilege($2, oid, $3) AS foreign_access FROM pg_database WHERE datname = $1', [name, (await credentials(unrelated.manifest.name)).backend_database, 'CONNECT'])).rows[0];
  assert.deepEqual(metadata, { datconnlimit: 7, owner: name, foreign_access: false });
});

test('healthy destructive startup is restored when installation recording fails', async () => {
  const old = await installed('@recovery/recording');
  const candidate = await publish(old.manifest.name, '2.0.0', 'isola-recovery-mutating');
  await database.db.query(`CREATE FUNCTION reject_installation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.release_id = '${candidate.id}' THEN RAISE EXCEPTION 'recording fault'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_installation BEFORE INSERT OR UPDATE ON installations FOR EACH ROW EXECUTE FUNCTION reject_installation()`);
  try { await assert.rejects(installRelease(database.db, userId, candidate.id), /Plugin installation recording failed/); }
  finally { await database.db.query('DROP TRIGGER reject_installation ON installations; DROP FUNCTION reject_installation()'); }
  await assertOriginal(old.manifest.name, old.id);
  await assert.rejects(exec('docker', ['inspect', `isola-${candidate.id}`]));
});

test('backup preparation failure starts no candidate and restores the old service', async t => {
  const old = await installed('@recovery/preparation');
  const candidate = await publish(old.manifest.name, '2.0.0', 'isola-recovery-mutating');
  const query = Client.prototype.query;
  t.mock.method(Client.prototype, 'query', function (this: Client, sql: string, ...args: unknown[]) {
    if (typeof sql === 'string' && sql.startsWith('CREATE DATABASE isola_backup_')) sql = sql.replace(/TEMPLATE \S+/, 'TEMPLATE isola_missing_template');
    return Reflect.apply(query, this, [sql, ...args]);
  });
  try { await assert.rejects(installRelease(database.db, userId, candidate.id), /Plugin backend backup preparation failed/); }
  finally { t.mock.restoreAll(); }
  await assertOriginal(old.manifest.name, old.id);
  await assert.rejects(exec('docker', ['inspect', `isola-${candidate.id}`]));
});

for (const fault of ['rename', 'owner']) test(`native ${fault} failure retains a private recoverable copy and refuses empty reprovisioning`, async t => {
  const old = await installed(`@recovery/${fault}`);
  const candidate = await publish(old.manifest.name, '2.0.0', 'isola-recovery-bad');
  const query = Client.prototype.query;
  t.mock.method(Client.prototype, 'query', function (this: Client, sql: string, ...args: unknown[]) {
    if (typeof sql === 'string' && fault === 'rename' && /^ALTER DATABASE isola_backup_\w+ RENAME TO/.test(sql)) sql = sql.replace(/RENAME TO \S+/, 'RENAME TO postgres');
    if (typeof sql === 'string' && fault === 'owner' && /^ALTER DATABASE \S+ OWNER TO/.test(sql)) sql = sql.replace(/OWNER TO \S+/, 'OWNER TO isola_missing_owner');
    return Reflect.apply(query, this, [sql, ...args]);
  });
  try { await assert.rejects(installRelease(database.db, userId, candidate.id), /restoration failed; retained backup isola_backup_/); }
  finally { t.mock.restoreAll(); }
  const row = await credentials(old.manifest.name);
  assert.ok(row.backend_backup);
  owned.push(row.backend_backup);
  assert.equal((await database.db.query('SELECT 1 FROM pg_database WHERE datname = $1', [row.backend_database])).rowCount, 0);
  await assert.rejects(installRelease(database.db, userId, old.id), /recovery required; retained backup/);
  assert.equal((await database.db.query('SELECT 1 FROM pg_database WHERE datname = $1', [row.backend_database])).rowCount, 0);
  const meta = (await database.db.query('SELECT datallowconn, pg_get_userbyid(datdba) = CURRENT_USER AS admin_owned, has_database_privilege($2, oid, $3) AS plugin_access FROM pg_database WHERE datname = $1', [row.backend_backup, row.backend_database, 'CONNECT'])).rows[0];
  assert.deepEqual(meta, { datallowconn: false, admin_owned: true, plugin_access: false });
  const pluginUrl = new URL(process.env.DATABASE_URL!);
  pluginUrl.username = row.backend_database;
  pluginUrl.password = row.backend_password;
  pluginUrl.pathname = row.backend_backup;
  const backupLogin = new Pool({ connectionString: pluginUrl.toString() });
  try { await assert.rejects(backupLogin.query('SELECT 1'), /not currently accepting connections|permission denied/); }
  finally { await backupLogin.end(); }
  pluginUrl.pathname = (await database.db.query('SELECT current_database() AS name')).rows[0].name;
  const plugin = new Pool({ connectionString: pluginUrl.toString() });
  try {
    await assert.rejects(plugin.query(`ALTER DATABASE "${row.backend_backup}" ALLOW_CONNECTIONS true`), /must be owner/);
    await assert.rejects(plugin.query(`DROP DATABASE "${row.backend_backup}"`), /must be owner/);
    await assert.rejects(plugin.query(`CREATE DATABASE unauthorized_copy TEMPLATE "${row.backend_backup}"`), /permission denied/);
  } finally { await plugin.end(); }
  assert.equal(JSON.parse((await exec('docker', ['inspect', `isola-${old.id}`])).stdout)[0].State.Running, false);
  await assert.rejects(exec('docker', ['inspect', `isola-${candidate.id}`]));
  await restoreRetained(old.manifest.name);
  await startBackend(database.db, old);
  await assertOriginal(old.manifest.name, old.id);
});

test('candidate removal failure retains the backup and never restarts old service on damaged data', async () => {
  const old = await installed('@recovery/removal');
  const candidate = await publish(old.manifest.name, '2.0.0', 'isola-recovery-bad');
  const wrapper = await mkdtemp(join(tmpdir(), 'isola-docker-fault-'));
  await writeFile(join(wrapper, 'docker'), `#!/bin/sh\nif [ "$1" = rm ] && [ "$3" = isola-${candidate.id} ]; then exit 1; fi\nexec /usr/local/bin/docker "$@"\n`);
  await chmod(join(wrapper, 'docker'), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${wrapper}:${path}`;
  try { await assert.rejects(installRelease(database.db, userId, candidate.id), /Candidate backend removal failed; retained backup/); }
  finally { process.env.PATH = path; await rm(wrapper, { recursive: true, force: true }); }
  const row = await credentials(old.manifest.name);
  assert.ok(row.backend_backup);
  assert.equal(JSON.parse((await exec('docker', ['inspect', `isola-${old.id}`])).stdout)[0].State.Running, false);
  assert.equal(JSON.parse((await exec('docker', ['inspect', `isola-${candidate.id}`])).stdout)[0].State.Running, true);
  await assert.rejects(installRelease(database.db, userId, old.id), /recovery required/);
  await exec('docker', ['rm', '-f', `isola-${candidate.id}`]);
  await restoreRetained(old.manifest.name);
  await startBackend(database.db, old);
  await assertOriginal(old.manifest.name, old.id);
});

test('failed stop command restores a previously running backend even if Docker already stopped it', async () => {
  const old = await installed('@recovery/stop');
  const candidate = await publish(old.manifest.name, '2.0.0');
  const wrapper = await mkdtemp(join(tmpdir(), 'isola-stop-fault-'));
  await writeFile(join(wrapper, 'docker'), `#!/bin/sh\nif [ "$1" = stop ] && [ "$2" = isola-${old.id} ]; then /usr/local/bin/docker "$@"; exit 1; fi\nexec /usr/local/bin/docker "$@"\n`);
  await chmod(join(wrapper, 'docker'), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${wrapper}:${path}`;
  try { await assert.rejects(installRelease(database.db, userId, candidate.id), /Plugin backend stop before backup failed/); }
  finally { process.env.PATH = path; await rm(wrapper, { recursive: true, force: true }); }
  await assertOriginal(old.manifest.name, old.id);
  await assert.rejects(exec('docker', ['inspect', `isola-${candidate.id}`]));
});

test('obsolete backup cleanup failure preserves the committed installation and logs the retained copy', async t => {
  const old = await installed('@recovery/cleanup');
  const candidate = await publish(old.manifest.name, '2.0.0');
  const query = Client.prototype.query;
  let backup = '';
  const messages: string[] = [];
  t.mock.method(console, 'error', (message: string) => messages.push(message));
  t.mock.method(Client.prototype, 'query', function (this: Client, sql: string, ...args: unknown[]) {
    if (typeof sql === 'string' && sql.startsWith('DROP DATABASE isola_backup_')) {
      backup = sql.split(' ')[2]!;
      sql = 'SELECT 1 / 0';
    }
    return Reflect.apply(query, this, [sql, ...args]);
  });
  try { await installRelease(database.db, userId, candidate.id); }
  finally { t.mock.restoreAll(); }
  assert.ok(backup);
  owned.push(backup);
  await assertOriginal(old.manifest.name, candidate.id);
  assert.deepEqual(messages, [`Plugin backend obsolete backup cleanup failed; retained backup ${backup}`]);
  assert.equal((await database.db.query('SELECT datallowconn FROM pg_database WHERE datname = $1', [backup])).rows[0].datallowconn, false);
  await database.db.query(`DROP DATABASE "${backup}"`);
});

test('failed first destructive startup restores the empty database and healthy reuse takes no backup', async t => {
  const bad = await publish('@recovery/first', '1.0.0', 'isola-recovery-bad');
  await assert.rejects(installRelease(database.db, userId, bad.id), /health does not match/);
  const pool = await business(bad.manifest.name);
  try { assert.deepEqual((await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows, []); }
  finally { await pool.end(); }
  assert.equal((await credentials(bad.manifest.name)).backend_backup, null);
  assert.equal((await database.db.query('SELECT 1 FROM installations WHERE release_id = $1', [bad.id])).rowCount, 0);
  const query = Client.prototype.query;
  const copies: string[] = [];
  t.mock.method(Client.prototype, 'query', function (this: Client, sql: string, ...args: unknown[]) {
    if (typeof sql === 'string' && sql.startsWith('CREATE DATABASE isola_backup_')) copies.push(sql.split(' ')[2]!);
    return Reflect.apply(query, this, [sql, ...args]);
  });
  const good = await installed('@recovery/reuse');
  t.mock.restoreAll();
  assert.equal(copies.length, 1);
  assert.equal((await database.db.query('SELECT 1 FROM pg_database WHERE datname = ANY($1)', [copies])).rowCount, 0);
  const started = JSON.parse((await exec('docker', ['inspect', `isola-${good.id}`])).stdout)[0].State.StartedAt;
  t.mock.method(Client.prototype, 'query', function (this: Client, sql: string, ...args: unknown[]) {
    if (typeof sql === 'string' && sql.startsWith('CREATE DATABASE isola_backup_')) sql = 'SELECT 1 / 0';
    return Reflect.apply(query, this, [sql, ...args]);
  });
  try { await installRelease(database.db, userId, good.id); await startBackend(database.db, good); }
  finally { t.mock.restoreAll(); }
  assert.equal(JSON.parse((await exec('docker', ['inspect', `isola-${good.id}`])).stdout)[0].State.StartedAt, started);
  assert.equal((await credentials(good.manifest.name)).backend_backup, null);
});
