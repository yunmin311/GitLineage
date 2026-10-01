/**
 * Client logic tests.
 *
 * The client is deliberately split into pure modules so the behaviour that must
 * not drift — URL contract, layout, arrow placement, search, layer filtering —
 * is testable without a DOM. These tests are the guard for the two hard rules:
 * arrow direction comes from the contract, and the URL is a complete shareable
 * description of the view.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseRepositoryPath,
  resolveRepositoryInput,
  repositoryPath,
  readViewState,
  writeViewState,
  parseLayerState,
  serializeLayerState,
  isDefaultLayerState,
  LAYER_KEYS,
  DEFAULT_LAYER_STATE,
} from '../src/web/client/lib/url-state.mjs';
import {
  layoutGraph,
  edgeGeometry,
  fanSlot,
  nodeDegrees,
  isCrowdedEdge,
  fitViewBox,
  zoomViewBox,
  contentBounds,
  NODE_W,
  NODE_H,
} from '../src/web/client/lib/geometry.mjs';
import {
  allLayersOn,
  searchNodes,
  searchEdges,
  edgesForNode,
  visibleEdges,
  layerCount,
} from '../src/web/client/lib/search.mjs';
import { evidenceSourceUrl, SIMILARITY_DISCLAIMER } from '../src/web/client/lib/evidence-links.mjs';
import type { ViewEdge, ViewGraph, ViewNode } from '../src/web/view-model.ts';

/** Fails loudly instead of yielding `undefined` and failing three lines later. */
function edgeById(view: ViewGraph, id: string): ViewEdge {
  const edge = view.edges.find((item) => item.id === id);
  assert.ok(edge, `fixture is missing edge ${id}`);
  return edge;
}

function positionOf(view: ViewGraph, id: string): { x: number; y: number } {
  const positions = layoutGraph(view, view.edges);
  const position = positions.get(id);
  assert.ok(position, `fixture is missing a positioned node ${id}`);
  return position;
}

// --------------------------------------------------------------- url contract

test('parseRepositoryPath reads /owner/repo and rejects everything else', () => {
  assert.deepEqual(parseRepositoryPath('/nachocebey/is'), { owner: 'nachocebey', name: 'is' });
  assert.deepEqual(parseRepositoryPath('/grpc/grpc/'), { owner: 'grpc', name: 'grpc' });
  // Deep links from GitHub are not the primary route; only `/owner/repo` is.
  assert.equal(parseRepositoryPath('/vitest-dev/vitest/tree/main'), null);
  assert.equal(parseRepositoryPath('/'), null);
  assert.equal(parseRepositoryPath(''), null);
  assert.equal(parseRepositoryPath('/owner'), null);
  assert.equal(parseRepositoryPath('/a/b/c/d/e'), null);
});

test('parseRepositoryPath normalises case, because GitHub is case-insensitive', () => {
  assert.deepEqual(parseRepositoryPath('/OctoCat/Spoon-Knife'), {
    owner: 'octocat',
    name: 'spoon-knife',
  });
});

test('repositoryPath encodes and never adds a trailing slash', () => {
  assert.equal(repositoryPath({ owner: 'octocat', name: 'Hello-World' }), '/octocat/Hello-World');
});

test('resolveRepositoryInput accepts shorthand, paths and GitHub URLs', () => {
  // Input case is normalised away, so one repository has exactly one canonical
  // URL and one cache key regardless of how it was typed.
  assert.deepEqual(resolveRepositoryInput('octocat/Spoon-Knife'), {
    owner: 'octocat',
    name: 'spoon-knife',
  });
  assert.deepEqual(resolveRepositoryInput('  github.com/OctoCat/Spoon-Knife.git '), {
    owner: 'octocat',
    name: 'spoon-knife',
  });
  assert.deepEqual(resolveRepositoryInput('https://github.com/octocat/Spoon-Knife'), {
    owner: 'octocat',
    name: 'spoon-knife',
  });
  assert.deepEqual(resolveRepositoryInput('https://github.com/octocat/Spoon-Knife/tree/main'), {
    owner: 'octocat',
    name: 'spoon-knife',
  });
  assert.deepEqual(resolveRepositoryInput('github:octocat/Spoon-Knife'), {
    owner: 'octocat',
    name: 'spoon-knife',
  });
  // Not a repository: rejected rather than guessed at.
  assert.equal(resolveRepositoryInput(''), null);
  assert.equal(resolveRepositoryInput('nope'), null);
  assert.equal(resolveRepositoryInput('https://evil.example/a/b'), null);
});

