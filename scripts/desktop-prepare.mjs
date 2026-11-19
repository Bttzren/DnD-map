// Puts the server and the built client into desktop/app for the desktop app.
// The server is bundled whole, so the app needs no node_modules of its own.
// (Run `vite build` first; `npm run desktop:prepare` does both.)
import { build } from 'esbuild';
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'desktop', 'app');
if (!existsSync(path.join(root, 'dist', 'public', 'index.html'))) throw new Error('Build the client first: npx vite build');

await build({
  entryPoints: [path.join(root, 'server', 'start.ts')],
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  external: ['bufferutil', 'utf-8-validate'],
  outfile: path.join(out, 'server.cjs'),
  logLevel: 'warning',
});
rmSync(path.join(out, 'public'), { recursive: true, force: true });
cpSync(path.join(root, 'dist', 'public'), path.join(out, 'public'), { recursive: true });
console.log('desktop/app ready');
