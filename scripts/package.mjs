import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
await import('./build.mjs');

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const archive = resolve('release', `x-home-anchor-v${version}.zip`);
await mkdir('release', { recursive: true });
await rm(archive, { force: true });

if (process.platform === 'win32') {
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference = 'Stop'; Compress-Archive -Path (Join-Path $env:EXTENSION_DIST '*') -DestinationPath $env:EXTENSION_ARCHIVE -Force",
  ], {
    env: { ...process.env, EXTENSION_DIST: resolve('dist'), EXTENSION_ARCHIVE: archive },
    stdio: 'inherit',
  });
} else {
  try {
    execFileSync('zip', ['-q', '-X', '-r', archive, '.', '-x', '*.DS_Store', '__MACOSX/*'], {
      cwd: resolve('dist'),
      stdio: 'inherit',
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('The zip command is required on macOS/Linux. Install it and retry.', { cause: error });
    }
    throw error;
  }
}

console.log(`Created ${archive}`);
