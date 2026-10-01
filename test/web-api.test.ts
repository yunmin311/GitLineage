import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../src/web/serve.ts';
import { parseRoute } from '../src/web/server.ts';
import { resolve } from '../src/core/resolver.ts';
import { buildView } from '../src/web/view-model.ts';
import { validateGraph } from '../src/core/validate.ts';
import { GRAPH_SCHEMA_VERSION } from '../src/core/model.ts';
import type { EntityRef, LineageGraph, Observation } from '../src/core/model.ts';

const SUBJECT: EntityRef = { kind: 'repository', provider: 'github', owner: 'me', name: 'project' };
const UPSTREAM: EntityRef = { kind: 'repository', provider: 'github', owner: 'up', name: 'stream' };

/** A canonical graph with real analyzer output shape, produced by the resolver. */
function fixtureGraph(): LineageGraph {
  const observations: Observation[] = [
    {
      collector: 'github-metadata',
      extractor: 'github-fork-metadata@1',
      subject: SUBJECT,
      object: UPSTREAM,
      relationship: 'forked_from',
      directed: true,
      evidence: {
        type: 'github_fork_metadata',
        status: 'VERIFIED',
        repository: SUBJECT,
        sourceUrl: 'https://github.com/up/stream',
        data: { fork: true, source_full_name: 'up/stream', source_url: 'https://github.com/up/stream' },
      },
    },
    {
      collector: 'git-blob-analyzer',
      extractor: 'git-blob-identity@1',
      subject: SUBJECT,
      object: UPSTREAM,
      relationship: 'shares_exact_content_with',
      directed: false,
      evidence: {
        type: 'git_blob_identity',
        status: 'VERIFIED',
        repository: SUBJECT,
        sourceUrl: 'https://github.com/me/project/blob/abc/src/a.ts',
        locator: { path: 'src/a.ts', field: 'b'.repeat(40) },
        data: {
          first_blob: 'b'.repeat(40),
          second_blob: 'b'.repeat(40),
          first_path: 'src/a.ts',
          second_path: 'lib/a.ts',
          direction: 'symmetric: identical content establishes no order of origin',
        },
      },
    },
  ];
  const { graph } = resolve({
    root: SUBJECT,
    observations,
    revision: { commit: 'a'.repeat(40), defaultBranch: 'main', resolvedAt: '2026-01-01T00:00:00.000Z' },
    namespace: 'public',
    extractors: ['github-fork-metadata@1', 'git-blob-identity@1'],
    observedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.ok(validateGraph(graph).valid);
  return graph;
}

async function withServer<T>(fn: (base: string) => Promise<T>, graph?: LineageGraph | null): Promise<T> {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'gitlineage-web-'));
  const { server, url } = await serve({
    port: 0,
    cacheRoot,
    depth: 0,
    maxCandidates: 0,
    enableGit: false,
    enableRegistry: false,
    analyzeOverride: async () => {
      if (graph === null) throw new Error('upstream unavailable');
      return graph ?? fixtureGraph();
    },
  });
  try {
    return await fn(url);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    const { rm } = await import('node:fs/promises');
    await rm(cacheRoot, { recursive: true, force: true });
  }
}

// -------------------------------------------------------------------- routes

test('the /owner/repo route is recognised, so a domain swap needs no routing change', () => {
  assert.deepEqual(parseRoute('/octocat/Spoon-Knife'), { kind: 'client', path: '/owner/repo' });
  assert.deepEqual(parseRoute('/nachocebey/is'), { kind: 'client', path: '/owner/repo' });
  assert.deepEqual(parseRoute('/grpc/grpc/'), { kind: 'client', path: '/owner/repo' });
});

test('api routes are version-stable and explicit', () => {
  assert.deepEqual(parseRoute('/api/graph/octocat/Spoon-Knife'), {
    kind: 'graph',
    repository: { owner: 'octocat', name: 'spoon-knife' },
  });
  assert.deepEqual(parseRoute('/api/view/grpc/grpc'), { kind: 'view', repository: { owner: 'grpc', name: 'grpc' } });
  assert.equal(parseRoute('/healthz').kind, 'health');
  assert.equal(parseRoute('/api/contract').kind, 'contract');
});

