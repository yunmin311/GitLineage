import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareHistories, type HistorySample } from '../src/collectors/git/history.ts';
import { buildBlobIndex, compareBlobIndexes } from '../src/collectors/git/blobs.ts';
import type { GitHubTreeEntry } from '../src/collectors/github/client.ts';

const ROOT = { provider: 'github', owner: 'me', name: 'project' } as const;
const UPSTREAM = { provider: 'github', owner: 'up', name: 'stream' } as const;

const sha = (n: number): string => n.toString(16).padStart(40, '0');

function sample(overrides: Partial<HistorySample> & { ref: { provider: 'github'; owner: string; name: string } }): HistorySample {
  return {
    commits: [],
    truncated: false,
    createdAt: '2020-01-01T00:00:00Z',
    htmlUrl: `https://github.com/${overrides.ref.owner}/${overrides.ref.name}`,
    ...overrides,
  };
}

function compare(rootSample: HistorySample, candidates: HistorySample[]) {
  return compareHistories({ root: ROOT, rootSample, candidates });
}

test('one identical commit object is enough for shares_history_with', () => {
  const result = compare(sample({ ref: ROOT, commits: [sha(1), sha(2)] }), [sample({ ref: UPSTREAM, commits: [sha(1)] })]);
  assert.deepEqual(
    result.observations.map((observation) => observation.relationship),
    ['shares_history_with'],
  );
  assert.equal(result.observations[0]?.evidence.status, 'VERIFIED');
  assert.equal(result.observations[0]?.directed, false);
  assert.equal(result.observations[0]?.evidence.data.shared_commit_count, 1);
});

test('no shared commit means no relationship at all', () => {
  const result = compare(sample({ ref: ROOT, commits: [sha(1), sha(2)] }), [sample({ ref: UPSTREAM, commits: [sha(7), sha(8)] })]);
  assert.deepEqual(result.observations, []);
});

test('containment plus ordering yields derived_from', () => {
  const result = compare(
    sample({ ref: ROOT, commits: [sha(1), sha(2)], createdAt: '2024-05-01T00:00:00Z' }),
    [sample({ ref: UPSTREAM, commits: [sha(1), sha(2), sha(3)], createdAt: '2020-01-01T00:00:00Z' })],
  );
  assert.deepEqual(
    result.observations.map((observation) => observation.relationship).sort(),
    ['derived_from', 'shares_history_with'],
  );
  const derived = result.observations.find((observation) => observation.relationship === 'derived_from');
  assert.equal(derived?.evidence.type, 'git_history_containment');
  assert.equal(derived?.directed, true);
  assert.equal(derived?.evidence.data.source_only_commit_count, 1);
  assert.equal(derived?.evidence.data.target_only_commit_count, 0);
});

test('containment without temporal ordering stays at shared history', () => {
  const result = compare(
    sample({ ref: ROOT, commits: [sha(1), sha(2)], createdAt: '2019-01-01T00:00:00Z' }),
    [sample({ ref: UPSTREAM, commits: [sha(1), sha(2), sha(3)], createdAt: '2020-01-01T00:00:00Z' })],
  );
  assert.deepEqual(
    result.observations.map((observation) => observation.relationship),
    ['shares_history_with'],
  );
  assert.equal(result.diagnostics[0]?.code, 'containment_not_asserted');
});

test('diverged history never produces derived_from', () => {
  const result = compare(
    sample({ ref: ROOT, commits: [sha(1), sha(99)], createdAt: '2024-05-01T00:00:00Z' }),
    [sample({ ref: UPSTREAM, commits: [sha(1), sha(3)], createdAt: '2020-01-01T00:00:00Z' })],
  );
  assert.deepEqual(
    result.observations.map((observation) => observation.relationship),
    ['shares_history_with'],
  );
});

test('a truncated history window can never prove containment', () => {
  const result = compare(
    sample({ ref: ROOT, commits: [sha(1), sha(2)], truncated: true, createdAt: '2024-05-01T00:00:00Z' }),
    [sample({ ref: UPSTREAM, commits: [sha(1), sha(2), sha(3)], createdAt: '2020-01-01T00:00:00Z' })],
  );
  assert.deepEqual(
    result.observations.map((observation) => observation.relationship),
    ['shares_history_with'],
  );
});

function blob(path: string, id: string, size = 100): GitHubTreeEntry {
  return { path, mode: '100644', type: 'blob', sha: id, size, url: '' };
}

test('blob identity is built from identical git object ids, ignoring paths', () => {
  const index = buildBlobIndex([
    blob('src/a.ts', 'a'.repeat(40)),
    blob('lib/a.ts', 'a'.repeat(40)),
    blob('empty.txt', 'b'.repeat(40), 0),
    { path: 'sub', mode: '040000', type: 'tree', sha: 'c'.repeat(40), url: '' },
    { path: 'vendor/lib', mode: '160000', type: 'commit', sha: 'd'.repeat(40), url: '' },
  ]);
  assert.equal(index.blobCount, 1, 'empty blobs, trees and gitlinks are not content evidence');
  assert.equal(index.paths.get('a'.repeat(40)), 'lib/a.ts', 'the lexicographically smallest path is recorded');
});

test('exact content match produces contains_exact_content_from with full evidence', () => {
  const shared = 'a'.repeat(40);
  const comparison = compareBlobIndexes({
    root: ROOT,
    rootIndex: buildBlobIndex([blob('src/parser.ts', shared), blob('own.ts', 'b'.repeat(40))]),
    rootCommit: sha(1),
    candidate: UPSTREAM,
    candidateIndex: buildBlobIndex([blob('internal/parser.ts', shared), blob('other.ts', 'c'.repeat(40))]),
    candidateCommit: sha(2),
  });
  assert.equal(comparison.sharedBlobCount, 1);
  assert.equal(comparison.observations.length, 1);
  const observation = comparison.observations[0]!;
  assert.equal(observation.relationship, 'contains_exact_content_from');
  assert.equal(observation.evidence.status, 'VERIFIED');
  assert.equal(observation.evidence.type, 'git_blob_identity');
  assert.equal(observation.evidence.data.source_path, 'src/parser.ts');
  assert.equal(observation.evidence.data.target_path, 'internal/parser.ts');
  assert.equal(observation.evidence.data.source_blob, shared);
  assert.match(String(observation.evidence.sourceUrl), /github\.com\/me\/project\/blob/);
});

test('no identical blob means no exact content relationship', () => {
  const comparison = compareBlobIndexes({
    root: ROOT,
    rootIndex: buildBlobIndex([blob('a.ts', 'a'.repeat(40))]),
    rootCommit: sha(1),
    candidate: UPSTREAM,
    candidateIndex: buildBlobIndex([blob('a.ts', 'b'.repeat(40))]),
    candidateCommit: sha(2),
  });
  assert.equal(comparison.sharedBlobCount, 0);
  assert.deepEqual(comparison.observations, []);
});