test('view state round-trips so a shared link reproduces the view', () => {
  const state = {
    edge: 'rel-3',
    node: '',
    layers: 'ancestry,dependency',
    search: 'axios',
    bundles: 'k1,k2',
    depth: '80',
  };
  const query = writeViewState(state);
  const back = readViewState(query);
  assert.equal(back.edge, 'rel-3');
  assert.equal(back.node, '');
  assert.equal(back.search, 'axios');
  assert.equal(back.bundles, 'k1,k2');
  assert.equal(back.depth, '80');
  assert.equal(parseLayerState(back.layers).ancestry, true);
  assert.equal(parseLayerState(back.layers).attribution, false);
});

test('writeViewState omits defaults instead of writing empty parameters', () => {
  assert.equal(writeViewState({}), '');
  assert.equal(
    writeViewState({ layers: DEFAULT_LAYER_STATE }),
    '',
    'an all-on layer set is the default and must not appear in the URL',
  );
  assert.equal(writeViewState({ edge: 'rel-1' }), '?edge=rel-1');
  assert.equal(writeViewState({ depth: '200' }), '', 'the default depth is not written');
});

test('readViewState rejects a depth that is not a small integer', () => {
  assert.equal(readViewState('?depth=abc').depth, '');
  assert.equal(readViewState('?depth=-5').depth, '');
  assert.equal(readViewState('?depth=9999999').depth, '');
  assert.equal(readViewState('?depth=600').depth, '600');
});

test('readViewState tolerates junk and hostile input', () => {
  const back = readViewState('?edge=%3Cscript%3E&q=&depth=abc&layers=');
  assert.equal(back.edge, '<script>');
  assert.equal(back.search, '');
  assert.equal(back.depth, '');
  assert.equal(back.layers, '');
});

test('layer state serialises only the layers that are off, in canonical order', () => {
  const layers = { ...allLayersOn(), similarity: false };
  assert.equal(serializeLayerState(layers), 'ancestry,dependency,attribution,source-identity');
  assert.equal(isDefaultLayerState(allLayersOn()), true);
  assert.equal(isDefaultLayerState(layers), false);
  // Key order in the source object must not change the URL.
  const shuffled = { similarity: false, dependency: true, ancestry: true, attribution: true, 'source-identity': true };
  assert.equal(serializeLayerState(shuffled), 'ancestry,dependency,attribution,source-identity');
  assert.deepEqual(LAYER_KEYS, ['ancestry', 'dependency', 'attribution', 'source-identity', 'similarity']);
  assert.equal(parseLayerState('ancestry').ancestry, true);
  assert.equal(parseLayerState('ancestry').dependency, false);
});

// ------------------------------------------------------------------ fixtures

/**
 * A faithful `/api/view` payload, typed as `ViewGraph` so a contract change
 * breaks this file rather than the browser.
 *
 * The arrow fields are the important part: `directed` and `arrow` come straight
 * from `relationship.directed`, so a symmetric edge carries `arrow: 'none'` even
 * though the subject happens to be its source.
 */
const subjectNode: ViewNode = {
  id: 'repo:nachocebey/is',
  type: 'Repository',
  slot: 'subject',
  label: 'nachocebey/is',
  owner: 'nachocebey',
  name: 'is',
  url: 'https://github.com/nachocebey/is',
  fact: 'main · MIT',
  isSubject: true,
  isPackage: false,
  outboundRelationshipIds: ['rel-1'],
  inboundRelationshipIds: ['rel-2'],
  peerRelationshipIds: ['rel-3'],
};