test('unknown and malformed routes are rejected', () => {
  for (const path of ['/', '/owner', '/a/b/c', '/api/graph/only-one', '/api/unknown/a/b', '/api/graph/OWNER!/b', '/../../etc/passwd']) {
    assert.equal(parseRoute(path).kind, 'not-found', `expected not-found for ${path}`);
  }
});

// ----------------------------------------------------------------- endpoints

test('GET /api/graph returns the canonical graph unchanged', async () => {
  const expected = fixtureGraph();
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/graph/me/project`);
    assert.equal(response.status, 200);
    const envelope = (await response.json()) as Record<string, any>;
    assert.equal(envelope.ok, true);
    assert.equal(envelope.meta.endpoint, 'canonical-graph');
    // Byte-for-byte the analyzer's output: no view fields, no renaming.
    assert.deepEqual(envelope.data, JSON.parse(JSON.stringify(expected)));
    // And it is still contract-valid after the round trip.
    assert.ok(validateGraph(envelope.data as LineageGraph).valid);
    assert.equal((envelope.data as LineageGraph).schemaVersion, GRAPH_SCHEMA_VERSION);
  }, expected);
});

test('the canonical graph endpoint contains no renderer-specific field', async () => {
  await withServer(async (base) => {
    const envelope = (await (await fetch(`${base}/api/graph/me/project`)).json()) as Record<string, any>;
    const data = envelope.data as LineageGraph & Record<string, unknown>;
    for (const forbidden of ['view', 'layout', 'arrow', 'slot', 'label', 'hiddenRelationshipCount', 'familyCounts']) {
      assert.equal(forbidden in data, false, `canonical graph must not contain ${forbidden}`);
    }
    const relationship = data.relationships[0] as unknown as Record<string, unknown>;
    for (const forbidden of ['arrow', 'arrowheadAt', 'label', 'family', 'slot']) {
      assert.equal(forbidden in relationship, false, `canonical relationship must not contain ${forbidden}`);
    }
  });
});

test('GET /api/view returns the presentation layer derived from the graph', async () => {
  const expected = fixtureGraph();
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/view/me/project`);
    assert.equal(response.status, 200);
    const envelope = (await response.json()) as Record<string, any>;
    assert.equal(envelope.ok, true);
    assert.equal(envelope.meta.endpoint, 'view-model');
    const view = envelope.data;
    assert.deepEqual(view, JSON.parse(JSON.stringify(buildView(expected))));
    assert.equal(view.subject.id, 'repo:github:me/project');
    assert.equal(view.edgeCount, 2);
    // The symmetric edge arrives without an arrow, from the contract.
    const symmetric = view.edges.find((edge: { relationshipType: string }) => edge.relationshipType === 'shares_exact_content_with');
    assert.equal(symmetric.directed, false);
    assert.equal(symmetric.arrow, 'none');
    assert.ok(view.directionContract.symmetric.includes('shares_exact_content_with'));
    // Evidence is present for the drawer.
    assert.ok(view.evidenceByRelationship[symmetric.id].length >= 1);
    assert.equal(view.evidenceByRelationship[symmetric.id][0].data.first_path, 'src/a.ts');
  }, expected);
});

test('the view endpoint never mutates or wraps the canonical graph', async () => {
  const expected = fixtureGraph();
  const before = JSON.stringify(expected);
  await withServer(async (base) => {
    await (await fetch(`${base}/api/view/me/project`)).json();
  }, expected);
  assert.equal(JSON.stringify(expected), before);
});

test('the contract endpoint publishes the direction contract', async () => {
  await withServer(async (base) => {
    const envelope = (await (await fetch(`${base}/api/contract`)).json()) as Record<string, any>;
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.graphSchemaVersion, GRAPH_SCHEMA_VERSION);
    assert.ok(envelope.data.directionContract.directional.includes('forked_from'));
    assert.ok(envelope.data.directionContract.symmetric.includes('shares_exact_content_with'));
    assert.ok(!envelope.data.directionContract.directional.includes('shares_exact_content_with'));
  });
});

