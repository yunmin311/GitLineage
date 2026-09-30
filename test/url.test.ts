import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRepositoryRef, extractRepositoryRefFromText, assertPublicHttpsUrl } from '../src/platform/url.ts';

const allowlist = new Set(['api.github.com', 'raw.githubusercontent.com']);

test('resolves the plain owner/name form', () => {
  assert.deepEqual(resolveRepositoryRef('torvalds/linux'), {
    provider: 'github',
    owner: 'torvalds',
    name: 'linux',
  });
});

test('normalises case so that entities do not split on casing', () => {
  assert.deepEqual(resolveRepositoryRef('Torvalds/Linux'), {
    provider: 'github',
    owner: 'torvalds',
    name: 'linux',
  });
});

test('resolves web, tree, blob, ssh and .git forms', () => {
  const expected = { provider: 'github', owner: 'octocat', name: 'spoon-knife' };
  for (const input of [
    'https://github.com/octocat/Spoon-Knife',
    'https://github.com/octocat/Spoon-Knife/',
    'https://github.com/octocat/Spoon-Knife.git',
    'https://www.github.com/octocat/Spoon-Knife/tree/main',
    'https://github.com/octocat/Spoon-Knife/blob/main/README.md',
    'github.com/octocat/Spoon-Knife',
    'git@github.com:octocat/Spoon-Knife.git',
    'git+https://github.com/octocat/Spoon-Knife.git',
    'ssh://git@github.com/octocat/Spoon-Knife.git',
  ]) {
    assert.deepEqual(resolveRepositoryRef(input), expected, `input: ${input}`);
  }
});

test('rejects hosts and shapes that are not supported GitHub repositories', () => {
  const rejected = [
    'https://gitlab.com/owner/repo',
    'https://evil.example.com/github.com/owner/repo',
    'https://github.com.evil.example/owner/repo',
    'http://github.com/owner/repo',
    'https://github.com:8443/owner/repo',
    'https://user:pass@github.com/owner/repo',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/owner/repo',
    'file:///etc/passwd',
    'https://github.com/owner/../repo',
    'https://github.com/-bad/repo',
    'https://github.com/owner',
    '',
    '   ',
  ];
  for (const input of rejected) {
    assert.throws(() => resolveRepositoryRef(input), `expected rejection for: ${input}`);
  }
});

test('text extraction never throws on hostile text', () => {
  const hostile = [
    'see https://github.com/a/b and more',
    'not a url at all',
    'https://10.0.0.1/admin',
    'javascript:alert(1)',
    'data:text/html,<script>',
    'https://github.com/',
    '\u0000\u0001',
  ];
  for (const text of hostile) {
    const result = extractRepositoryRefFromText(text);
    assert.ok(result === null || typeof result.name === 'string');
  }
  assert.deepEqual(extractRepositoryRefFromText('see https://github.com/a/b now'), {
    provider: 'github',
    owner: 'a',
    name: 'b',
  });
});

test('outbound URL guard blocks SSRF vectors', () => {
  assert.throws(() => assertPublicHttpsUrl(new URL('http://api.github.com/x'), allowlist));
  assert.throws(() => assertPublicHttpsUrl(new URL('https://169.254.169.254/'), allowlist));
  assert.throws(() => assertPublicHttpsUrl(new URL('https://user:pw@api.github.com/'), allowlist));
  assert.throws(() => assertPublicHttpsUrl(new URL('https://api.github.com:8443/'), allowlist));
  assert.throws(() => assertPublicHttpsUrl(new URL('https://localhost/api'), allowlist));
  assert.doesNotThrow(() => assertPublicHttpsUrl(new URL('https://api.github.com/repos/a/b'), allowlist));
  assert.doesNotThrow(() => assertPublicHttpsUrl(new URL('https://api.github.com:443/repos/a/b'), allowlist));
});
