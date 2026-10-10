import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const distro = process.env.ISOLA_TEST_WSL_DISTRO;
const prefix = distro ? ['-d', distro, '-u', 'root', '--'] : [];
// WSL is opt-in for test environments; the default is the contributor's Docker CLI.
export async function docker(...args: string[]) {
  return (await exec(distro ? 'wsl.exe' : 'docker', [...prefix, ...(distro ? ['docker'] : []), ...args], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
}

export async function dockerWorkspace() {
  if (!distro) return process.cwd();
  return (await exec('wsl.exe', [...prefix, 'wslpath', '-a', process.cwd().replaceAll('\\', '/')])).stdout.trim();
}