const view: ViewGraph = {
  schemaVersion: '2.0.0',
  analyzer: { name: 'gitlineage', version: '0.2.0', schemaVersion: '2.0.0', extractors: [], adapters: [] },
  revision: {
    commit: 'a'.repeat(40),
    shortCommit: 'aaaaaaa',
    ref: 'main',
    defaultBranch: 'main',
    analyzedAt: '2026-02-01T10:00:00.000Z',
  },
  subject: subjectNode,
  familyCounts: { ancestry: 1, dependency: 1, attribution: 0, 'source-identity': 1, similarity: 0 },
  edgeCount: 3,
  hiddenRelationshipCount: 0,
  bundledEdgeCount: 0,
  primaryEdgeCount: 3,
  statusCounts: { VERIFIED: 1, DECLARED: 1, DETECTED: 1 },
  directionContract: {
    directional: [
      'forked_from',
      'derived_from',
      'evolved_into',
      'depends_on',
      'uses_submodule',
      'declared_inspiration',
      'references',
    ],
    symmetric: ['shares_history_with', 'shares_exact_content_with', 'similar_to'],
  },
  partial: { isPartial: false, notes: [] },
  empty: { isEmpty: false, reason: '' },
  nodes: [
    subjectNode,
    {
      id: 'pkg:npm/axios',
      type: 'Package',
      slot: 'dependency',
      label: 'axios',
      fact: 'npm',
      isSubject: false,
      isPackage: true,
      outboundRelationshipIds: [],
      inboundRelationshipIds: ['rel-1'],
      peerRelationshipIds: [],
    },
    {
      id: 'repo:someone/fork-is',
      type: 'Repository',
      slot: 'upstream',
      label: 'someone/fork-is',
      owner: 'someone',
      name: 'fork-is',
      fact: 'fork',
      isSubject: false,
      isPackage: false,
      outboundRelationshipIds: ['rel-2'],
      inboundRelationshipIds: ['rel-3'],
      peerRelationshipIds: [],
    },
  ],
  edges: [
    {
      id: 'rel-1',
      relationshipType: 'depends_on',
      family: 'dependency',
      status: 'DECLARED',
      directed: true,
      arrow: 'end-weak',
      arrowheadAt: 'pkg:npm/axios',
      source: 'repo:nachocebey/is',
      target: 'pkg:npm/axios',
      label: 'depends on',
      relationLabel: 'depends on',
      subjectRole: 'outbound',
      visibility: 'primary',
      evidenceCount: 1,
      evidenceIds: ['ev-1'],
      evidenceTruncated: false,
      badge: '1.4.3',
    },
    {
      id: 'rel-2',
      relationshipType: 'forked_from',
      family: 'ancestry',
      status: 'VERIFIED',
      directed: true,
      arrow: 'end',
      arrowheadAt: 'repo:nachocebey/is',
      source: 'repo:someone/fork-is',
      target: 'repo:nachocebey/is',
      label: 'forked from',
      relationLabel: 'forked from',
      subjectRole: 'inbound',
      visibility: 'primary',
      evidenceCount: 1,
      evidenceIds: ['ev-2'],
      evidenceTruncated: false,
      badge: undefined,
    },
    {
      id: 'rel-3',
      relationshipType: 'shares_exact_content_with',
      family: 'source-identity',
      status: 'DETECTED',
      directed: false,
      arrow: 'none',
      source: 'repo:nachocebey/is',
      target: 'repo:someone/fork-is',
      label: 'identical content',
      relationLabel: 'shares exact content with',
      subjectRole: 'peer',
      visibility: 'primary',
      evidenceCount: 2,
      evidenceIds: ['ev-3', 'ev-4'],
      evidenceTruncated: false,
      badge: '×3 blobs',
    },
  ],
  bundles: [],
  evidenceByRelationship: {
    'rel-1': [
      {
        id: 'ev-1',
        type: 'package_manifest',
        status: 'DECLARED',
        collector: 'manifest',
        extractor: 'npm-dependency',
        repository: 'nachocebey/is',
        sourceUrl: 'https://github.com/nachocebey/is/blob/aaaaaaa/package.json',
        locator: 'package.json:32',
        observedText: '"axios": "1.4.3"',
        data: { manifest_path: 'package.json', relationship_semantics: 'composition' },
        observedAt: '2026-02-01T10:00:00.000Z',
      },
    ],
  },
};

// ------------------------------------------------------------------- geometry

test('layout places the subject at the origin and keeps every connected node placed', () => {
  const positions = layoutGraph(view, view.edges);
  assert.equal(positions.size, 3);
  const subject = positionOf(view, view.subject.id);
  assert.equal(subject.x, 470);
  assert.equal(subject.y, 300);
  for (const [id, position] of positions) {
    assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y), `${id} has a real position`);
  }
  // Deterministic: the same input must produce the same picture.
  const again = layoutGraph(view, view.edges);
  assert.deepEqual([...again.entries()], [...positions.entries()]);
});

