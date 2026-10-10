import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'vite';

const exec = promisify(execFile);
const docker = async (...args: string[]) => (await exec('docker', args, { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
const pnpm = process.env.npm_execpath!;
const run = async (...args: string[]) => { const result = await exec(process.execPath, [pnpm, ...args]); process.stdout.write(result.stdout); process.stderr.write(result.stderr); };
const running = new Set((await docker('ps', '--format', '{{.Names}}')).split('\n'));
let started: string[] = [];
let server: Awaited<ReturnType<typeof createServer>> | undefined;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server?.close();
  try {
    const releases = JSON.parse(await docker('compose', 'exec', '-T', 'server', 'node', '--input-type=module', '-e',
      "import { Pool } from 'pg'; const db = new Pool({ connectionString: process.env.DATABASE_URL }); console.log(JSON.stringify((await db.query('SELECT id FROM releases')).rows.map(row => 'isola-' + row.id))); await db.end();"));
    const active = new Set((await docker('ps', '--format', '{{.Names}}')).split('\n'));
    for (const name of releases) if (active.has(name) && !running.has(name)) await docker('stop', name);
  } catch (error) { console.error('Could not read plugin containers during shutdown:', error); }
  for (const name of started) await docker('stop', name);
  console.log('Development stopped; existing containers and PostgreSQL data preserved.');
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void close().then(() => process.exit(0), error => { console.error(error); process.exit(1); }); });
try {
  await run('build');
  await docker('build', '-f', 'examples/notes/server/Dockerfile', '-t', 'isola-example-notes:0.1.0', 'examples/notes');
  await run('--dir', 'examples/notes', 'pack');
  process.env.ORIGIN = 'http://localhost:5173';
  try { await docker('compose', 'up', '--build', '-d', 'server'); }
  finally { started = (await docker('compose', 'ps', '--format', '{{.Name}}')).split('\n').filter(name => name && !running.has(name)); }
  server = await createServer({ root: 'apps/client', configFile: 'apps/client/vite.config.ts', server: { host: '0.0.0.0', port: 5173, strictPort: true } });
  await server.listen();
  console.log('Isola: http://localhost:5173 — sign up, publish examples/notes/isola-example-notes-0.1.0.tgz, install and open. Ctrl+C stops this development run.');
} catch (error) { await close(); throw error; }