test('health reports the schema and analyzer version', async () => {
  await withServer(async (base) => {
    const envelope = (await (await fetch(`${base}/healthz`)).json()) as Record<string, any>;
    assert.equal(envelope.data.status, 'ok');
    assert.equal(envelope.data.graphSchemaVersion, GRAPH_SCHEMA_VERSION);
  });
});

test('an analysis failure is reported as an error envelope, never as a partial graph', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/graph/me/project`);
    assert.equal(response.status, 502);
    const envelope = (await response.json()) as Record<string, any>;
    assert.equal(envelope.ok, false);
    assert.equal(envelope.data, undefined);
    assert.equal(envelope.error.code, 'analysis_failed');
    assert.match(envelope.error.detail, /upstream unavailable/);
  }, null);
});

test('an empty-but-valid graph is an empty state, not an error', async () => {
  const empty = fixtureGraph();
  empty.relationships = [];
  empty.evidence = [];
  await withServer(async (base) => {
    const viewResponse = await fetch(`${base}/api/view/me/project`);
    assert.equal(viewResponse.status, 200);
    const envelope = (await viewResponse.json()) as Record<string, any>;
    assert.equal(envelope.data.empty.isEmpty, true);
    assert.match(envelope.data.empty.reason, /evidence/i);
    assert.equal(envelope.data.edgeCount, 0);
  }, empty);
});

test('a graph that fails its own contract is refused rather than served', async () => {
  const broken = fixtureGraph();
  broken.relationships[0]!.evidenceIds = [];
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/graph/me/project`);
    assert.equal(response.status, 500);
    const envelope = (await response.json()) as Record<string, any>;
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'contract_violation');
  }, broken);
});

test('a stale-schema artifact is refused rather than served', async () => {
  const stale = fixtureGraph();
  stale.schemaVersion = '1.0.0';
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/graph/me/project`);
    assert.equal(response.status, 500);
    const envelope = (await response.json()) as Record<string, any>;
    assert.equal(envelope.error.code, 'contract_violation');
    assert.match(envelope.error.detail, /not supported by this build/);
  }, stale);
});

test('unknown routes return a 404 envelope', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/nope/a/b`);
    assert.equal(response.status, 404);
    const envelope = (await response.json()) as Record<string, any>;
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'not_found');
  });
});

test('an invalid repository reference never reaches analysis', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/graph/graph%2Fowner`);
    // Either rejected by routing or by reference validation; never analysed.
    assert.ok([400, 404].includes(response.status), `unexpected status ${response.status}`);
  });
});

test('the client route serves the SPA shell when a client bundle is present', async () => {
  const clientDir = await mkdtemp(join(tmpdir(), 'gitlineage-client-'));
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(clientDir, 'index.html'), '<!doctype html><title>GitLineage</title>', 'utf8');
  const cacheRoot = await mkdtemp(join(tmpdir(), 'gitlineage-web-'));
  const { server, url } = await serve({
    port: 0,
    cacheRoot,
    clientDir,
    depth: 0,
    maxCandidates: 0,
    enableGit: false,
    enableRegistry: false,
    analyzeOverride: async () => fixtureGraph(),
  });
  try {
    for (const path of ['/nachocebey/is', '/grpc/grpc', '/vitest-dev/vitest']) {
      const response = await fetch(`${url}${path}`);
      assert.equal(response.status, 200, `route ${path} must serve the client shell`);
      assert.match(response.headers.get('content-type') ?? '', /text\/html/);
      const body = await response.text();
      assert.match(body, /GitLineage/);
    }
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    const { rm } = await import('node:fs/promises');
    await rm(clientDir, { recursive: true, force: true });
    await rm(cacheRoot, { recursive: true, force: true });
  }
});