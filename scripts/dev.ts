import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'vite';

const exec = promisify(execFile);
const docker = async (...args: string[]) => (await exec('docker', args, { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
const pnpm = process.env.npm_execpath!;
const running = new Set((await docker('ps', '--format', '{{.Names}}')).split('\n'));
const controller = new AbortController();
let child: ChildProcess | undefined;
let startup: Promise<void> | undefined;
let server: Awaited<ReturnType<typeof createServer>> | undefined;
let shutdown: Promise<void> | undefined;
async function execute(file: string, args: string[]) {
  controller.signal.throwIfAborted();
  const active = child = spawn(file, args, { detached: process.platform !== 'win32', stdio: 'inherit' });
  let error: Error | undefined;
  active.once('error', cause => { error = cause; });
  try {
    await new Promise<void>((resolve, reject) => active.once('close', (code, signal) => {
      if (error) reject(error);
      else if (code === 0) resolve();
      else reject(new Error(`${file} exited with ${signal ?? code}`));
    }));
  } finally { if (child === active) child = undefined; }
}
const run = (...args: string[]) => execute(process.execPath, [pnpm, ...args]);
function close() { return shutdown ??= (async () => {
  controller.abort();
  const active = child;
  if (active?.pid) {
    try {
      // The owned process group includes pnpm/Compose's child processes.
      if (process.platform === 'win32') {
        if (active.exitCode === null && active.signalCode === null) await exec('taskkill', ['/PID', String(active.pid), '/T', '/F']);
      } else process.kill(-active.pid, 'SIGINT');
    } catch (error) {
      const code = (error as { code?: string | number }).code;
      if (code !== 'ESRCH' && !(process.platform === 'win32' && code === 128 && (active.exitCode !== null || active.signalCode !== null))) throw error;
    }
  }
  await startup?.catch(() => {});
  await server?.close();
  const started = (await docker('compose', 'ps', '--format', '{{.Name}}')).split('\n').filter(name => name && !running.has(name));
  try {
    if (await docker('compose', 'ps', '--status', 'running', '-q', 'server')) {
      const releases = JSON.parse(await docker('compose', 'exec', '-T', 'server', 'node', '--input-type=module', '-e',
        "import { Pool } from 'pg'; const db = new Pool({ connectionString: process.env.DATABASE_URL }); console.log(JSON.stringify((await db.query('SELECT id FROM releases')).rows.map(row => 'isola-' + row.id))); await db.end();"));
      const active = new Set((await docker('ps', '--format', '{{.Names}}')).split('\n'));
      for (const name of releases) if (active.has(name) && !running.has(name)) await docker('stop', name);
    }
  } catch (error) { console.error('Could not read plugin containers during shutdown:', error); }
  for (const name of started) await docker('stop', name);
  console.log('Development stopped; existing containers and PostgreSQL data preserved.');
})(); }
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void close().then(() => process.exit(0), error => { console.error(error); process.exit(1); }); });
startup = (async () => {
  await run('build');
  await execute('docker', ['build', '-f', 'examples/notes/server/Dockerfile', '-t', 'isola-example-notes:0.1.0', 'examples/notes']);
  await run('--dir', 'examples/notes', 'pack');
  process.env.ORIGIN = 'http://localhost:5173';
  await execute('docker', ['compose', 'up', '--build', '-d', 'server']);
  controller.signal.throwIfAborted();
  server = await createServer({ root: 'apps/client', configFile: 'apps/client/vite.config.ts', server: { host: '0.0.0.0', port: 5173, strictPort: true } });
  controller.signal.throwIfAborted();
  await server.listen();
  console.log('Isola: http://localhost:5173 — sign up, publish examples/notes/isola-example-notes-0.1.0.tgz, install and open. Ctrl+C stops this development run.');
})();
try { await startup; }
catch (error) { const interrupted = controller.signal.aborted; await close(); if (!interrupted) throw error; }
