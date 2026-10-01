/**
 * Production-build smoke test.
 *
 * A build that produces files but not a working page is not a build. This runs
 * the server against `dist/web`, proves the shell and bundle are actually served
 * over HTTP, and checks the one thing a bundler can silently break: that the
 * client resolves its API base from the request origin rather than from a
 * hard-coded localhost.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { serve } from '../src/web/serve.ts';

const root = resolve(import.meta.dirname, '..');

test('build.mjs produces a self-contained shell pointing at the bundle', async () => {
  const build = spawnSync(process.execPath, ['build.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(build.status, 0, `build failed:\n${build.stderr}`);

  const shell = await readFile(join(root, 'dist/web/index.html'), 'utf8');
  assert.match(shell, /src="\/assets\/app\.js"/, 'the shell must load the bundle, not the source module');
  assert.doesNotMatch(shell, /src="\/app\.js"/, 'the source module must not be referenced by the build');

  const manifest = JSON.parse(await readFile(join(root, 'dist/web/build-manifest.json'), 'utf8'));
  assert.ok(Array.isArray(manifest.assets) && manifest.assets.length > 0);
  assert.equal(manifest.origin, 'runtime', 'no origin is baked into the build');

  const bundle = await readFile(join(root, 'dist/web/assets/app.js'), 'utf8');
  assert.ok(bundle.length < 200_000, 'the bundle is minified, not a copy of the source tree');
  // The hard-coded localhost that a build would otherwise embed.
  assert.doesNotMatch(bundle, /localhost/);
  assert.doesNotMatch(bundle, /127\.0\.0\.1/);
  // Requests are same-origin relative paths, so the app works on any host.
  assert.match(bundle, /\/api\/view\//);
});

test('the server serves the built shell and bundle over HTTP', async (t) => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'gl-build-cache-'));
  const { server, url } = await serve(
    {
      port: 0,
      clientDir: resolve(root, 'dist/web'),
      cacheRoot,
      enableGit: false,
      enableRegistry: false,
    },
    { GITLINEAGE_NO_CLIENT: '' },
  );
  t.after(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    await rm(cacheRoot, { recursive: true, force: true });
  });

  const shell = await fetch(`${url}/owner/repo`);
  assert.equal(shell.status, 200);
  assert.match(shell.headers.get('content-type') ?? '', /text\/html/);
  const shellBody = await shell.text();
  assert.match(shellBody, /src="\/assets\/app\.js"/);
  // Relative asset URLs would resolve against /owner/ and 404, so the built
  // shell must not contain any.
  assert.doesNotMatch(shellBody, /(?:src|href)="\.\//, 'no relative asset URL may survive the build');

  // The cold route is a real route, not a 404 that the SPA would have to repair.
  const cold = await fetch(`${url}/octocat/spoon-knife`);
  assert.equal(cold.status, 200, 'a cold /owner/repo load must serve the app shell');

  const bundle = await fetch(`${url}/assets/app.js`);
  assert.equal(bundle.status, 200, 'the bundled module must be served from the same origin');
  assert.match(bundle.headers.get('content-type') ?? '', /javascript/);
});

test('an API-only deployment serves the contract without the client', async (t) => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'gl-apionly-cache-'));
  const { server, url } = await serve(
    { port: 0, clientDir: null, cacheRoot, enableGit: false, enableRegistry: false },
    { GITLINEAGE_NO_CLIENT: '1' },
  );
  t.after(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    await rm(cacheRoot, { recursive: true, force: true });
  });

  const contract = await fetch(`${url}/api/contract`);
  assert.equal(contract.status, 200);
  const payload = (await contract.json()) as { data?: { directionContract?: { symmetric?: string[] } } };
  assert.ok(payload.data?.directionContract?.symmetric?.includes('shares_exact_content_with'));

  const page = await fetch(`${url}/owner/repo`);
  assert.notEqual(page.status, 200, 'no client is served when the client is disabled');
});