test('layout honours the slot the view-model assigned', () => {
  const positions = layoutGraph(view, view.edges);
  const subject = positions.get(view.subject.id)!;
  const upstream = positions.get('repo:someone/fork-is')!;
  const dependency = positions.get('pkg:npm/axios')!;
  // `upstream` sits above the subject, `dependency` below and to the right.
  assert.equal(upstream.x, subject.x);
  assert.ok(upstream.y < subject.y, 'upstream is above');
  assert.ok(dependency.y > subject.y, 'dependency is below');
  assert.ok(dependency.x > subject.x, 'dependency is offset right');
});

/** Asserts no two node rectangles overlap, which is what makes labels readable. */
function assertNoOverlap(positions: Map<string, { x: number; y: number }>, context: string): void {
  const boxes = [...positions.entries()].map(([id, p]) => ({
    id,
    left: p.x - NODE_W / 2,
    right: p.x + NODE_W / 2,
    top: p.y - NODE_H / 2,
    bottom: p.y + NODE_H / 2,
  }));
  for (let a = 0; a < boxes.length; a += 1) {
    for (let b = a + 1; b < boxes.length; b += 1) {
      const one = boxes[a]!;
      const two = boxes[b]!;
      const overlapX = one.left < two.right && two.left < one.right;
      const overlapY = one.top < two.bottom && two.top < one.bottom;
      assert.ok(!(overlapX && overlapY), `${context}: ${one.id} overlaps ${two.id}`);
    }
  }
}

/** Builds a view with `count` peers in the `dependency` slot, like a submodule hub. */
function hubView(count: number): ViewGraph {
  const peers = Array.from({ length: count }, (_, index) => ({
    id: `repo:peer/${index}`,
    type: 'Repository' as const,
    slot: 'dependency' as const,
    label: `peer/${index}`,
    owner: 'peer',
    name: String(index),
    fact: 'main',
    isSubject: false,
    isPackage: false,
    outboundRelationshipIds: [],
    inboundRelationshipIds: [],
    peerRelationshipIds: [],
  }));
  const subject: ViewNode = {
    id: 'repo:subject/hub',
    type: 'Repository',
    slot: 'subject',
    label: 'subject/hub',
    owner: 'subject',
    name: 'hub',
    isSubject: true,
    isPackage: false,
    outboundRelationshipIds: [],
    inboundRelationshipIds: [],
    peerRelationshipIds: [],
  };
  const edges: ViewEdge[] = peers.map((peer) => ({
    id: `rel-${peer.id}`,
    relationshipType: 'uses_submodule',
    family: 'dependency',
    status: 'VERIFIED',
    directed: true,
    arrow: 'end',
    arrowheadAt: peer.id,
    source: subject.id,
    target: peer.id,
    label: 'uses submodule',
    relationLabel: 'uses submodule',
    subjectRole: 'outbound',
    visibility: 'primary',
    evidenceCount: 1,
    evidenceIds: [],
    evidenceTruncated: false,
  }));
  return {
    ...view,
    subject,
    nodes: [subject, ...peers],
    edges,
    edgeCount: edges.length,
    primaryEdgeCount: edges.length,
  };
}

test('a hub wraps into a grid instead of stacking peers into one column', () => {
  // The real case: grpc/grpc has 20 submodule peers in one slot.
  const hub = hubView(20);
  const positions = layoutGraph(hub, hub.edges);
  assert.equal(positions.size, 21);
  assertNoOverlap(positions, '20-peer hub');

  const subject = positions.get(hub.subject.id)!;
  const peerXs = new Set([...positions.values()].filter((p) => p.x !== subject.x).map((p) => Math.round(p.x)));
  assert.ok(peerXs.size > 1, 'peers must occupy more than one column');

  // The grid is pushed clear of the subject rather than growing into it.
  const nearestPeerX = Math.min(...[...positions.values()].filter((p) => p.x !== subject.x).map((p) => p.x));
  assert.ok(
    nearestPeerX - subject.x > NODE_W / 2,
    'the grid is separated from the subject by more than one node width',
  );
});

