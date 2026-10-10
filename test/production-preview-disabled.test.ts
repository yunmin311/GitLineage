import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/web/serve.ts';

test('production server keeps Deep Search disabled and does not accept preview tasks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gitlineage-production-preview-'));
  const running = await serve({
    host: '127.0.0.1',
    port: 0,
    clientDir: null,
    cacheRoot: root,
    jobStoreRoot: join(root, 'jobs'),
  }, { ...process.env, NODE_ENV: 'production', GITLINEAGE_NO_CLIENT: '1', GITLINEAGE_PRIVATE_BETA: '1' });

  try {
    const capabilities = await fetch(`${running.url}/api/deep-search/capabilities`);
    assert.equal(capabilities.status, 200);
    assert.deepEqual(await capabilities.json(), { enabled: false });

    const search = await fetch(`${running.url}/api/deep-search/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repository: 'owner/repository' }),
    });
    assert.equal(search.status, 404);
    const login = await fetch(`${running.url}/api/private-beta/login`, {method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    assert.equal(login.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => running.server.close(error => error ? reject(error) : resolve()));
    running.app.analysis.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});
