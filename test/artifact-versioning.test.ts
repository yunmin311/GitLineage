import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GRAPH_SCHEMA_VERSION, SUPPORTED_GRAPH_SCHEMA_VERSIONS } from '../src/core/model.ts';
import { validateGraph } from '../src/core/validate.ts';
import { Cache } from '../src/platform/cache.ts';
import { graphArtifactPaths } from '../src/platform/git.ts';
import { AnalysisCache, StaleArtifactError } from '../src/pipeline/cached-analyze.ts';
import type { LineageGraph } from '../src/core/model.ts';

const REPO = { provider: 'github', owner: 'me', name: 'project' } as const;

function minimalGraph(schemaVersion = GRAPH_SCHEMA_VERSION): LineageGraph {
  return {
    schemaVersion,
    graph: {
      rootEntityId: 'repo:github:me/project',
      provider: 'github',
      revision: { commit: 'a'.repeat(40), resolvedAt: '2026-01-01T00:00:00.000Z' },
      generatedAt: '2026-01-01T00:00:00.000Z',
      analyzer: {
        name: 'gitlineage-analyzer',
        version: '0.2.0',
        schemaVersion,
        namespace: 'public',
        extractors: [],
        adapters: [],
        limitsApplied: {},
      },
    },
    entities: [
      { id: 'repo:github:me/project', type: 'Repository', display: { name: 'project', fullName: 'me/project' }, attributes: {} },
      { id: 'repo:github:up/stream', type: 'Repository', display: { name: 'stream', fullName: 'up/stream' }, attributes: {} },
    ],
    relationships: [
      {
        id: 'rel_0123456789abcdef',
        type: 'forked_from',
        source: 'repo:github:me/project',
        target: 'repo:github:up/stream',
        directed: true,
        status: 'VERIFIED',
        evidenceIds: ['ev_0123456789abcdef'],
        attributes: {},
      },
    ],
    evidence: [
      {
        id: 'ev_0123456789abcdef',
        type: 'github_fork_metadata',
        status: 'VERIFIED',
        collector: 'github-metadata',
        extractor: 'github-fork-metadata@1',
        data: { fork: true, source_full_name: 'up/stream', source_url: 'https://github.com/up/stream' },
        observedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    diagnostics: [],
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'gitlineage-cache-'));
  try {
    return await fn(dir);
  } finally {
    const { rm } = await import('node:fs/promises');
    await rm(dir, { recursive: true, force: true });
  }
}

test('the schema version was bumped for the breaking rename', () => {
  assert.equal(GRAPH_SCHEMA_VERSION, '2.0.0');
  assert.notEqual(GRAPH_SCHEMA_VERSION, '1.0.0');
  assert.deepEqual([...SUPPORTED_GRAPH_SCHEMA_VERSIONS], [GRAPH_SCHEMA_VERSION]);
});

test('a 1.x artifact is rejected by validateGraph', () => {
  const stale = minimalGraph('1.0.0');
  const result = validateGraph(stale);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.includes('not supported by this build')),
    'the version error must be explicit',
  );
  assert.ok(result.errors.some((error) => error.includes('regenerated')));
});

test('a 1.x artifact that still contains the removed relationship is doubly invalid', () => {
  const stale = minimalGraph('1.0.0');
  stale.relationships[0]!.type = 'contains_exact_content_from' as never;
  stale.evidence[0]!.data = {
    fork: true,
    source_full_name: 'up/stream',
    source_url: 'https://github.com/up/stream',
    source_blob: 'b'.repeat(40),
    target_blob: 'b'.repeat(40),
    source_path: 'a.ts',
    target_path: 'b.ts',
  };
  const errors = validateGraph(stale).errors;
  assert.ok(errors.some((error) => error.includes('not supported by this build')));
  assert.ok(errors.some((error) => error.includes('unknown type')));
});

test('the artifact path contains the contract version', () => {
  const cache = new Cache('/tmp/cache', 'public');
  const commit = 'abcdef1234567890';
  const paths = graphArtifactPaths(cache, REPO, commit, 'public');
  assert.ok(paths.graph.includes(`v${GRAPH_SCHEMA_VERSION}`), `expected version in path: ${paths.graph}`);
  assert.ok(paths.graph.includes(commit.slice(0, 12)), 'the revision must be part of the key');
  assert.ok(paths.graph.includes('me'), 'the repository identity must be part of the key');
  assert.ok(paths.graph.includes('public'), 'the namespace must be part of the path');
});

