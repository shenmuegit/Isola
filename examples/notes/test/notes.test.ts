import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server/index.ts';

const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgresql://isola_test@127.0.0.1:55432/postgres');
const admin = new Pool({ connectionString: url.toString() });
const name = `isola_notes_${randomUUID().replaceAll('-', '')}`;
let db: Pool;
let app: FastifyInstance;
let origin: string;
const owner = { 'x-isola-user-id': 'user-a' };
const other = { 'x-isola-user-id': 'user-b' };

before(async () => {
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  db = new Pool({ connectionString: url.toString() });
  app = await buildApp({ db });
  origin = await app.listen({ host: '127.0.0.1', port: 0 });
});

after(async () => {
  app?.server.closeAllConnections();
  await app?.close();
  await db?.end();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
});

test('create, update and reopening the backend preserve note contents in PostgreSQL', async () => {
  const created = await app.inject({ method: 'POST', url: '/notes', headers: owner, payload: { title: '初稿', body: '' } });
  assert.equal(created.statusCode, 201, created.body);
  const note = created.json();
  assert.match(note.id, /^[0-9a-f-]{36}$/);
  const updated = await app.inject({ method: 'PUT', url: `/notes/${note.id}`, headers: owner, payload: { title: '示例笔记', body: '示例内容' } });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.deepEqual(updated.json(), { id: note.id, title: '示例笔记', body: '示例内容' });
  app.server.closeAllConnections();
  await app.close();
  app = await buildApp({ db });
  origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const response = await app.inject({ url: '/notes', headers: owner });
  assert.equal(response.statusCode, 200, response.body);
  const [reopened] = response.json();
  assert.equal(reopened.body, '示例内容');
  assert.equal(reopened.title, '示例笔记');
});

test('another user cannot read or update the owner note', async () => {
  const created = await app.inject({ method: 'POST', url: '/notes', headers: owner, payload: { title: 'Private A', body: '示例内容' } });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id;
  const response = await app.inject({ url: '/notes', headers: other });
  assert.equal(response.statusCode, 200, response.body);
  const otherUserNotes = response.json();
  assert.deepEqual(otherUserNotes, []);
  const update = await app.inject({ method: 'PUT', url: `/notes/${id}`, headers: other, payload: { title: 'changed', body: 'changed' } });
  assert.equal(update.statusCode, 404, update.body);
  assert.equal((await app.inject({ url: '/notes', headers: owner })).json().find((note: { id: string }) => note.id === id).body, '示例内容');
});

test('business routes require trusted user context and validate note fields and ids', async () => {
  for (const request of [{ method: 'GET' as const, url: '/notes' }, { method: 'GET' as const, url: '/events' }, { method: 'POST' as const, url: '/notes', payload: { title: 'test', body: '' } }]) {
    assert.equal((await app.inject(request)).statusCode, 401);
  }
  for (const payload of [{ title: 'missing body' }, { title: 1, body: '' }, { title: '', body: '' }, { title: 'valid', body: false }]) {
    assert.equal((await app.inject({ method: 'POST', url: '/notes', headers: owner, payload })).statusCode, 400);
  }
  assert.equal((await app.inject({ method: 'PUT', url: '/notes/invalid', headers: owner, payload: { title: 'test', body: '' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PUT', url: `/notes/${randomUUID()}`, headers: owner, payload: { title: 'test', body: '' } })).statusCode, 404);
});

test('SSE sends ready and same-user changes without disclosing other-user writes', async () => {
  const controller = new AbortController();
  const eventResponse = await fetch(`${origin}/events`, { headers: owner, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
  try {
    assert.equal(eventResponse.status, 200);
    assert.equal(eventResponse.headers.get('content-type')!.startsWith('text/event-stream'), true);
    const reader = eventResponse.body!.getReader();
    let buffered = '';
    async function event() {
      while (!buffered.includes('\n\n')) {
        const result = await reader.read();
        assert.equal(result.done, false);
        buffered += new TextDecoder().decode(result.value);
      }
      const end = buffered.indexOf('\n\n');
      const frame = buffered.slice(0, end);
      buffered = buffered.slice(end + 2);
      return JSON.parse(frame.slice('data: '.length));
    }
    const firstEvent = await event();
    assert.equal(firstEvent.type, 'ready');
    await app.inject({ method: 'POST', url: '/notes', headers: other, payload: { title: 'Private B', body: 'secret' } });
    const created = await app.inject({ method: 'POST', url: '/notes', headers: owner, payload: { title: 'Live A', body: 'live' } });
    assert.equal(created.statusCode, 201, created.body);
    assert.deepEqual(await event(), { type: 'changed', note: created.json() });
    const updated = await app.inject({ method: 'PUT', url: `/notes/${created.json().id}`, headers: owner, payload: { title: 'Live A', body: 'updated' } });
    assert.deepEqual(await event(), { type: 'changed', note: updated.json() });
  } finally { controller.abort(); }
});

test('health reports the bundled release identity after initialization', async () => {
  const health = await app.inject('/health');
  assert.equal(health.statusCode, 200, health.body);
  assert.deepEqual(health.json(), { name: '@isola/example-notes', version: '0.1.0', apiVersion: 1 });
  assert.equal((await db.query("SELECT to_regclass('notes') AS name")).rows[0].name, 'notes');
});

test('a mismatched image is rejected before it can initialize business SQL', async () => {
  const previous = process.env.ISOLA_PLUGIN_VERSION;
  process.env.ISOLA_PLUGIN_VERSION = 'wrong-image-version';
  const emptyName = `isola_notes_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${emptyName}"`);
  const emptyUrl = new URL(url);
  emptyUrl.pathname = `/${emptyName}`;
  const emptyDb = new Pool({ connectionString: emptyUrl.toString() });
  try {
    await assert.rejects(buildApp({ db: emptyDb }), /identity/);
    assert.equal((await emptyDb.query("SELECT to_regclass('notes') AS name")).rows[0].name, null);
  } finally {
    if (previous === undefined) delete process.env.ISOLA_PLUGIN_VERSION;
    else process.env.ISOLA_PLUGIN_VERSION = previous;
    await emptyDb.end();
    await admin.query(`DROP DATABASE "${emptyName}" WITH (FORCE)`);
  }
});