test('a small slot stays on one line, so a simple view stays simple', () => {
  const hub = hubView(3);
  const positions = layoutGraph(hub, hub.edges);
  const subjectX = positions.get(hub.subject.id)!.x;
  const peerXs = new Set([...positions.values()].filter((p) => p.x !== subjectX).map((p) => Math.round(p.x)));
  assert.equal(peerXs.size, 1, 'three peers fit in one column');
  assertNoOverlap(positions, '3-peer slot');
});

test('every node in a large view stays inside a sane bounding box', () => {
  const hub = hubView(30);
  const bounds = contentBounds(layoutGraph(hub, hub.edges));
  // Fit-to-view handles the size; the point is that it stays finite and finite-sized.
  assert.ok(Number.isFinite(bounds.width) && Number.isFinite(bounds.height));
  assert.ok(bounds.width > 0 && bounds.height > 0);
  assert.ok(bounds.width < 100_000, 'a 31-node hub must not produce an unbounded layout');
});

test('node degree, not parallel count, is what predicts a label collision', () => {
  // The real case: grpc/grpc has 20 *distinct* submodule peers. Each edge is a
  // parallel fan of one, so fanSlot alone would label all 20 and their mid-line
  // labels overprint into a smear.
  const hub = hubView(20);
  const parallelCounts = hub.edges.map((edge) => fanSlot(edge, hub.edges).fanCount);
  assert.deepEqual([...new Set(parallelCounts)], [1], 'no two edges join the same pair');

  const degrees = nodeDegrees(hub.edges);
  assert.equal(degrees.get(hub.subject.id), 20, 'the hub is the busy node');
  for (const edge of hub.edges) {
    assert.equal(isCrowdedEdge(edge, degrees, 4), true, 'every edge at the hub is crowded');
  }

  // A quiet three-node view is not crowded, so its labels stay visible.
  const degreesOfSmall = nodeDegrees(view.edges);
  assert.equal(isCrowdedEdge(edgeById(view, 'rel-1'), degreesOfSmall, 4), false);
});

test('a symmetric relationship counts once at each endpoint', () => {
  const symmetric = edgeById(view, 'rel-3');
  assert.equal(symmetric.directed, false);
  const degrees = nodeDegrees([symmetric]);
  // Degree is incident-edge count, so endpoint order cannot change it. The
  // renderer's thinning must behave the same whichever endpoint is focused.
  assert.equal(degrees.get(symmetric.source), 1);
  assert.equal(degrees.get(symmetric.target), 1);
  assert.equal(isCrowdedEdge(symmetric, degrees, 0), true);
});

test('a symmetric edge gets no arrowhead even when the subject is its source', () => {
  const positions = layoutGraph(view, view.edges);
  const symmetric = edgeById(view, 'rel-3');
  assert.equal(symmetric.directed, false);
  assert.equal(edgeGeometry(symmetric, positions, 0, 1)?.arrowAt, null);
  // The directed edge on the same node pair still points at its canonical target.
  const directed = edgeById(view, 'rel-2');
  assert.ok(edgeGeometry(directed, positions, 0, 1)?.arrowAt);
});

test('arrow placement follows the contract arrow, not focus', () => {
  const positions = layoutGraph(view, view.edges);
  const subject = positionOf(view, view.subject.id);
  const dependency = positionOf(view, 'pkg:npm/axios');

  // rel-2 points *into* the subject: the arrowhead sits on the subject end.
  const inbound = edgeById(view, 'rel-2');
  assert.equal(inbound.target, view.subject.id);
  assert.equal(inbound.subjectRole, 'inbound');
  assert.equal(inbound.arrowheadAt, view.subject.id);
  const inboundHead = edgeGeometry(inbound, positions, 0, 1)?.arrowAt;
  assert.ok(inboundHead, 'a directed edge carries an arrowhead');
  const inboundToSubject = Math.hypot(inboundHead.x - subject.x, inboundHead.y - subject.y);
  const inboundToDependency = Math.hypot(inboundHead.x - dependency.x, inboundHead.y - dependency.y);
  assert.ok(inboundToSubject < inboundToDependency, 'the head is at the subject end');

  // rel-1 points *out of* the subject: the arrowhead sits on the dependency end.
  const outbound = edgeById(view, 'rel-1');
  assert.equal(outbound.subjectRole, 'outbound');
  assert.equal(outbound.arrowheadAt, 'pkg:npm/axios');
  const outboundHead = edgeGeometry(outbound, positions, 0, 1)?.arrowAt;
  assert.ok(outboundHead, 'a directed edge carries an arrowhead');
  assert.ok(
    Math.hypot(outboundHead.x - dependency.x, outboundHead.y - dependency.y) <
      Math.hypot(outboundHead.x - subject.x, outboundHead.y - subject.y),
    'the head is at the dependency end',
  );
});

