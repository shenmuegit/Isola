import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { publishPackage } from '../src/market.ts';
import { archiveEntries, manifest, npmPackage, testDatabase } from './fixtures.ts';

let database: Awaited<ReturnType<typeof testDatabase>>;
let app: FastifyInstance;
let directory: string;
let dataDir: string;
let cookie: string;
let otherCookie: string;
let userId: string;
let valid: Buffer;
let entryUrl: string;
const origin = 'http://localhost:3000';

before(async () => {
  process.env.BETTER_AUTH_SECRET = 'isola-test-only-secret-with-at-least-32-characters';
  database = await testDatabase();
  directory = await mkdtemp(join(tmpdir(), 'isola-market-'));
  dataDir = join(directory, 'releases');
  await mkdir(dataDir);
  await writeFile(join(directory, 'marker'), '保留');
  app = await buildApp({ db: database.db, dataDir, origin });
  valid = await npmPackage();
});

after(async () => {
  await app?.close();
  await database?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

function publish(payload: Buffer, session = cookie) {
  return app.inject({ method: 'POST', url: '/api/market/releases', headers: { 'content-type': 'application/octet-stream', ...(session ? { cookie: session } : {}) }, payload });
}

test('native Better Auth signup and signin supply the session used for publishing', async () => {
  for (const [email, other] of [['publisher@example.test', false], ['other@example.test', true]] as const) {
    const response = await app.inject({ method: 'POST', url: '/api/auth/sign-up/email', headers: { origin }, payload: { email, password: 'test-password-123', name: 'Publisher' } });
    assert.equal(response.statusCode, 200, response.body);
    const headers = response.headers['set-cookie'];
    const value = (Array.isArray(headers) ? headers[0] : headers)!.split(';')[0]!;
    if (other) otherCookie = value;
    else { cookie = value; userId = response.json().user.id; }
  }
  const login = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', headers: { origin }, payload: { email: 'publisher@example.test', password: 'test-password-123' } });
  assert.equal(login.statusCode, 200, login.body);
  const session = await app.inject({ method: 'GET', url: '/api/auth/get-session', headers: { cookie } });
  assert.equal(session.json().user.id, userId);
});

test('publishing requires a native session and ignores client userId', async () => {
  assert.equal((await publish(valid, '')).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: `/api/market/releases?userId=${userId}`, headers: { 'content-type': 'application/octet-stream', 'x-user-id': userId }, payload: valid })).statusCode, 401);
});

test('a real npm package publishes readable sandbox HTML and CORS-enabled modules', async () => {
  const response = await publish(valid);
  assert.equal(response.statusCode, 201, response.body);
  const release = response.json();
  assert.match(release.id, /^[0-9a-f-]{36}$/);
  assert.equal(release.manifest.name, '@isola-test/notes');
  entryUrl = release.entryUrl;
  const html = await app.inject({ url: entryUrl });
  assert.equal(html.statusCode, 200);
  assert.match(html.body, /<h1>Notes<\/h1>/);
  assert.match(html.headers['content-security-policy']!, /sandbox allow-scripts allow-forms/);
  assert.equal(html.headers['access-control-allow-origin'], '*');
  const module = await app.inject({ url: entryUrl.replace('index.html', 'main.js'), headers: { origin: 'null' } });
  assert.equal(module.statusCode, 200);
  assert.match(module.headers['content-type']!, /javascript/);
  assert.equal(module.headers['access-control-allow-origin'], '*');
  assert.equal(module.headers['content-security-policy'], 'sandbox allow-scripts allow-forms');
  const styles = await app.inject({ url: entryUrl.replace('index.html', 'style.css') });
  assert.equal(styles.statusCode, 200);
  assert.match(styles.headers['content-type']!, /css/);
  assert.equal(styles.headers['content-security-policy'], 'sandbox allow-scripts allow-forms');
  const listed = await app.inject({ url: '/api/market/releases', headers: { origin: 'null' } });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.headers['access-control-allow-origin'], undefined);
  assert.equal(listed.headers['content-security-policy'], undefined);
  assert.ok(listed.json().some((item: { id: string }) => item.id === release.id));
});

