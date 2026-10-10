import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { build } from 'vite';
import { setTimeout } from 'node:timers/promises';
import { docker, dockerWorkspace } from './docker.ts';

export default async function setup() {
  const name = `isola-e2e-${randomUUID().slice(0, 8)}`;
  const postgres = `${name}-postgres`;
  const server = `${name}-server`;
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    let networks: string[] = [];
    let pluginContainers: string[] = [];
    let volumes: string[] = [];
    try {
      volumes = JSON.parse(await docker('inspect', postgres))[0].Mounts.filter((mount: { Type: string }) => mount.Type === 'volume').map((mount: { Name: string }) => mount.Name);
      networks = JSON.parse(await docker('exec', postgres, 'psql', '-U', 'isola', '-tAc', "SELECT COALESCE(json_agg('isola-' || backend_database), '[]') FROM plugins WHERE backend_database IS NOT NULL"));
      const rows = JSON.parse(await docker('exec', postgres, 'psql', '-U', 'isola', '-tAc', "SELECT COALESCE(json_agg(id), '[]') FROM releases"));
      pluginContainers = rows.map((id: string) => `isola-${id}`);
      networks.push(...networks.map(network => `${network}-egress`));
      console.log('Real market counts:', await docker('exec', postgres, 'psql', '-U', 'isola', '-tAc', "SELECT json_build_object('releases', (SELECT count(*) FROM releases), 'installations', (SELECT count(*) FROM installations), 'backendDatabases', (SELECT count(*) FROM plugins WHERE backend_database IS NOT NULL))"));
      for (const container of pluginContainers) await docker('rm', '-f', container).catch(() => {});
    } catch {}
    await docker('rm', '-fv', server, postgres).catch(() => {});
    for (const network of [...networks, name]) await docker('network', 'rm', network).catch(() => {});
    const allContainers = new Set((await docker('ps', '-a', '--format', '{{.Names}}')).split('\n'));
    const remaining = [server, postgres, ...pluginContainers].filter(container => allContainers.has(container));
    const allNetworks = new Set((await docker('network', 'ls', '--format', '{{.Name}}')).split('\n'));
    const remainingNetworks = [...networks, name].filter(network => allNetworks.has(network));
    const allVolumes = new Set((await docker('volume', 'ls', '--format', '{{.Name}}')).split('\n'));
    const remainingVolumes = volumes.filter(volume => allVolumes.has(volume));
    if (remaining.length || remainingNetworks.length || remainingVolumes.length) throw new Error(`Test cleanup incomplete: ${JSON.stringify({ remaining, remainingNetworks, remainingVolumes })}`);
    console.log(`Cleaned ${name}: remaining containers=0, networks=0, PostgreSQL volumes=0`);
  }
  try {
    const exec = promisify(execFile);
    await build({ root: 'e2e/fixtures/plugin', configFile: 'e2e/fixtures/plugin/vite.config.ts', logLevel: 'error' });
    await build({ root: 'examples/notes', configFile: 'examples/notes/vite.config.ts', logLevel: 'error' });
    const npm = join(dirname(process.execPath), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
    await exec(process.execPath, [npm, 'pack', '--ignore-scripts'], { cwd: 'examples/notes' });
    const workspace = await dockerWorkspace();
    await docker('build', '-t', 'isola-example-notes:0.1.0', '-f', `${workspace}/examples/notes/server/Dockerfile`, `${workspace}/examples/notes`);
    await docker('build', '-t', 'isola-server', '-f', `${workspace}/apps/server/Dockerfile`, workspace);
    await docker('network', 'create', name);
    await docker('run', '-d', '--name', postgres, '--network', name, '-e', 'POSTGRES_USER=isola', '-e', 'POSTGRES_PASSWORD=isola', '-e', 'POSTGRES_DB=isola', 'postgres:18');
    for (let attempt = 0; ; attempt++) {
      try { await docker('exec', postgres, 'pg_isready', '-U', 'isola'); break; }
      catch (error) { if (attempt === 60) throw error; await setTimeout(250); }
    }
    await docker('run', '-d', '--name', server, '--network', name, '-p', '3000:3000', '-v', '/var/run/docker.sock:/var/run/docker.sock',
      '-e', `DATABASE_URL=postgresql://isola:isola@${postgres}:5432/isola`, '-e', `POSTGRES_CONTAINER=${postgres}`,
      '-e', 'BETTER_AUTH_SECRET=isola-e2e-secret-with-at-least-32-characters', '-e', 'ORIGIN=http://127.0.0.1:3000', '-e', 'DATA_DIR=/data', 'isola-server');
    console.log(`Started ${name}`);
    for (let attempt = 0; ; attempt++) {
      try { if ((await fetch('http://127.0.0.1:3000/api/market/releases')).ok) break; }
      catch (error) { if (attempt === 100) throw error; }
      if (attempt === 100) throw new Error('Core did not start');
      await setTimeout(200);
    }
    return close;
  } catch (error) { await close(); throw error; }
}
