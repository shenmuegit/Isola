import Fastify from 'fastify';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

type Note = { id: string; title: string; body: string };

export async function buildApp({ db }: { db: Pool }) {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  if (process.env.ISOLA_PLUGIN_NAME && process.env.ISOLA_PLUGIN_NAME !== manifest.name ||
      process.env.ISOLA_PLUGIN_VERSION && process.env.ISOLA_PLUGIN_VERSION !== manifest.version) {
    throw new Error('Backend identity does not match the requested plugin release');
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(await readFile(new URL('./001-notes.sql', import.meta.url), 'utf8'));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }

  const app = Fastify({ ajv: { customOptions: { coerceTypes: false } } });
  const streams = new Map<string, Set<ServerResponse>>();
  app.addHook('preClose', async () => {
    for (const responses of streams.values()) for (const response of responses) response.end();
  });
  app.get('/health', async () => ({ name: manifest.name, version: manifest.version, apiVersion: manifest.isola.apiVersion }));
  await app.register(async business => {
    business.addHook('onRequest', async (request, reply) => {
      if (typeof request.headers['x-isola-user-id'] !== 'string' || !request.headers['x-isola-user-id']) {
        return reply.status(401).send({ message: 'User context is required' });
      }
    });
    const body = {
      type: 'object', required: ['title', 'body'], additionalProperties: false,
      properties: { title: { type: 'string', minLength: 1 }, body: { type: 'string' } },
    };
    function changed(userId: string, note: Note) {
      for (const response of streams.get(userId) ?? []) response.write(`data: ${JSON.stringify({ type: 'changed', note })}\n\n`);
    }
    business.get('/notes', async request => (await db.query<Note>(
      'SELECT id, title, body FROM notes WHERE user_id = $1 ORDER BY title, id', [request.headers['x-isola-user-id']],
    )).rows);
    business.post<{ Body: Omit<Note, 'id'> }>('/notes', { schema: { body } }, async (request, reply) => {
      const userId = request.headers['x-isola-user-id'] as string;
      const { rows: [note] } = await db.query<Note>(
        'INSERT INTO notes (id, user_id, title, body) VALUES ($1, $2, $3, $4) RETURNING id, title, body',
        [randomUUID(), userId, request.body.title, request.body.body],
      );
      changed(userId, note);
      return reply.status(201).send(note);
    });
    business.put<{ Params: { id: string }; Body: Omit<Note, 'id'> }>('/notes/:id', {
      schema: { body, params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } },
    }, async (request, reply) => {
      const userId = request.headers['x-isola-user-id'] as string;
      const { rows: [note] } = await db.query<Note>(
        'UPDATE notes SET title = $1, body = $2 WHERE id = $3 AND user_id = $4 RETURNING id, title, body',
        [request.body.title, request.body.body, request.params.id, userId],
      );
      if (!note) return reply.status(404).send({ message: 'Note not found' });
      changed(userId, note);
      return note;
    });
    business.get('/events', (request, reply) => {
      const userId = request.headers['x-isola-user-id'] as string;
      const responses = streams.get(userId) ?? new Set<ServerResponse>();
      streams.set(userId, responses);
      reply.hijack();
      reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      responses.add(reply.raw);
      reply.raw.on('close', () => {
        responses.delete(reply.raw);
        if (!responses.size) streams.delete(userId);
      });
      reply.raw.write('data: {"type":"ready"}\n\n');
    });
  });
  return app;
}

if (import.meta.main) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const app = await buildApp({ db });
    app.addHook('onClose', async () => { await db.end(); });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
    await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
  } catch (error) {
    await db.end();
    throw error;
  }
}
