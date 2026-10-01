/**
 * Production build.
 *
 * Bundles and minifies the client, copies static assets, and stamps a build
 * manifest. No localhost or environment values are baked in: the client resolves
 * its own API base from `window.location`, so the same artefact works on any
 * host without a rebuild.
 *
 *   node build.mjs
 */
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const clientDir = resolve(root, 'src/web/client');
const outDir = resolve(root, 'dist/web');

const result = await build({
  entryPoints: [resolve(clientDir, 'app.js')],
  outdir: resolve(outDir, 'assets'),
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'esm',
  target: ['es2022'],
  splitting: false,
  legalComments: 'none',
  metafile: true,
  logLevel: 'info',
});

await mkdir(outDir, { recursive: true });
await cp(resolve(clientDir, 'index.html'), resolve(outDir, 'index.html'));
await cp(resolve(clientDir, 'app.css'), resolve(outDir, 'app.css'));

const assets = Object.entries(result.metafile.outputs)
  .filter(([file]) => file.endsWith('.js') || file.endsWith('.css'))
  .map(([file, meta]) => ({ file: file.replace(/^dist\/web\//, ''), bytes: meta.bytes }));

// Point the shell at the bundled module so the build is genuinely self-contained.
// The path stays root-absolute: the shell is served at `/owner/repo` too, where a
// relative URL would resolve against the repository path and 404.
const shell = await readFile(resolve(outDir, 'index.html'), 'utf8');
const built = shell.replace('<script type="module" src="/app.js"></script>', '<script type="module" src="/assets/app.js"></script>');
if (!built.includes('/assets/app.js')) {
  throw new Error('build did not rewrite the module reference; the shell would load unbundled source');
}
await writeFile(resolve(outDir, 'index.html'), built, 'utf8');

await writeFile(
  resolve(outDir, 'build-manifest.json'),
  `${JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      // Recorded, not baked in. The client derives its own origin at runtime.
      origin: 'runtime',
      assets,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

process.stdout.write(`\nproduction build written to ${outDir}\n`);
for (const asset of assets) process.stdout.write(`  ${asset.file}  ${(asset.bytes / 1024).toFixed(1)} KB\n`);