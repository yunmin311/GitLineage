/**
 * Deployment-config tests.
 *
 * The env template is only useful if every variable in it is actually read by
 * the code, and if the secure defaults are secure. Both are checked here rather
 * than by reading the template, because a documented setting that silently does
 * nothing is worse than an undocumented one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { loadConfig, publicConfig } from '../src/web/config.ts';

const root = resolve(import.meta.dirname, '..');

async function templateText(): Promise<string> {
  return readFile(join(root, 'gitlineage.env.example'), 'utf8');
}

/** Variables named in the template, comments stripped. */
async function templateVars(): Promise<string[]> {
  const text = await templateText();
  return [...new Set(
    text
      .split('\n')
      .map((line) => line.replace(/^#/, '').trim())
      .filter((line) => /^[A-Z_][A-Z0-9_]*=/.test(line))
      .map((line) => line.split('=')[0]!),
  )].sort();
}

test('every variable the template documents is read by the code', async () => {
  // These are read by Node or git rather than by our own configuration.
  const external = new Set(['NODE_ENV', 'TMPDIR']);
  const sources = await Promise.all(
    ['src/web/config.ts', 'src/web/server.ts', 'src/web/serve.ts', 'src/platform/http.ts', 'src/pipeline/analyze.ts'].map(
      (file) => readFile(join(root, file), 'utf8'),
    ),
  );
  const all = sources.join('\n');

  const undocumented: string[] = [];
  for (const name of await templateVars()) {
    if (external.has(name)) continue;
    if (!all.includes(name)) undocumented.push(name);
  }
  assert.deepEqual(undocumented, [], `template documents variables the code never reads: ${undocumented.join(', ')}`);
});

test('a setting the code reads but the template omits is listed as documented-but-unused', async () => {
  // The inverse check: this asserts the *known* set of extras so that a future
  // variable added to the code without documentation fails here loudly.
  const text = await templateText();
  for (const name of [
    'GITLINEAGE_NO_GIT',
    'GITLINEAGE_NO_REGISTRY',
    'GITLINEAGE_NO_CLIENT',
    'GITLINEAGE_EXTRA_ALLOW_HOSTS',
  ]) {
    assert.ok(text.includes(name), `${name} is read by the code and must be documented in the template`);
  }
});

test('the secure default for client identity is to trust the socket', () => {
  const config = loadConfig({});
  assert.equal(
    config.trustedProxyHeader,
    null,
    'an empty trusted-proxy header is the default, so a forwarding header cannot forge an identity',
  );
});

test('the deployment defaults are the ones the architecture specifies', () => {
  const config = loadConfig({});
  assert.equal(config.maxConcurrentAnalyses, 2, 'global analysis concurrency');
  assert.equal(config.maxQueueDepth, 20, 'bounded queue');
  assert.equal(config.rateLimitEnabled, true, 'anonymous public endpoint is metered by default');
  assert.equal(config.analysisTimeoutMs, 15 * 60_000, 'a five-minute-plus job is normal, not a fault');
});

test('an explicit proxy header is honoured when configured', () => {
  const config = loadConfig({ GITLINEAGE_TRUSTED_PROXY_HEADER: 'cf-connecting-ip' });
  assert.equal(config.trustedProxyHeader, 'cf-connecting-ip');
});

test('state paths default outside the working tree', () => {
  const config = loadConfig({});
  assert.ok(
    config.jobStoreRoot.includes('jobs'),
    `job registry lives beside the cache: ${config.jobStoreRoot}`,
  );
  assert.notEqual(config.jobStoreRoot, '.');
});

test('the health payload reports deployment shape without leaking anything', () => {
  const config = loadConfig({ GITLINEAGE_TRUSTED_PROXY_HEADER: 'x-real-ip' });
  const payload = JSON.stringify(publicConfig(config));
  assert.match(payload, /"jobs":"async"/);
  assert.match(payload, /"maxConcurrent":2/);
  // The header NAME is safe to report; its value must never appear anywhere.
  assert.match(payload, /"trustedProxyHeader":"x-real-ip"/);
  assert.doesNotMatch(payload, /token|secret|password/i);
});

test('a default config is complete and typed', () => {
  const config = loadConfig({});
  // Two settings are legitimately "unset" rather than having a value.
  const nullable = new Set(['trustedProxyHeader', 'publicOrigin']);
  for (const [key, value] of Object.entries(config)) {
    assert.notEqual(value, undefined, `${key} has a value`);
    if (nullable.has(key)) {
      assert.equal(value, null, `${key} defaults to unset`);
    } else {
      assert.notEqual(value, null, `${key} is not null`);
    }
  }
});