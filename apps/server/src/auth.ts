import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

export async function createAuth(db: Pool, origin: string) {
  const options = { database: db, baseURL: origin, emailAndPassword: { enabled: true } };
  const { runMigrations } = await getMigrations(options);
  await runMigrations();
  return betterAuth(options);
}

export function registerAuth(app: FastifyInstance, auth: Awaited<ReturnType<typeof createAuth>>, origin: string) {
  app.route({
    method: ['GET', 'POST'], url: '/api/auth/*',
    async handler(request, reply) {
      const response = await auth.handler(new Request(new URL(request.url, origin), {
        method: request.method,
        headers: fromNodeHeaders(request.headers),
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      }));
      reply.status(response.status);
      response.headers.forEach((value, key) => { if (key !== 'set-cookie') reply.header(key, value); });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}
