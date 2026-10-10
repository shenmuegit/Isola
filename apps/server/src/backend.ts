import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { PublishedRelease } from './market.ts';

const exec = promisify(execFile);
const docker = async (...args: string[]) => (await exec('docker', args, { timeout: 120_000 })).stdout;

async function inspect(type: 'container' | 'network', name: string) {
  try { return JSON.parse(await docker(type, 'inspect', name))[0]; }
  catch (error) {
    if (/No such (object|container|network)|network .+ not found/i.test((error as { stderr?: string }).stderr ?? '')) return undefined;
    throw error;
  }
}

export async function startBackend(db: Pool, release: PublishedRelease): Promise<string> {
  const image = release.manifest.isola.server?.image;
  if (!image) throw Object.assign(new Error('Plugin has no backend'), { statusCode: 404 });
  const client = await db.connect();
  const name = `isola-${release.id}`;
  const origin = `http://${name}:3000`;
  let created = false;
  let createdEgress = false;
  let egress: string | undefined;
  try {
    // PostgreSQL serializes provisioning across core processes without an in-memory manager.
    await client.query('SELECT pg_advisory_lock(hashtextextended(current_database() || $1, 0))', [release.manifest.name]);
    const result = await client.query('UPDATE plugins SET backend_database = COALESCE(backend_database, $2), backend_password = COALESCE(backend_password, $3) WHERE name = $1 RETURNING backend_database, backend_password', [release.manifest.name, `isola_${randomUUID().replaceAll('-', '')}`, randomUUID()]);
    const { backend_database: database, backend_password: password } = result.rows[0];
    if (!(await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [database])).rowCount) {
      const sql = await client.query('SELECT format(\'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE\', $1::text, $2::text) AS sql', [database, password]);
      await client.query(sql.rows[0].sql);
    }
    if (!(await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])).rowCount) {
      const sql = await client.query('SELECT format(\'CREATE DATABASE %I OWNER %I\', $1::text, $1::text) AS sql', [database]);
      await client.query(sql.rows[0].sql);
    }
    const revoke = await client.query('SELECT format(\'REVOKE ALL ON DATABASE %I FROM PUBLIC\', $1::text) AS sql', [database]);
    await client.query(revoke.rows[0].sql);
    const network = `isola-${database}`;
    egress = `${network}-egress`;
    if (!await inspect('network', network)) await docker('network', 'create', '--internal', network);
    for (const container of [process.env.HOSTNAME, process.env.POSTGRES_CONTAINER]) {
      if (!container) throw new Error('Core and PostgreSQL container identities are required');
      const state = await inspect('container', container);
      if (!state?.NetworkSettings.Networks[network]) await docker('network', 'connect', network, container);
    }
    const state = await inspect('container', name);
    if (!state) {
      const url = new URL(process.env.DATABASE_URL!);
      url.hostname = process.env.POSTGRES_CONTAINER!;
      url.username = database;
      url.password = password;
      url.pathname = `/${database}`;
      created = true;
      await docker('create', '--name', name, '--network', network, '--restart', 'unless-stopped',
        '-e', `DATABASE_URL=${url}`, '-e', `ISOLA_PLUGIN_NAME=${release.manifest.name}`,
        '-e', `ISOLA_PLUGIN_VERSION=${release.manifest.version}`, '-e', 'PORT=3000', image);
      if (!await inspect('network', egress)) {
        await docker('network', 'create', egress);
        createdEgress = true;
      }
      await docker('network', 'connect', egress, name);
      await docker('start', name);
    } else if (!state.State.Running) await docker('start', name);
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await fetch(`${origin}/health`, { redirect: 'error', signal: AbortSignal.timeout(1000) });
        const health = await response.json();
        if (!response.ok || health.name !== release.manifest.name || health.version !== release.manifest.version || health.apiVersion !== 1) throw new Error('Backend health does not match its release');
        return origin;
      } catch (error) {
        if (attempt === 49 || (error instanceof Error && error.message === 'Backend health does not match its release')) throw error;
        await setTimeout(100);
      }
    }
    throw new Error('Backend did not become healthy');
  } catch (cause) {
    if (created) await docker('rm', '-f', name).catch(() => {});
    if (createdEgress && egress) await docker('network', 'rm', egress).catch(() => {});
    throw Object.assign(new Error('Plugin backend could not start', { cause }), { statusCode: 502 });
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(hashtextextended(current_database() || $1, 0))', [release.manifest.name]); }
    finally { client.release(); }
  }
}

export async function proxyBackend(db: Pool, release: PublishedRelease, userId: string, request: FastifyRequest, reply: FastifyReply) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.raw.once('aborted', abort);
  reply.raw.once('close', abort);
  try {
    const url = new URL(await startBackend(db, release));
    const prefix = `/api/plugins/${release.id}/api`;
    const relative = request.raw.url!.slice(prefix.length);
    const query = relative.indexOf('?');
    url.pathname = query < 0 ? relative : relative.slice(0, query);
    url.search = query < 0 ? '' : relative.slice(query);
    const headers = new Headers({ 'x-isola-user-id': userId });
    for (const key of ['content-type', 'accept', 'last-event-id']) {
      const value = request.headers[key];
      if (typeof value === 'string') headers.set(key, value);
    }
    const response = await fetch(url, {
      method: request.method, headers, redirect: 'error', signal: controller.signal,
      ...(!['GET', 'HEAD'].includes(request.method) ? { body: request.body as Buffer<ArrayBuffer> } : {}),
    });
    reply.status(response.status).header('content-security-policy', 'sandbox allow-scripts');
    const contentType = response.headers.get('content-type');
    if (contentType) reply.header('content-type', contentType);
    if (response.body) {
      const stream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
      stream.once('close', () => { request.raw.off('aborted', abort); reply.raw.off('close', abort); });
      return reply.send(stream);
    }
    return reply.send();
  } catch {
    if (!controller.signal.aborted) return reply.status(502).send({ message: 'Plugin backend request failed' });
  }
}
