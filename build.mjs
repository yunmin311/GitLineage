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
import { cp, mkdir, rm, readFile, stat, writeFile } from 'node:fs/promises';
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

/*
 * The typeface itself.
 *
 * Production used to ship no webfont at all: `--sans` and `--mono` named Geist and
 * Geist Mono, nothing declared an `@font-face`, and no font file was served -- so every
 * visitor got `system-ui` and `ui-monospace` instead, and the approved typography was a
 * declaration rather than a fact. `fonts.css` carries Geist and JetBrains Mono as
 * base64 woff2, which is why it is copied rather than bundled: it is already minified by
 * construction, has no imports to resolve, and keeping it out of the esbuild graph stops
 * a 91 KB data URI from being inlined into `app.js`.
 *
 * It is deliberately unminified and unhashed. `index.html` links it directly, so its URL
 * is stable across deploys and a visitor's cached copy survives a release that changed
 * only the token values.
 */
await cp(resolve(clientDir, 'fonts.css'), resolve(outDir, 'fonts.css'));

const assets = [
  ...Object.entries(result.metafile.outputs)
    .filter(([file]) => file.endsWith('.js') || file.endsWith('.css'))
    .map(([file, meta]) => ({ file: file.replace(/^dist\/web\//, ''), bytes: meta.bytes })),
];
// Copied, not bundled, so esbuild does not know about it -- record it explicitly or the
// manifest would under-report what is actually being served.
for (const name of ['app.css', 'fonts.css', 'index.html']) {
  const info = await stat(resolve(outDir, name));
  assets.push({ file: name, bytes: info.size });
}

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