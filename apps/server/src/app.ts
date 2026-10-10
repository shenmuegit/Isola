import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fromNodeHeaders } from 'better-auth/node';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Pool } from 'pg';
import { createAuth, registerAuth } from './auth.ts';
import { publishPackage, releaseEntryUrl, type PublishedRelease } from './market.ts';

export async function buildApp({ db, dataDir, origin }: { db: Pool; dataDir: string; origin: string }) {
  const app = Fastify();
  const auth = await createAuth(db, origin);
  await db.query(await readFile(new URL('../sql/001-framework.sql', import.meta.url), 'utf8'));
  registerAuth(app, auth, origin);
  await app.register(async market => {
    market.removeAllContentTypeParsers();
    market.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload));
    market.post('/api/market/releases', async (request, reply) => {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
      if (!session) return reply.status(401).send({ message: 'Unauthorized' });
      const release = await publishPackage(db, dataDir, session.user.id, request.body as import('node:stream').Readable);
      return reply.status(201).send(release);
    });
  });
  app.get('/api/market/releases', async () => {
    const result = await db.query<Pick<PublishedRelease, 'id' | 'manifest'>>('SELECT id, manifest FROM releases ORDER BY plugin_name, version');
    return result.rows.map(release => ({ ...release, entryUrl: releaseEntryUrl(release.id) }));
  });
  await app.register(fastifyStatic, { root: resolve(dataDir), serve: false });
  app.get<{ Params: { releaseId: string; '*': string } }>('/plugins/:releaseId/*', {
    schema: { params: { type: 'object', properties: { releaseId: { type: 'string', format: 'uuid' }, '*': { type: 'string' } }, required: ['releaseId', '*'] } },
  }, async (request, reply) => {
    const { releaseId, '*': asset } = request.params;
    if (!asset.startsWith('dist/')) return reply.status(404).send({ message: 'Not found' });
    const result = await db.query('SELECT id FROM releases WHERE id = $1', [releaseId]);
    if (!result.rowCount) return reply.status(404).send({ message: 'Not found' });
    reply.header('access-control-allow-origin', '*');
    if (/\.html?$/i.test(asset)) reply.header('content-security-policy', 'sandbox allow-scripts');
    return reply.sendFile(asset.slice(5), join(resolve(dataDir), releaseId, 'package/dist'));
  });
  return app;
}
