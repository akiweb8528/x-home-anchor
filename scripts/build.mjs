import { build } from 'esbuild';
import { mkdir, copyFile, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/content.ts', 'src/popup.ts'], outdir: 'dist', bundle: true, format: 'iife', target: 'chrome120', legalComments: 'none' });
for (const file of ['LICENSE', 'manifest.json', 'popup.html', 'popup.css']) {
  await copyFile(['LICENSE', 'manifest.json'].includes(file) ? file : `src/${file}`, `dist/${file}`);
}
