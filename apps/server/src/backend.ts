import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
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

async function databaseSQL(client: PoolClient, format: string, ...values: string[]) {
  const parameters = values.map((_, index) => `$${index + 2}::text`).join(', ');
  const result = await client.query(`SELECT pg_catalog.format($1::text, ${parameters}) AS sql`, [format, ...values]);
  await client.query(result.rows[0].sql);
}

export async function startBackend(db: Pool, release: PublishedRelease, ready?: (client: PoolClient) => Promise<void>): Promise<string> {
  const image = release.manifest.isola.server?.image;
  if (!image) throw Object.assign(new Error('Plugin has no backend'), { statusCode: 404 });
  const client = await db.connect();
  const name = `isola-${release.id}`;
  const origin = `http://${name}:3000`;
  let created = false;
  let createdEgress = false;
  let egress: string | undefined;
  let database: string | undefined;
  let backup: string | undefined;
  let prepared = false;
  let candidateStarted = false;
  let original: { owner: string; datconnlimit: number; datallowconn: boolean } | undefined;
  const stopped: string[] = [];
  let failure = 'Plugin backend database provisioning failed';
  try {
    // PostgreSQL serializes provisioning across core processes without an in-memory manager.
    await client.query('SELECT pg_advisory_lock(hashtextextended(current_database() || $1, 0))', [release.manifest.name]);
    const pending = await client.query('SELECT backend_backup FROM plugins WHERE name = $1', [release.manifest.name]);
    if (pending.rows[0]?.backend_backup) {
      failure = `Plugin backend recovery required; retained backup ${pending.rows[0].backend_backup}`;
      throw new Error(failure);
    }
    const result = await client.query('UPDATE plugins SET backend_database = COALESCE(backend_database, $2), backend_password = COALESCE(backend_password, $3) WHERE name = $1 RETURNING backend_database, backend_password', [release.manifest.name, `isola_${randomUUID().replaceAll('-', '')}`, randomUUID()]);
    database = result.rows[0].backend_database as string;
    const password = result.rows[0].backend_password;
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
    failure = 'Plugin backend network setup failed';
    if (!await inspect('network', network)) await docker('network', 'create', '--internal', network);
    for (const container of [process.env.HOSTNAME, process.env.POSTGRES_CONTAINER]) {
      if (!container) {
        failure = 'Core and PostgreSQL container identities are required';
        throw new Error(failure);
      }
      const state = await inspect('container', container);
      if (!state?.NetworkSettings.Networks[network]) await docker('network', 'connect', network, container);
    }
    const state = await inspect('container', name);
    if (!state?.State.Running) {
      failure = 'Plugin backend stop before backup failed';
      const releases = await client.query('SELECT id FROM releases WHERE plugin_name = $1', [release.manifest.name]);
      for (const row of releases.rows) {
        const previous = `isola-${row.id}`;
        if ((await inspect('container', previous))?.State.Running) {
          stopped.push(previous);
          await docker('stop', previous);
        }
      }
      failure = 'Plugin backend backup preparation failed';
      original = (await client.query('SELECT pg_catalog.pg_get_userbyid(datdba) AS owner, datconnlimit, datallowconn FROM pg_catalog.pg_database WHERE datname = $1', [database])).rows[0];
      await databaseSQL(client, 'ALTER DATABASE %I ALLOW_CONNECTIONS false', database);
      const terminated = await client.query('SELECT pg_catalog.pg_terminate_backend(pid, 5000) AS stopped FROM pg_catalog.pg_stat_activity WHERE datid = (SELECT oid FROM pg_catalog.pg_database WHERE datname = $1)', [database]);
      if (terminated.rows.some(row => !row.stopped)) throw new Error(failure);
      backup = `isola_backup_${randomUUID().replaceAll('-', '')}`;
      await client.query('UPDATE plugins SET backend_backup = $2 WHERE name = $1', [release.manifest.name, backup]);
      const admin = (await client.query('SELECT CURRENT_USER AS name')).rows[0].name;
      await databaseSQL(client, 'CREATE DATABASE %I TEMPLATE %I OWNER %I ALLOW_CONNECTIONS false CONNECTION LIMIT %s', backup, database, admin, String(original!.datconnlimit));
      await databaseSQL(client, 'REVOKE ALL ON DATABASE %I FROM PUBLIC', backup);
      const settings = await client.query('SELECT r.rolname, o.option_name, o.option_value FROM pg_catalog.pg_db_role_setting s JOIN pg_catalog.pg_database d ON d.oid = s.setdatabase LEFT JOIN pg_catalog.pg_roles r ON r.oid = s.setrole CROSS JOIN LATERAL pg_catalog.pg_options_to_table(s.setconfig) o WHERE d.datname = $1', [database]);
      for (const setting of settings.rows) {
        await client.query('BEGIN');
        try {
          await client.query('SELECT pg_catalog.set_config($1, $2, true)', [setting.option_name, setting.option_value]);
          if (setting.rolname) await databaseSQL(client, 'ALTER ROLE %I IN DATABASE %I SET %I FROM CURRENT', setting.rolname, backup, setting.option_name);
          else await databaseSQL(client, 'ALTER DATABASE %I SET %I FROM CURRENT', backup, setting.option_name);
          await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      }
      prepared = true;
      await databaseSQL(client, 'ALTER DATABASE %I ALLOW_CONNECTIONS true', database);
    }
    if (!state) {
      const url = new URL(process.env.DATABASE_URL!);
      url.hostname = process.env.POSTGRES_CONTAINER!;
      url.username = database;
      url.password = password;
      url.pathname = `/${database}`;
      created = true;
      failure = 'Plugin backend container creation failed';
      await docker('create', '--name', name, '--network', network, '--restart', 'unless-stopped',
        '-e', `DATABASE_URL=${url}`, '-e', `ISOLA_PLUGIN_NAME=${release.manifest.name}`,
        '-e', `ISOLA_PLUGIN_VERSION=${release.manifest.version}`, '-e', 'PORT=3000', image);
      failure = 'Plugin backend network setup failed';
      if (!await inspect('network', egress)) {
        await docker('network', 'create', egress);
        createdEgress = true;
      }
      await docker('network', 'connect', egress, name);
      failure = 'Plugin backend container start failed';
      candidateStarted = true;
      await docker('start', name);
    } else if (!state.State.Running) {
      failure = 'Plugin backend container start failed';
      candidateStarted = true;
      await docker('start', name);
    }
    failure = 'Backend did not become healthy';
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await fetch(`${origin}/health`, { redirect: 'error', signal: AbortSignal.timeout(1000) });
        if (!response.ok) throw new Error(failure);
        const health = await response.json();
        if (health.name !== release.manifest.name || health.version !== release.manifest.version || health.apiVersion !== 1) {
          failure = 'Backend health does not match its release';
          throw new Error(failure);
        }
        break;
      } catch (error) {
        if (attempt === 49 || (error instanceof Error && error.message === 'Backend health does not match its release')) throw error;
        await setTimeout(100);
      }
    }
    failure = 'Previous plugin backend restart failed';
    for (const previous of stopped) await docker('start', previous);
    failure = 'Plugin installation recording failed';
    await client.query('BEGIN');
    try {
      await ready?.(client);
      if (backup) await client.query('UPDATE plugins SET backend_backup = NULL WHERE name = $1', [release.manifest.name]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    if (backup) {
      try { await databaseSQL(client, 'DROP DATABASE %I', backup); }
      catch { console.error(`Plugin backend obsolete backup cleanup failed; retained backup ${backup}`); }
    }
    return origin;
  } catch {
    let recoveryFailure: string | undefined;
    try {
      if (created || candidateStarted) {
        recoveryFailure = 'Candidate backend removal failed';
        if (await inspect('container', name)) await docker('rm', '-f', name);
      }
      if (backup && prepared) {
        recoveryFailure = 'Previous plugin backend stop for recovery failed';
        for (const previous of stopped) await docker('stop', previous);
        recoveryFailure = 'Plugin backend database restoration failed';
        if (!(await client.query('SELECT 1 FROM pg_catalog.pg_database WHERE datname = $1 AND NOT datallowconn AND datdba = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER)', [backup])).rowCount) throw new Error(recoveryFailure);
        if ((await client.query('SELECT 1 FROM pg_catalog.pg_database WHERE datname = $1', [database])).rowCount) await databaseSQL(client, 'ALTER DATABASE %I ALLOW_CONNECTIONS false', database!);
        await databaseSQL(client, 'DROP DATABASE IF EXISTS %I WITH (FORCE)', database!);
        await client.query('BEGIN');
        try {
          await databaseSQL(client, 'ALTER DATABASE %I RENAME TO %I', backup, database!);
          await databaseSQL(client, 'ALTER DATABASE %I OWNER TO %I', database!, original!.owner);
          await databaseSQL(client, 'REVOKE ALL ON DATABASE %I FROM PUBLIC', database!);
          await databaseSQL(client, 'ALTER DATABASE %I CONNECTION LIMIT %s', database!, String(original!.datconnlimit));
          await databaseSQL(client, 'ALTER DATABASE %I ALLOW_CONNECTIONS true', database!);
          await client.query('UPDATE plugins SET backend_backup = NULL WHERE name = $1', [release.manifest.name]);
          await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        backup = undefined;
      } else if (original) {
        recoveryFailure = 'Plugin backend backup preparation recovery failed';
        await databaseSQL(client, 'ALTER DATABASE %I ALLOW_CONNECTIONS %s', database!, String(original.datallowconn));
        recoveryFailure = 'Previous plugin backend restart failed';
        for (const previous of stopped) await docker('start', previous);
        stopped.length = 0;
        recoveryFailure = 'Plugin backend incomplete backup cleanup failed';
        if (backup) {
          await databaseSQL(client, 'DROP DATABASE IF EXISTS %I', backup);
          await client.query('UPDATE plugins SET backend_backup = NULL WHERE name = $1', [release.manifest.name]);
          backup = undefined;
        }
      }
      recoveryFailure = 'Previous plugin backend restart failed';
      for (const previous of stopped) if (previous !== name) await docker('start', previous);
      recoveryFailure = 'Plugin backend network cleanup failed';
      if (createdEgress && egress) await docker('network', 'rm', egress);
      recoveryFailure = undefined;
    } catch { /* Keep the protected copy and reference when recovery cannot finish. */ }
    const message = recoveryFailure ? `${failure}; ${recoveryFailure}${backup ? `; retained backup ${backup}` : ''}` : failure;
    throw Object.assign(new Error(message), { statusCode: 502 });
  } finally {
    let reusable = true;
    try { await client.query('SELECT pg_advisory_unlock(hashtextextended(current_database() || $1, 0))', [release.manifest.name]); }
    catch {
      console.error('Plugin backend lock connection failed; closing its session');
      reusable = false;
    }
    client.release(!reusable);
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
