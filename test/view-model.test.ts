import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildView } from '../src/web/view-model.ts';
import { resolve } from '../src/core/resolver.ts';
import { SYMMETRIC_RELATIONSHIPS, DIRECTIONAL_RELATIONSHIPS } from '../src/core/ontology.ts';
import { GRAPH_SCHEMA_VERSION } from '../src/core/model.ts';
import type { EntityRef, LineageGraph, Observation, RelationshipType } from '../src/core/model.ts';

const SUBJECT: EntityRef = { kind: 'repository', provider: 'github', owner: 'me', name: 'project' };
const UPSTREAM: EntityRef = { kind: 'repository', provider: 'github', owner: 'up', name: 'stream' };
const DOWNSTREAM: EntityRef = { kind: 'repository', provider: 'github', owner: 'down', name: 'fork' };

function graphOf(observations: Observation[], root: EntityRef = SUBJECT): LineageGraph {
  const { graph } = resolve({
    root,
    observations,
    revision: { commit: 'a'.repeat(40), resolvedAt: '2026-01-01T00:00:00.000Z' },
    namespace: 'public',
    extractors: ['test@1'],
    observedAt: '2026-01-01T00:00:00.000Z',
  });
  return graph;
}

const blobEvidence = {
  type: 'git_blob_identity' as const,
  status: 'VERIFIED' as const,
  data: { first_blob: 'b'.repeat(40), second_blob: 'b'.repeat(40), first_path: 'a.ts', second_path: 'b.ts' },
};

// ------------------------------------------------------------ direction rules

test('the view never invents an arrow for a symmetric relationship', () => {
  const graph = graphOf([
    {
      collector: 'git-blob-analyzer',
      extractor: 'git-blob-identity@1',
      subject: SUBJECT,
      object: UPSTREAM,
      relationship: 'shares_exact_content_with',
      directed: false,
      evidence: blobEvidence,
    },
  ]);
  const view = buildView(graph);
  const edge = view.edges.find((item) => item.relationshipType === 'shares_exact_content_with');
  assert.ok(edge);
  assert.equal(edge.directed, false);
  assert.equal(edge.arrow, 'none');
  assert.equal(edge.arrowheadAt, undefined, 'a symmetric edge must not carry an arrowhead anchor');
});

test('every symmetric type produces arrow none, every directional type produces an arrow', () => {
  const cases: [RelationshipType, EntityRef, Observation['evidence']][] = [
    ['shares_exact_content_with', UPSTREAM, blobEvidence],
    [
      'shares_history_with',
      UPSTREAM,
      {
        type: 'git_shared_commits',
        status: 'VERIFIED',
        data: { shared_commit_count: 3, shared_commit_samples: ['c'.repeat(40)], sampled_commit_count: 10 },
      },
    ],
    [
      'similar_to',
      UPSTREAM,
      {
        type: 'token_fingerprint',
        status: 'DETECTED',
        data: { algorithm: 'token_fingerprint', source_path: 'a', target_path: 'b', similarity: 0.8 },
      },
    ],
    [
      'forked_from',
      UPSTREAM,
      { type: 'github_fork_metadata', status: 'VERIFIED', data: { fork: true, source_full_name: 'up/stream', source_url: 'https://github.com/up/stream' } },
    ],
  ];

  for (const [type, object, evidence] of cases) {
    const graph = graphOf([
      {
        collector: 'test',
        extractor: 'test@1',
        subject: SUBJECT,
        object,
        relationship: type,
        directed: !SYMMETRIC_RELATIONSHIPS.includes(type),
        evidence,
      },
    ]);
    const view = buildView(graph);
    const edge = view.edges[0]!;
    const symmetric = SYMMETRIC_RELATIONSHIPS.includes(type);
    assert.equal(edge.directed, !symmetric, `${type} directed flag`);
    assert.equal(edge.arrow === 'none', symmetric, `${type} arrow`);
  }
});

