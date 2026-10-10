import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import AjvCompiler from '@fastify/ajv-compiler';
import { manifestSchema, type PluginManifest } from '@isola/plugin';
import type { Pool } from 'pg';
import { valid } from 'semver';
import { x } from 'tar';
import validateName from 'validate-npm-package-name';

export type PublishedRelease = { id: string; manifest: PluginManifest; entryUrl: string };

const compiler = AjvCompiler()({}, { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } });
const validateManifest = compiler({ schema: manifestSchema });

export function releaseEntryUrl(id: string) {
  return `/plugins/${id}/dist/index.html`;
}

function error(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

export async function publishPackage(db: Pool, dataDir: string, userId: string, archive: Readable): Promise<PublishedRelease> {
  const id = randomUUID();
  const directory = join(dataDir, id);
  await mkdir(dataDir, { recursive: true });
  await mkdir(directory);
  try {
    let unsupportedEntry = false;
    try {
      const archivePath = join(directory, 'package.tgz');
      await pipeline(archive, createWriteStream(archivePath));
      // Synchronous extraction finishes pending writes before a strict error can trigger cleanup.
      x({
        cwd: directory, file: archivePath, strict: true, sync: true,
        filter(_path, entry) {
          if (!('type' in entry) || (entry.type !== 'File' && entry.type !== 'Directory')) {
            unsupportedEntry = true;
            return false;
          }
          return true;
        },
      });
      await rm(archivePath);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code?.startsWith('TAR_') || (cause as NodeJS.ErrnoException).code?.startsWith('Z_')) throw error(400, 'Invalid npm archive');
      throw cause;
    }
    if (unsupportedEntry) throw error(400, 'Package may contain only regular files and directories');
    let manifest: PluginManifest;
    try {
      const value: unknown = JSON.parse(await readFile(join(directory, 'package/package.json'), 'utf8'));
      if (!validateManifest(value)) throw error(400, 'Invalid plugin manifest');
      manifest = value as PluginManifest;
      if (!validateName(manifest.name).validForNewPackages || valid(manifest.version) === null) throw error(400, 'Invalid npm package name or version');
      if (!(await stat(join(directory, 'package', manifest.isola.entry))).isFile()) throw error(400, 'Plugin entry is not a file');
    } catch (cause) {
      if (cause instanceof SyntaxError || ['ENOENT', 'EISDIR', 'ENOTDIR'].includes((cause as NodeJS.ErrnoException).code ?? '')) throw error(400, 'Package manifest or entry is missing or invalid');
      throw cause;
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO plugins (name, publisher_id) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING', [manifest.name, userId]);
      const plugin = await client.query('SELECT publisher_id FROM plugins WHERE name = $1 FOR UPDATE', [manifest.name]);
      if (plugin.rows[0].publisher_id !== userId) throw error(403, 'Only the original publisher can publish this plugin');
      await client.query('INSERT INTO releases (id, plugin_name, version, manifest) VALUES ($1, $2, $3, $4)', [id, manifest.name, manifest.version, manifest]);
      await client.query('COMMIT');
    } catch (cause) {
      await client.query('ROLLBACK');
      if ((cause as NodeJS.ErrnoException).code === '23505') throw error(409, 'This plugin version is already published');
      throw cause;
    } finally { client.release(); }
    return { id, manifest, entryUrl: releaseEntryUrl(id) };
  } catch (cause) {
    await rm(directory, { recursive: true, force: true });
    throw cause;
  }
}
