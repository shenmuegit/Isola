import type { Pool, PoolClient } from 'pg';
import { PLUGIN_API_VERSION } from '@isola/plugin';
import { startBackend } from './backend.ts';
import { releaseEntryUrl, type PublishedRelease } from './market.ts';

export async function installRelease(db: Pool, userId: string, releaseId: string): Promise<PublishedRelease> {
  const result = await db.query<PublishedRelease>('SELECT id, manifest FROM releases WHERE id = $1', [releaseId]);
  const release = result.rows[0];
  if (!release) throw Object.assign(new Error('Release not found'), { statusCode: 404 });
  if (release.manifest.isola.apiVersion !== PLUGIN_API_VERSION) throw Object.assign(new Error('Unsupported plugin API version'), { statusCode: 400 });
  const record = async (client: Pool | PoolClient) => {
    await client.query('INSERT INTO installations (user_id, plugin_name, release_id) VALUES ($1, $2, $3) ON CONFLICT (user_id, plugin_name) DO UPDATE SET release_id = EXCLUDED.release_id', [userId, release.manifest.name, release.id]);
  };
  if (release.manifest.isola.server) await startBackend(db, release, record);
  else await record(db);
  return { ...release, entryUrl: releaseEntryUrl(release.id) };
}