test('a cache written by one schema version is invisible to another', async () => {
  await withTempDir(async (dir) => {
    const cache = new Cache(dir, 'public');
    const commit = 'a'.repeat(40);
    const v1 = graphArtifactPaths(cache, REPO, commit, 'public').directory.replace(`v${GRAPH_SCHEMA_VERSION}`, 'v1.0.0');
    await mkdir(v1, { recursive: true });
    await writeFile(join(v1, 'graph.json'), JSON.stringify(minimalGraph('1.0.0')), 'utf8');

    const analysis = new AnalysisCache(dir, 'public');
    const found = await analysis.read(REPO, commit);
    assert.equal(found, null, 'a 1.x artifact must never be served under the 2.x contract');
  });
});

test('an artifact whose stored version disagrees is discarded, not served', async () => {
  await withTempDir(async (dir) => {
    const cache = new Cache(dir, 'public');
    const commit = 'a'.repeat(40);
    // Write a 1.x graph at the *correct* 2.x path: the version check must still
    // reject it, so a wrong path can never launder a stale artifact.
    const paths = graphArtifactPaths(cache, REPO, commit, 'public');
    await mkdir(paths.directory, { recursive: true });
    await writeFile(paths.graph, JSON.stringify(minimalGraph('1.0.0')), 'utf8');

    const analysis = new AnalysisCache(dir, 'public');
    assert.equal(await analysis.read(REPO, commit), null);
  });
});

test('a corrupted artifact is discarded rather than served', async () => {
  await withTempDir(async (dir) => {
    const cache = new Cache(dir, 'public');
    const commit = 'a'.repeat(40);
    const paths = graphArtifactPaths(cache, REPO, commit, 'public');
    await mkdir(paths.directory, { recursive: true });
    const tampered = minimalGraph();
    tampered.relationships[0]!.evidenceIds = [];
    await writeFile(paths.graph, JSON.stringify(tampered), 'utf8');

    const analysis = new AnalysisCache(dir, 'public');
    assert.equal(await analysis.read(REPO, commit), null, 'a graph with no evidence must not be served');
  });
});

test('a valid current artifact round-trips through the cache', async () => {
  await withTempDir(async (dir) => {
    const analysis = new AnalysisCache(dir, 'public');
    const commit = 'a'.repeat(40);
    const graph = minimalGraph();
    const written = await analysis.store(REPO, commit, graph);
    assert.ok(written.includes(`v${GRAPH_SCHEMA_VERSION}`));
    const read = await analysis.read(REPO, commit);
    assert.ok(read);
    assert.deepEqual(read, graph);
    assert.equal(validateGraph(read!).valid, true);
  });
});

test('the cache is per-repository and per-revision', async () => {
  await withTempDir(async (dir) => {
    const analysis = new AnalysisCache(dir, 'public');
    const a = 'a'.repeat(40);
    const b = 'b'.repeat(40);
    await analysis.store(REPO, a, minimalGraph());
    assert.ok(await analysis.read(REPO, a));
    assert.equal(await analysis.read(REPO, b), null, 'a different revision must not hit');
    assert.equal(
      await analysis.read({ provider: 'github', owner: 'other', name: 'project' }, a),
      null,
      'a different repository must not hit',
    );
  });
});

test('StaleArtifactError names both versions', () => {
  const error = new StaleArtifactError('/tmp/x/graph.json', '1.0.0', GRAPH_SCHEMA_VERSION);
  assert.equal(error.found, '1.0.0');
  assert.equal(error.expected, GRAPH_SCHEMA_VERSION);
  assert.match(error.message, /1\.0\.0/);
  assert.match(error.message, /2\.0\.0/);
});

test('the private namespace is refused before any storage is created', async () => {
  await withTempDir(async (dir) => {
    assert.throws(() => new AnalysisCache(dir, 'private'), /not implemented in V1/);
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual(await readdir(dir), []);
  });
});