test('parallel edges on the same node pair fan apart and stay distinguishable', () => {
  const pair = [edgeById(view, 'rel-2'), edgeById(view, 'rel-3')];
  const slots = pair.map((edge) => fanSlot(edge, pair));
  assert.deepEqual(slots.map((slot) => slot.fanCount), [2, 2]);
  assert.notEqual(slots[0]?.fanIndex, slots[1]?.fanIndex);

  const positions = layoutGraph(view, view.edges);
  const one = edgeGeometry(pair[0]!, positions, 0, 2);
  const two = edgeGeometry(pair[0]!, positions, 1, 2);
  assert.notEqual(one?.path, two?.path, 'two slots must not draw the identical line');
  assert.notEqual(one?.label.x, two?.label.x, 'parallel labels must not overprint');
});

/** Parses a viewBox string into its four numbers. */
function parseViewBox(value: string): { x: number; y: number; width: number; height: number } {
  const parts = value.split(/\s+/).map(Number);
  assert.equal(parts.length, 4, `malformed viewBox: ${value}`);
  const [x, y, width, height] = parts as [number, number, number, number];
  assert.ok([x, y, width, height].every(Number.isFinite), `malformed viewBox: ${value}`);
  return { x, y, width, height };
}

test('fitViewBox covers the content and zoomViewBox zooms about a fixed point', () => {
  const bounds = contentBounds(layoutGraph(view, view.edges));
  const fitted = fitViewBox(bounds, { width: 1200, height: 700 });
  const box = parseViewBox(fitted.viewBox);
  assert.ok(box.width > 0 && box.height > 0);
  assert.ok(box.x <= bounds.x, 'fit must not clip content');
  assert.ok(box.y <= bounds.y, 'fit must not clip content');
  assert.ok(box.x + box.width >= bounds.x + bounds.width, 'fit must not clip content');
  assert.ok(box.y + box.height >= bounds.y + bounds.height, 'fit must not clip content');
  assert.ok(fitted.zoom > 0);

  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const zoomed = zoomViewBox(fitted.viewBox, 2, centre, fitted.zoom);
  const next = parseViewBox(zoomed.viewBox);
  assert.ok(Math.abs(next.width - box.width / 2) < 1e-6, 'width halves at 2x');
  assert.ok(Math.abs(next.x + next.width / 2 - centre.x) < 1e-6, 'the zoom centre stays put');
  assert.ok(Math.abs(zoomed.zoom - fitted.zoom * 2) < 1e-6, 'zoom is reported as an absolute factor');
});

test('zoom stays inside the clamp however hard it is pushed', () => {
  const fitted = fitViewBox(contentBounds(layoutGraph(view, view.edges)), { width: 1200, height: 700 });
  let current = fitted;
  for (let index = 0; index < 40; index += 1) {
    current = zoomViewBox(current.viewBox, 1.25, null, current.zoom);
  }
  assert.ok(current.zoom <= 3 + 1e-9, 'zoom is clamped at the maximum');
});

test('empty content still produces a usable viewBox', () => {
  const fitted = fitViewBox(contentBounds(new Map()), { width: 800, height: 600 });
  assert.match(fitted.viewBox, /^-?\d/);
  assert.ok(fitted.zoom > 0);
});

// --------------------------------------------------------------------- search

test('search finds nodes and relationships, case-insensitively', () => {
  assert.deepEqual(searchNodes(view, 'axios'), ['pkg:npm/axios']);
  assert.deepEqual(searchEdges(view, 'identical'), ['rel-3']);
  assert.deepEqual(searchNodes(view, 'zzz'), []);
});

test('edgesForNode reports every relationship touching the node', () => {
  assert.deepEqual(
    [...edgesForNode(view, 'repo:nachocebey/is')].sort(),
    ['rel-1', 'rel-2', 'rel-3'],
  );
  assert.deepEqual(edgesForNode(view, 'repo:unknown/x'), []);
});

