import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { Header } from 'tar';
import { Pool } from 'pg';

export const manifest = {
  name: '@isola-test/notes', version: '1.0.0', description: 'Test plugin',
  isola: { title: 'Notes', apiVersion: 1, entry: 'dist/index.html' },
};

export async function testDatabase() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgresql://isola_test@127.0.0.1:55432/postgres');
  const admin = new Pool({ connectionString: url.toString() });
  const name = `isola_market_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const db = new Pool({ connectionString: url.toString() });
  return { db, async close() {
    await db.end();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  } };
}

export async function npmPackage(value: unknown = manifest, entry = true) {
  const directory = await mkdtemp(join(tmpdir(), 'isola-npm-'));
  try {
    await writeFile(join(directory, 'package.json'), JSON.stringify(value));
    if (entry) {
      await mkdir(join(directory, 'dist'));
      await writeFile(join(directory, 'dist/index.html'), '<!doctype html><script type="module" src="./main.js"></script><h1>Notes</h1>');
      await writeFile(join(directory, 'dist/main.js'), 'export const title = "Notes";');
      await writeFile(join(directory, 'dist/style.css'), 'body { color: blue; }');
      await mkdir(join(directory, 'dist/nested'));
      await writeFile(join(directory, 'dist/nested/index.html'), '<!doctype html><h1>Nested</h1>');
      await writeFile(join(directory, 'dist/image.svg'), '<svg xmlns="http://www.w3.org/2000/svg" onload="window.activeSvg = true"></svg>');
    }
    const npm = join(dirname(process.execPath), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
    const { stdout } = await promisify(execFile)(process.execPath, [npm, 'pack', '--json', '--ignore-scripts'], { cwd: directory });
    return await readFile(join(directory, JSON.parse(stdout)[0].filename));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export function archiveEntries(entries: Array<{ path: string; body?: string; type?: 'File' | 'Directory' | 'SymbolicLink' | 'Link'; linkpath?: string }>) {
  const chunks: Buffer[] = [];
  for (const { path, body = '', type = 'File', linkpath } of entries) {
    const data = Buffer.from(body);
    const header = new Header({ path, type, linkpath, size: data.length, mode: 0o644, uid: 0, gid: 0, mtime: new Date(0) });
    header.encode();
    chunks.push(header.block!, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