test('arrow direction is unchanged when the subject is the target instead of the source', () => {
  // Case A: the analysed repository is the fork SOURCE.
  //   subject --forked_from--> upstream
  // Case B: the analysed repository is the fork TARGET, i.e. something forked it.
  //   upstream --forked_from--> subject
  // Both must arrow at the canonical target. Only the wording and the slot move.
  const asSource = buildView(
    graphOf([
      {
        collector: 'test',
        extractor: 'test@1',
        subject: SUBJECT,
        object: UPSTREAM,
        relationship: 'forked_from',
        directed: true,
        evidence: { type: 'github_fork_metadata', status: 'VERIFIED', data: { fork: true, source_full_name: 'up/stream', source_url: 'https://github.com/up/stream' } },
      },
    ]),
  );
  const asTarget = buildView(
    graphOf([
      {
        collector: 'test',
        extractor: 'test@1',
        subject: UPSTREAM,
        object: SUBJECT,
        relationship: 'forked_from',
        directed: true,
        evidence: { type: 'github_fork_metadata', status: 'VERIFIED', data: { fork: true, source_full_name: 'me/project', source_url: 'https://github.com/me/project' } },
      },
    ], SUBJECT),
  );

  const sourceEdge = asSource.edges[0]!;
  const targetEdge = asTarget.edges[0]!;

  // Same relationship semantics in both cases.
  assert.equal(sourceEdge.arrow, 'end');
  assert.equal(targetEdge.arrow, 'end');
  assert.equal(sourceEdge.arrowheadAt, sourceEdge.target);
  assert.equal(targetEdge.arrowheadAt, targetEdge.target);
  assert.equal(sourceEdge.arrowheadAt, 'repo:github:up/stream');
  assert.equal(targetEdge.arrowheadAt, 'repo:github:me/project');

  // Wording and placement adapt to the viewpoint; the arrow does not.
  assert.equal(sourceEdge.subjectRole, 'outbound');
  assert.equal(targetEdge.subjectRole, 'inbound');
  assert.equal(sourceEdge.label, 'fork source');
  assert.equal(targetEdge.label, 'forked from');
  assert.equal(
    asSource.nodes.find((node) => node.id === 'repo:github:up/stream')?.slot,
    'downstream',
    'what the subject forked from sits below it',
  );
  assert.equal(
    asTarget.nodes.find((node) => node.id === 'repo:github:up/stream')?.slot,
    'upstream',
    'the repository that forked the subject is provenance arriving from above',
  );
});

test('depends_on keeps a weaker arrow but is still arrowed', () => {
  const graph = graphOf([
    {
      collector: 'packages',
      extractor: 'manifest-dependency@1',
      subject: SUBJECT,
      object: { kind: 'package', ecosystem: 'npm', name: 'left-pad' },
      relationship: 'depends_on',
      directed: true,
      evidence: { type: 'package_manifest', status: 'DECLARED', data: { ecosystem: 'npm', package_name: 'left-pad', range: '^1.0.0', manifest_path: 'package.json' } },
    },
  ]);
  const edge = buildView(graph).edges[0]!;
  assert.equal(edge.arrow, 'end-weak');
  assert.equal(edge.family, 'dependency');
});

// ------------------------------------------------------------- layout slots

test('layout slots come from edge semantics, not endpoint order', () => {
  const graph = graphOf([
    {
      collector: 'github',
      extractor: 'fork@1',
      // The upstream repository is the one that forked the subject.
      subject: UPSTREAM,
      object: SUBJECT,
      relationship: 'forked_from',
      directed: true,
      evidence: { type: 'github_fork_metadata', status: 'VERIFIED', data: { fork: true, source_full_name: 'me/project', source_url: 'u' } },
    },
    {
      collector: 'git',
      extractor: 'hist@1',
      subject: SUBJECT,
      object: DOWNSTREAM,
      relationship: 'shares_history_with',
      directed: false,
      evidence: { type: 'git_shared_commits', status: 'VERIFIED', data: { shared_commit_count: 2, shared_commit_samples: ['a'.repeat(40)], sampled_commit_count: 5 } },
    },
    {
      collector: 'docs',
      extractor: 'attr@1',
      subject: SUBJECT,
      object: { kind: 'repository', provider: 'github', owner: 'insp', name: 'ration' },
      relationship: 'declared_inspiration',
      directed: true,
      evidence: { type: 'document_attribution', status: 'DECLARED', data: { phrase: 'inspired by', matched_text: 'Inspired by insp/ration', path: 'README.md' } },
    },
  ]);
  const view = buildView(graph);
  const slotOf = (id: string) => view.nodes.find((node) => node.id === id)?.slot;
  assert.equal(slotOf('repo:github:up/stream'), 'upstream', 'provenance arriving at the subject sits above');
  assert.equal(slotOf('repo:github:down/fork'), 'shared-near', 'a symmetric peer has no vertical slot');
  assert.equal(slotOf('repo:github:insp/ration'), 'attribution-far');
  assert.equal(view.subject.slot, 'subject');
});

test('a downstream fork sits below the subject, not above', () => {
  const graph = graphOf([
    {
      collector: 'github',
      extractor: 'fork@1',
      subject: SUBJECT,
      object: UPSTREAM,
      relationship: 'forked_from',
      directed: true,
      evidence: { type: 'github_fork_metadata', status: 'VERIFIED', data: { fork: true, source_full_name: 'up/stream', source_url: 'u' } },
    },
  ]);
  // The upstream is the target, so the subject is the source: "fork source".
  const edge = buildView(graph).edges[0]!;
  assert.equal(edge.subjectRole, 'outbound');
  assert.equal(
    view_slotOf(graph, 'repo:github:up/stream'),
    'downstream',
    'a node the subject forked *from* still sits below; provenance arrives from above only when the edge points at the subject',
  );
});

function view_slotOf(graph: LineageGraph, id: string): string | undefined {
  return buildView(graph).nodes.find((node) => node.id === id)?.slot;
}

// ------------------------------------------------------------ evidence data