test('turning a layer off hides edges only and never changes counts', () => {
  const all = visibleEdges(view, { layers: allLayersOn(), expandedBundles: new Set() });
  assert.equal(all.length, 3);
  const off = visibleEdges(view, {
    layers: { ...allLayersOn(), ancestry: false },
    expandedBundles: new Set(),
  });
  assert.equal(off.length, 2);
  assert.equal(off.some((edge) => edge.family === 'ancestry'), false);
  // The relationship type and direction of the survivors are untouched.
  assert.deepEqual(
    off.map((edge) => edge.relationshipType).sort(),
    ['depends_on', 'shares_exact_content_with'],
  );
  assert.equal(off.find((edge) => edge.id === 'rel-3')?.directed, false);
});

test('layer counts report what each layer would draw', () => {
  const counts = layerCount(view, allLayersOn());
  assert.equal(counts.dependency, 1);
  assert.equal(counts.similarity, 0);
  const off = layerCount(view, { ...allLayersOn(), dependency: false });
  assert.equal(off.dependency, 0);
  assert.equal(off.ancestry, 1, 'other layers are unaffected');
});

test('expanded bundles replace a bundle row with its member edges', () => {
  const bundledEdge: ViewEdge = {
    ...view.edges[0]!,
    id: 'rel-9',
    visibility: 'bundled',
    bundleKey: 'depends_on/DECLARED',
  };
  const bundled: ViewGraph = {
    ...view,
    edges: [...view.edges, bundledEdge],
    bundles: [
      {
        key: 'depends_on/DECLARED',
        relationshipType: 'depends_on',
        family: 'dependency',
        status: 'DECLARED',
        count: 1,
        label: 'depends on',
        sampleRelationshipId: 'rel-9',
        totalEvidenceCount: 1,
      },
    ],
    primaryEdgeCount: 3,
    bundledEdgeCount: 1,
  };
  const collapsed = visibleEdges(bundled, { layers: allLayersOn(), expandedBundles: new Set() });
  assert.equal(collapsed.some((edge) => edge.id === 'rel-9'), false, 'a collapsed bundle is not drawn');
  assert.equal(collapsed.length, 3);

  const expanded = visibleEdges(bundled, { layers: allLayersOn(), expandedBundles: new Set(['depends_on/DECLARED']) });
  assert.equal(expanded.length, 4);
  // Expanding a bundle reveals edges; it does not restate or reclassify them.
  const revealed = expanded.find((edge) => edge.id === 'rel-9');
  assert.ok(revealed, 'the bundled edge is drawn once its bundle is expanded');
  assert.equal(revealed.relationshipType, 'depends_on');
  assert.equal(revealed.status, 'DECLARED');
  assert.equal(revealed.directed, true);
  assert.equal(revealed.arrow, 'end-weak');
});

// --------------------------------------------------------------------- links

test('evidenceSourceUrl builds a real GitHub blob URL from the record', () => {
  const record = {
    locator: 'package.json:32',
    sourceUrl: 'https://github.com/nachocebey/is/blob/main/package.json',
  };
  assert.equal(
    evidenceSourceUrl(record, 'nachocebey', 'is'),
    'https://github.com/nachocebey/is/blob/main/package.json#L32',
  );
});

test('evidenceSourceUrl refuses to invent a URL the analyzer never recorded', () => {
  // A locator alone is not enough: without a revision the URL would be a guess.
  assert.equal(evidenceSourceUrl({ locator: 'README.md:10' }, 'octocat', 'Spoon-Knife'), null);
  assert.equal(evidenceSourceUrl({}, 'a', 'b'), null);
  // A recorded commit is a real permalink, so it may be used.
  assert.equal(
    evidenceSourceUrl({ data: { first_commit: 'deadbeef' } }, 'octocat', 'Spoon-Knife'),
    'https://github.com/octocat/Spoon-Knife/commit/deadbeef',
  );
  // A range anchor is expanded rather than truncated.
  assert.equal(
    evidenceSourceUrl(
      {
        sourceUrl: 'https://github.com/o/r/blob/main/docs/x.md',
        locator: 'docs/x.md:4-9',
      },
      'o',
      'r',
    ),
    'https://github.com/o/r/blob/main/docs/x.md#L4-L9',
  );
  assert.equal(SIMILARITY_DISCLAIMER.includes('not'), true);
});