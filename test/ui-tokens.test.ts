import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('every stylesheet custom-property reference resolves to a declared token', () => {
  // site.css loads after app.css in production and must not evade this guard.
  const css = ['app.css', 'site.css'].map(file =>
    readFileSync(new URL(`../src/web/client/${file}`, import.meta.url), 'utf8')).join('\n');
  const definitions = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
  const references = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]));
  assert.deepEqual([...references].filter(name => !definitions.has(name)), []);
});