for (const [asset, contentType] of [['', 'text/html'], ['nested/', 'text/html'], ['image.svg', 'image/svg+xml']] as const) {
  test(`published asset ${asset || 'directory index'} keeps the sandbox after native resource resolution`, async () => {
    const response = await app.inject({ url: entryUrl.replace('index.html', asset), headers: { origin: 'null' } });
    assert.equal(response.statusCode, 200, response.body);
    assert.ok(response.headers['content-type']?.startsWith(contentType));
    assert.equal(response.headers['content-security-policy'], 'sandbox allow-scripts allow-forms');
    assert.equal(response.headers['access-control-allow-origin'], '*');
  });
}

test('duplicate releases return 409 and only the original publisher can release a new version', async () => {
  assert.equal((await publish(valid)).statusCode, 409);
  const next = await npmPackage({ ...manifest, version: '1.0.1' });
  assert.equal((await publish(next, otherCookie)).statusCode, 403);
  assert.equal((await publish(next)).statusCode, 201);
  assert.equal((await app.inject({ url: entryUrl })).statusCode, 200);
});

test('manifest checks reject wrong API, coercion, missing/unknown fields and missing entry', async () => {
  for (const isola of [
    { ...manifest.isola, apiVersion: 2 },
    { ...manifest.isola, apiVersion: '1' },
    { ...manifest.isola, extra: true },
    { ...manifest.isola, entry: '../marker' },
    { title: 'Notes', apiVersion: 1 },
  ]) {
    const response = await publish(await npmPackage({ ...manifest, isola }));
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.equal((await publish(await npmPackage(manifest, false))).statusCode, 400);
});

test('node-tar rejects traversal, absolute paths, links and malformed packages, preserving outside files', async () => {
  const existing = await readdir(dataDir);
  for (const entry of [
    { path: '../../marker', body: '覆盖' },
    { path: '/marker', body: '覆盖' },
    { path: 'package/dist/link', type: 'SymbolicLink' as const, linkpath: '../../../marker' },
    { path: 'package/dist/link', type: 'Link' as const, linkpath: '../../../marker' },
  ]) {
    const archive = archiveEntries([{ path: 'package/package.json', body: JSON.stringify(manifest) }, { path: 'package/dist/index.html', body: 'Valid' }, entry]);
    const rejected = await publish(archive);
    assert.equal(rejected.statusCode, 400, `${entry.path}: ${rejected.body}`);
    assert.equal(await readFile(join(directory, 'marker'), 'utf8'), '保留');
  }
  assert.equal((await publish(Buffer.from('not a tar archive'))).statusCode, 400);
  assert.deepEqual(await readdir(dataDir), existing);
  assert.equal((await database.db.query('SELECT count(*) FROM releases')).rows[0].count, '2');
});

test('invalid npm names, versions and non-file manifests return 400 without reserving the plugin', async () => {
  const existing = await readdir(dataDir);
  for (const entry of [
    { path: 'package/package.json', type: 'Directory' as const },
    { path: 'package/package.json', body: '{broken' },
    { path: 'package/package.json', body: JSON.stringify({ ...manifest, name: '../notes' }) },
    { path: 'package/package.json', body: JSON.stringify({ ...manifest, version: 'next' }) },
  ]) {
    const response = await publish(archiveEntries([entry, { path: 'package/dist/index.html', body: 'Entry' }]));
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.deepEqual(await readdir(dataDir), existing);
  assert.equal((await database.db.query('SELECT count(*) FROM plugins')).rows[0].count, '1');
});

test('standalone publishPackage shares the manifest and ownership contract', async () => {
  const release = await publishPackage(database.db, dataDir, userId, Readable.from(await npmPackage({ ...manifest, name: '@isola-test/direct' })));
  assert.equal((await app.inject({ url: release.entryUrl })).statusCode, 200);
  await assert.rejects(publishPackage(database.db, dataDir, userId, Readable.from(await npmPackage({ ...manifest, name: '@isola-test/direct', isola: { ...manifest.isola, apiVersion: 2 } }))), { statusCode: 400 });
});

test('concurrent duplicate publication keeps one record and one release directory', async () => {
  const archive = await npmPackage({ ...manifest, name: '@isola-test/concurrent' });
  const responses = await Promise.all([publish(archive), publish(archive)]);
  assert.deepEqual(responses.map(item => item.statusCode).sort(), [201, 409]);
  const rows = await database.db.query('SELECT id FROM releases WHERE plugin_name = $1', ['@isola-test/concurrent']);
  assert.equal(rows.rowCount, 1);
  assert.equal((await readdir(dataDir)).length, 4);
});
