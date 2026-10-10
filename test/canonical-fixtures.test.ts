import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const FIXTURES = resolve(import.meta.dirname, 'fixtures', 'canonical');
const PINNED_SHA256 = {
  'Kuddev__pebrel.graph.json': '2b3559114f42ca739e19add65193aefecab02d4969d8bf072a68ed4a1a584089',
  'grpc__grpc.graph.json': '302b0309e4b4abb8a110e35d15aaf91a0215d54ebc160ea31ab4f6bece8585d6',
  'nachocebey__is.graph.json': '23919dd718443fe90f8ff05902251b8d2e5b1e53e43648ffe7e04a090a45d8a9',
  'yunmin311__obsidian-config.graph.json': 'f2f6b4c5cd980522f01d26a8fde755d234b9c278bbc618b29a878fa409c6695e',
  'gitlineage-root.graph.json': '08e0e21c0f37e6c5c5cba7def4a43e283abcfed7f85c15fdc6277cfbabe33a2d',
  'mobile-kuddev-pebrel-51514bd.graph.json': '7b182465c71c711938bde5c971206ac41158c511b2e0a7b84514cdf246289edf',
  'mobile-yunmin311-obsidian-config-3982a219.graph.json': 'c5e8750e6bacb05563c27c068761d3d14a4feb520f1416fd096ee5fd9e8dd253',
  'mobile-grpc-grpc-724b3ccb.graph.json': 'b8d926f3aea5590bc8ad1c1191c1a25be7a92e77882baf1b666fee4768115c2e',
} as const;

for (const [filename, expected] of Object.entries(PINNED_SHA256)) {
  test(`canonical fixture ${filename} matches its pinned SHA-256`, () => {
    const actual = createHash('sha256')
      .update(readFileSync(resolve(FIXTURES, filename)))
      .digest('hex');
    assert.equal(actual, expected);
  });
}