test('the drawer receives the real evidence records, unaltered', () => {
  const graph = graphOf([
    {
      collector: 'documents',
      extractor: 'explicit-attribution@1',
      subject: SUBJECT,
      object: UPSTREAM,
      relationship: 'declared_inspiration',
      directed: true,
      evidence: {
        type: 'document_attribution',
        status: 'DECLARED',
        repository: { kind: 'repository', provider: 'github', owner: 'me', name: 'project' },
        sourceUrl: 'https://github.com/me/project/blob/abc/README.md',
        locator: { path: 'README.md', lineStart: 41, lineEnd: 42 },
        observedText: 'Inspired by up/stream',
        data: { phrase: 'inspired by', matched_text: 'Inspired by up/stream', path: 'README.md' },
      },
    },
  ]);
  const view = buildView(graph);
  const edge = view.edges[0]!;
  const cards = view.evidenceByRelationship[edge.id]!;
  assert.equal(cards.length, 1);
  const card = cards[0]!;
  assert.equal(card.type, 'document_attribution');
  assert.equal(card.status, 'DECLARED');
  assert.equal(card.observedText, 'Inspired by up/stream');
  assert.equal(card.locator, 'README.md:41-42');
  assert.equal(card.sourceUrl, 'https://github.com/me/project/blob/abc/README.md');
  assert.equal(card.data.phrase, 'inspired by');
  // The underlying evidence record must be untouched.
  const original = graph.evidence.find((record) => record.id === edge.evidenceIds[0])!;
  assert.equal(original.observedText, 'Inspired by up/stream');
});

test('the view adds no field to the canonical graph', () => {
  const graph = graphOf([
    {
      collector: 'test',
      extractor: 't@1',
      subject: SUBJECT,
      object: UPSTREAM,
      relationship: 'forked_from',
      directed: true,
      evidence: { type: 'github_fork_metadata', status: 'VERIFIED', data: { fork: true, source_full_name: 'up/stream', source_url: 'u' } },
    },
  ]);
  const before = JSON.stringify(graph);
  buildView(graph);
  assert.equal(JSON.stringify(graph), before, 'buildView must not mutate the canonical graph');
});

test('the view only shows one hop and counts the rest', () => {
  const graph = graphOf([
    {
      collector: 'github',
      extractor: 'fork@1',
      subject: SUBJECT,
      object: UPSTREAM,
      relationship: 'forked_from',
      directed: true,
      evidence: { type: 'github_fork_metadata', status: 'VERIFIED', data: { fork: true, source_full_name: 'up/stream', source_url: 'u' } },
    },
    {
      collector: 'github',
      extractor: 'fork@1',
      subject: UPSTREAM,
      object: { kind: 'repository', provider: 'github', owner: 'far', name: 'away' },
      relationship: 'forked_from',
      directed: true,
      evidence: { type: 'github_fork_metadata', status: 'VERIFIED', data: { fork: true, source_full_name: 'far/away', source_url: 'f' } },
    },
  ]);
  const view = buildView(graph);
  assert.equal(view.edges.length, 1);
  assert.equal(view.hiddenRelationshipCount, 1);
  assert.equal(view.partial.isPartial, true);
  assert.equal(view.nodes.some((node) => node.id === 'repo:github:far/away'), false);
});

// ----------------------------------------------------------------- counting

test('status and family counts cover every shown edge', () => {
  const graph = graphOf([
    {
      collector: 'test',
      extractor: 't@1',
      subject: SUBJECT,
      object: UPSTREAM,
      relationship: 'forked_from',
      directed: true,
      evidence: { type: 'github_fork_metadata', status: 'VERIFIED', data: { fork: true, source_full_name: 'up/stream', source_url: 'u' } },
    },
    {
      collector: 'test',
      extractor: 't@1',
      subject: SUBJECT,
      object: { kind: 'package', ecosystem: 'npm', name: 'react' },
      relationship: 'depends_on',
      directed: true,
      evidence: { type: 'package_manifest', status: 'DECLARED', data: { ecosystem: 'npm', package_name: 'react', range: '^19', manifest_path: 'package.json' } },
    },
    {
      collector: 'test',
      extractor: 't@1',
      subject: SUBJECT,
      object: DOWNSTREAM,
      relationship: 'shares_exact_content_with',
      directed: false,
      evidence: blobEvidence,
    },
  ]);
  const view = buildView(graph);
  const total = view.statusCounts.VERIFIED + view.statusCounts.DECLARED + view.statusCounts.DETECTED;
  assert.equal(total, view.edges.length);
  const families = Object.values(view.familyCounts).reduce((sum, value) => sum + value, 0);
  assert.equal(families, view.edges.length);
});

test('an empty graph produces an empty state, not an error', () => {
  const view = buildView(graphOf([]));
  assert.equal(view.empty.isEmpty, true);
  assert.match(view.empty.reason, /evidence/i);
  assert.equal(view.edges.length, 0);
});

test('the view carries the direction contract for the renderer', () => {
  const view = buildView(graphOf([]));
  assert.deepEqual([...view.directionContract.directional].sort(), [...DIRECTIONAL_RELATIONSHIPS].sort());
  assert.deepEqual([...view.directionContract.symmetric].sort(), [...SYMMETRIC_RELATIONSHIPS].sort());
});

test('the view propagates the canonical schema version', () => {
  assert.equal(buildView(graphOf([])).schemaVersion, GRAPH_SCHEMA_VERSION);
});