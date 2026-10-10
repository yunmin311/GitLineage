import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('every stylesheet custom-property reference resolves to a declared token', () => {
  const css = readFileSync(new URL('../src/web/client/app.css', import.meta.url), 'utf8');
  const definitions = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
  const references = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]));
  assert.deepEqual([...references].filter(name => !definitions.has(name)), []);
});
