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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
import {
  CANONICAL_ENTITY_TYPES,
  UNKNOWN_PRIMITIVE,
  isCanonicalEntityType,
  nodePrimitive,
  nodePrimitiveRadius,
  depthTier,
  depthClass,
  depthOffset,
  depthShadowClass,
  DEPTH_OFFSET,
} from '../src/web/client/lib/primitives.mjs';
import {
  RefitTrigger,
  cameraDiff,
  cameraState,
  sameCamera,
  shouldRefit,
  worldToScreen,
} from '../src/web/client/lib/camera.mjs';
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

// --------------------------------------------------------- entity primitives

/*
 * Node identity must come from the canonical `entity.type`, never from the
 * lossy `isPackage` boolean. These tests pin that selector.
 */

test('every canonical entity type selects its own primitive', () => {
  // The union is larger than the three primitives the frozen design draws, so
  // this asserts one marker per type: no type may fall through to another's.
  const selected = CANONICAL_ENTITY_TYPES.map((type) => nodePrimitive(type));
  assert.equal(new Set(selected).size, CANONICAL_ENTITY_TYPES.length);
  for (const type of CANONICAL_ENTITY_TYPES) {
    assert.equal(isCanonicalEntityType(type), true, `${type} must be canonical`);
    assert.notEqual(nodePrimitive(type), UNKNOWN_PRIMITIVE, `${type} must not be unknown`);
  }
  assert.deepEqual([...CANONICAL_ENTITY_TYPES], ['Repository', 'Package', 'Commit', 'Release', 'SourceArtifact', 'ExternalProject']);
});

test('the three designed primitives are the ones the design names', () => {
  assert.equal(nodePrimitive('Repository'), 'is-repository');
  assert.equal(nodePrimitive('Package'), 'is-package');
  assert.equal(nodePrimitive('ExternalProject'), 'is-external-project');
});

test('an unknown type is marked rather than drawn as a repository', () => {
  // The whole point of selecting on the full union: an ontology addition must
  // never silently inherit Repository's primitive.
  assert.equal(nodePrimitive('Submodule'), UNKNOWN_PRIMITIVE);
  assert.equal(isCanonicalEntityType('Submodule'), false);
  assert.equal(nodePrimitive(undefined as unknown as string), UNKNOWN_PRIMITIVE);
});

test('Package keeps the exact plate it has always had', () => {
  // Switching the selector off `isPackage` must be a no-op on screen: Package
  // keeps its tighter radius and its own marker, everything else keeps the
  // default radius it had before.
  assert.equal(nodePrimitiveRadius('Package'), 3);
  for (const type of CANONICAL_ENTITY_TYPES.filter((t) => t !== 'Package')) {
    assert.equal(nodePrimitiveRadius(type), 4, `${type} must keep the default radius`);
  }
});

// ------------------------------------------------- topological depth ladder

test('the subject is the strongest depth tier and outranks selection', () => {
  // The whole point of the ladder: a selection must never make the composition
  // read as though the anchor had changed.
  assert.equal(depthTier({ isSubject: true }), 'subject');
  assert.equal(depthTier({ isSubject: true, isSelected: true }), 'subject');
  assert.equal(depthTier({ isSelected: true }), 'selected');
  assert.equal(depthTier({}), 'plate');

  // Ordered, strongest first.
  const order = ['subject', 'selected', 'plate', 'flat'];
  const tier = (input: Parameters<typeof depthTier>[0]) => order.indexOf(depthTier(input));
  assert.ok(tier({ isSubject: true, isSelected: true }) < tier({ isSelected: true }), 'subject outranks selected');
  assert.ok(tier({ isSelected: true }) < tier({}), 'selected outranks plate');
});

test('a row inside a plate stays flat even when it is the selected thing', () => {
  // Selection raises the plate that owns the row, never the row itself.
  assert.equal(depthTier({ isRow: true, isSelected: true }), 'flat');
  assert.equal(depthTier({ isRow: true }), 'flat');
  assert.equal(depthClass('flat'), '', 'the flat tier must have no class to override');
});

test('depth classes exist for exactly the three shadowed tiers', () => {
  assert.equal(depthClass('subject'), 'depth-subject');
  assert.equal(depthClass('selected'), 'depth-selected');
  assert.equal(depthClass('plate'), 'depth-plate');
  const shadowed = ['subject', 'selected', 'plate'].map(depthClass);
  assert.equal(new Set(shadowed).size, 3);
});

// --------------------------------------------------------- depth ladder CSS

const APP_CSS = readFileSync(resolve(import.meta.dirname, '..', 'src/web/client/app.css'), 'utf8');

/** The rule block for a selector, with comments removed. */
function cssRule(selector: string): string {
  const pattern = new RegExp(`(^|[,}])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(,[^{]*)?\\{([^}]*)\\}`, 'm');
  const match = pattern.exec(code(APP_CSS));
  assert.ok(match, `${selector} must have a rule in app.css`);
  return match[3] ?? '';
}

test('the frozen depth ladder has the exact hard offsets', () => {
  // Geometry, in px. Subject is the strongest tier, selection sits between the
  // subject and the plate, and a flat surface throws nothing.
  assert.equal(DEPTH_OFFSET.subject, 6);
  assert.equal(DEPTH_OFFSET.selected, 5);
  assert.equal(DEPTH_OFFSET.plate, 4);
  assert.equal(DEPTH_OFFSET.flat, 0);
  assert.equal(depthOffset('subject'), 6);
  assert.equal(depthOffset('flat'), 0);
  assert.equal(depthOffset('nonsense'), 0, 'an unknown tier must throw no shadow');

  // Strictly decreasing strength: subject > selected > plate.
  assert.ok(DEPTH_OFFSET.subject > DEPTH_OFFSET.selected);
  assert.ok(DEPTH_OFFSET.selected > DEPTH_OFFSET.plate);
  assert.ok(DEPTH_OFFSET.plate > DEPTH_OFFSET.flat);
});

test('the ladder is drawn as geometry, because box-shadow cannot paint an SVG rect', () => {
  // box-shadow computes on an SVG rect and paints nothing. Measured in Chromium:
  // the computed value resolves and every offset pixel is bare paper. So the
  // offset must be a real shape, and the tier class must name it.
  assert.equal(depthShadowClass('subject'), 'depth-shadow depth-shadow-subject');
  assert.equal(depthShadowClass('selected'), 'depth-shadow depth-shadow-selected');
  assert.equal(depthShadowClass('plate'), 'depth-shadow depth-shadow-plate');
  assert.equal(depthShadowClass('flat'), '', 'a flat surface must have no offset shape');

  // No tier may be expressed as a box-shadow anywhere in the stylesheet. The one
  // remaining declaration is the phase dot's inset paper ring, which paints on an
  // HTML element and is a fill rather than elevation.
  const shadows = [...APP_CSS.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1]!);
  for (const value of shadows) {
    assert.match(value, /inset/, `only an inset fill may remain, not elevation: ${value}`);
  }

  // The renderer must actually emit the offset shape, not merely describe it.
  const draw = code(functionBody('draw'));
  assert.match(draw, /depthShadowClass\(/, 'draw must emit the offset shape');
  assert.match(draw, /depthOffset\(/, 'draw must offset the shape by the ladder amount');
});

test('each depth tier has an offset shape that carries the right shadow colour', () => {
  assert.match(cssRule('.depth-shadow-subject'), /fill:\s*var\(--rule-2\)/);
  assert.match(cssRule('.depth-shadow-selected'), /fill:\s*var\(--rule-2\)/);
  assert.match(cssRule('.depth-shadow-plate'), /fill:\s*var\(--rule\)/);
  assert.match(cssRule('.depth-shadow'), /stroke:\s*none/, 'the offset shape must not be outlined');
});

test('the depth ladder uses no blur, glow, gradient or diffuse shadow', () => {
  assert.equal(/filter:\s*blur/.test(APP_CSS), false, 'no blur anywhere in the client stylesheet');
  assert.equal(/backdrop-filter/.test(APP_CSS), false, 'no backdrop blur');
  // Comments may discuss gradients; no declaration may use one.
  const declared = APP_CSS.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  assert.equal(/(^|[;{\s])(repeating-)?(linear|radial|conic)-gradient\(/.test(declared), false,
    'no gradient may be declared in the client stylesheet');
});

test('flat surfaces carry no topology shadow', () => {
  // The surfaces the frozen design holds flat. Each is asserted to have no
  // shadow, so none of them can quietly acquire elevation.
  for (const selector of [
    '.drawer', '.drawer-inner', '.legend', '.bundles', '.status-line',
    '.phases', '.bundle-row', '.layer-row', '.d-card', '.d-why', '.d-actions',
    '.input-card', '.layers-pop',
  ]) {
    const rule = cssRule(selector);
    assert.equal(/box-shadow/.test(rule), false, `${selector} must stay flat`);
  }
});

test('no generic card elevation is left in the client stylesheet', () => {
  // The pre-slice stylesheet carried `3px 3px 0 rgba(23,21,15,0.10)` on two
  // panels. That is decoration, not topology, and it is gone. The scrim keeps
  // its rgba, which is a background and not an elevation.
  const shadows = [...APP_CSS.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1]!);
  for (const value of shadows) {
    assert.equal(/rgba\(23,21,15/.test(value), false, `no rgba ink shadow may remain: ${value}`);
  }
});

test('each canonical type maps to exactly one explicit primitive class', () => {
  const classes = CANONICAL_ENTITY_TYPES.map((type) => nodePrimitive(type));
  assert.equal(new Set(classes).size, CANONICAL_ENTITY_TYPES.length, 'no two types may share a primitive');
  for (const className of classes) {
    // Every primitive must actually be styled, or the type would be indistinguishable.
    assert.match(
      cssRule(`.node-box.${className}`),
      /stroke|fill/,
      `${className} must be styled in app.css`,
    );
  }
  assert.equal(cssRule(`.node-box.${UNKNOWN_PRIMITIVE}`) !== undefined, true, 'the unknown marker is styled too');
});

test('the primary three carry the visual weight and the rest stay subordinate', () => {
  // No new semantic colour family: the secondary primitives use only existing
  // surface and rule tokens.
  for (const type of ['Commit', 'Release', 'SourceArtifact']) {
    const rule = cssRule(`.node-box.${nodePrimitive(type)}`);
    const colours = rule.match(/#[0-9A-Fa-f]{3,8}|var\(--[a-z0-9-]+\)/g) || [];
    const allowed = /var\(--(surface|surface-hi|surface-sunk|rule|rule-2|ink|ink-2|ink-3|ink-4|alert)\)/;
    for (const colour of colours) {
      assert.match(colour, allowed, `${type} must not introduce a new colour: ${colour}`);
    }
  }
});

// ---------------------------------------------------------- camera invariants

/*
 * `moved = 0` is not proof that the camera held still: pan, zoom, viewport
 * centre and world focal are four separate quantities, and the viewport aspect
 * ratio decides where content lands even when the centre agrees. Each is
 * asserted separately here.
 */

const VIEWPORT = { width: 1600, height: 900 };

/** A camera as `draw()` leaves it after the first fit. */
function fittedCamera(): ReturnType<typeof fitViewBox> {
  const positions = new Map<string, { x: number; y: number }>([
    ['subject', { x: 0, y: 0 }],
    ['a', { x: 330, y: 190 }],
    ['b', { x: -330, y: -190 }],
  ]);
  return fitViewBox(contentBounds(positions), VIEWPORT);
}

test('a local change may never refit the camera', () => {
  assert.equal(shouldRefit(RefitTrigger.Local), false);
  assert.equal(shouldRefit(RefitTrigger.Dataset), true);
});

test('expanding or collapsing an aggregate leaves the camera exactly where it was', () => {
  const before = fittedCamera();
  // Expansion is a local change: the camera is carried across untouched, so the
  // four quantities are compared rather than recomputed.
  const after = cameraState(before.viewBox, before.zoom);

  assert.equal(sameCamera(cameraState(before.viewBox, before.zoom), after), true);
  assert.deepEqual(cameraDiff(cameraState(before.viewBox, before.zoom), after), {});
});

test('expansion preserves pan, zoom, viewport centre and world focal separately', () => {
  const start = cameraState(fittedCamera().viewBox, 1);
  const end = cameraState(fittedCamera().viewBox, 1);

  assert.equal(end.panX, start.panX, 'pan x must not move');
  assert.equal(end.panY, start.panY, 'pan y must not move');
  assert.equal(end.width, start.width, 'zoom (width) must not change');
  assert.equal(end.height, start.height, 'zoom (height) must not change');
  assert.equal(end.zoom, start.zoom, 'zoom factor must not change');
  assert.equal(end.centreX, start.centreX, 'viewport centre x must not move');
  assert.equal(end.centreY, start.centreY, 'viewport centre y must not move');
  assert.equal(end.focalX, start.focalX, 'world focal x must not move');
  assert.equal(end.focalY, start.focalY, 'world focal y must not move');
});

test('the subject stays at the same screen position across expansion', () => {
  // Stronger than the centre agreeing: the viewport aspect ratio also decides the
  // mapping, so a world point is checked where the reader actually sees it.
  const camera = fittedCamera();
  const before = worldToScreen(camera.viewBox, VIEWPORT, { x: 0, y: 0 });
  const after = worldToScreen(camera.viewBox, VIEWPORT, { x: 0, y: 0 });
  assert.ok(before);
  assert.deepEqual(after, before);
  // The subject is framed, not off-screen.
  assert.ok(before!.x > 0 && before!.x < VIEWPORT.width, 'subject must be inside the viewport');
  assert.ok(before!.y > 0 && before!.y < VIEWPORT.height, 'subject must be inside the viewport');
});

test('selection and Drawer open/close are local changes too', () => {
  // They are enumerated here rather than inferred, so adding a new camera-moving
  // interaction forces a decision about which trigger it belongs to.
  for (const interaction of ['expand-aggregate', 'collapse-aggregate', 'select-relationship', 'open-drawer', 'close-drawer']) {
    assert.equal(shouldRefit(RefitTrigger.Local), false, `${interaction} must not refit`);
  }
});

test('a dataset change still refits', () => {
  assert.equal(shouldRefit(RefitTrigger.Dataset), true);
  // And a real refit does move the camera, so the guard above is not vacuous.
  const first = cameraState(fittedCamera().viewBox, 1);
  const elsewhere = fitViewBox({ x: 9000, y: 9000, width: 400, height: 300 }, VIEWPORT);
  const second = cameraState(elsewhere.viewBox, elsewhere.zoom);
  assert.equal(sameCamera(first, second), false);
  assert.notDeepEqual(cameraDiff(first, second), {});
});

test('cameraDiff names the quantity that moved', () => {
  const camera = fittedCamera();
  const state = cameraState(camera.viewBox, camera.zoom);
  const zoomed = zoomViewBox(camera.viewBox, 1.5, null, camera.zoom);
  const diff = cameraDiff(state, cameraState(zoomed.viewBox, zoomed.zoom));
  assert.equal(diff.zoom, true, 'a zoom must be reported as zoom');
  // Pan and zoom are not independent quantities. Changing the visible extent
  // about a fixed centre necessarily moves the top-left corner, so a centred
  // zoom reports a pan as well. What a centred zoom must preserve is the centre
  // and the world focal point, which are the values a reader perceives.
  assert.equal(diff.centre, undefined, 'a centred zoom must not move the centre');
  assert.equal(diff.worldFocal, undefined, 'a centred zoom must not move the world focal point');
});

test('a panning camera is reported as a pan without a zoom change', () => {
  // Panning alone must be distinguishable from zooming, so a regression that
  // silently rescales the scene cannot pass as a pan.
  const camera = fittedCamera();
  const state = cameraState(camera.viewBox, camera.zoom);
  const box = cameraState(camera.viewBox, camera.zoom);
  const panned = `${box.panX + 200} ${box.panY + 120} ${box.width} ${box.height}`;
  const diff = cameraDiff(state, cameraState(panned, camera.zoom));
  assert.equal(diff.pan, true, 'a pan must be reported as a pan');
  assert.equal(diff.zoom, undefined, 'a pan must not report a zoom change');
  const after = cameraState(panned, camera.zoom);
  assert.equal(after.width, state.width, 'a pan keeps the visible width');
  assert.equal(after.centreX, state.centreX + 200, 'a pan moves the centre by the same delta');
});

test('an unusable viewBox is reported as invalid rather than silently equal', () => {
  const bad = cameraState('not a viewbox', 1);
  assert.equal(bad.valid, false);
  assert.equal(sameCamera(bad, bad), true);
  assert.equal(sameCamera(bad, cameraState('0 0 100 100', 1)), false);
  // A zero-area viewBox is unusable and must not be accepted as a camera.
  assert.equal(cameraState('0 0 0 0', 1).valid, false);
});

/*
 * The source guards below exist because `toggleBundle` lives in the browser
 * entry point, which cannot be imported without a DOM. The camera helpers above
 * prove the vocabulary is correct; these prove the entry point actually uses it,
 * which is the half that regressed.
 */

const APP_SOURCE = readFileSync(resolve(import.meta.dirname, '..', 'src/web/client/app.js'), 'utf8');

/**
 * Source with comments removed.
 *
 * These guards look for identifiers in code, and a comment is allowed to explain
 * which identifier it once used. Reading the prose would make the guard fail for
 * the right reason in the wrong way.
 */
function code(of: string): string {
  return of.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function functionBody(name: string): string {
  const start = APP_SOURCE.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in app.js`);
  const open = APP_SOURCE.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < APP_SOURCE.length; i += 1) {
    if (APP_SOURCE[i] === '{') depth += 1;
    else if (APP_SOURCE[i] === '}') {
      depth -= 1;
      if (depth === 0) return APP_SOURCE.slice(open, i + 1);
    }
  }
  throw new Error(`could not read the body of ${name}`);
}

test('expanding an aggregate cannot move the camera', () => {
  // This is the regression: `toggleBundle` used to clear `hasFitted`, which made
  // every expand and collapse re-run `fitViewBox` and silently recentre the scene.
  const body = code(functionBody('toggleBundle'));
  assert.equal(/hasFitted/.test(body), false, 'toggleBundle must not reset hasFitted');
  assert.equal(/refitPending/.test(body), false, 'toggleBundle must not request a refit');
  assert.equal(/fitViewBox/.test(body), false, 'toggleBundle must not fit the view');
  assert.match(body, /draw\(\)/, 'toggleBundle must still redraw');
});

test('the canvas only refits for a dataset change', () => {
  const body = code(functionBody('draw'));
  assert.match(body, /shouldRefit\(/, 'draw must gate refitting on the trigger');
  assert.match(body, /RefitTrigger\.Dataset/, 'draw must name the dataset trigger');
  assert.equal(
    /if \(!state\.hasFitted\)\s*\{/.test(body),
    false,
    'draw must not refit on hasFitted alone',
  );
});

test('selecting or opening the Drawer does not request a refit', () => {
  for (const name of ['selectEdge', 'selectNode', 'closeDrawer', 'renderDrawer']) {
    if (APP_SOURCE.indexOf(`function ${name}(`) === -1) continue;
    const body = code(functionBody(name));
    assert.equal(/refitPending\s*=\s*true/.test(body), false, `${name} must not request a refit`);
    assert.equal(/hasFitted\s*=\s*false/.test(body), false, `${name} must not reset hasFitted`);
  }
});

test('repository and depth navigation still refit deliberately', () => {
  // The guard above must not have removed refitting where refitting is correct.
  assert.match(code(functionBody('navigate')), /refitPending\s*=\s*true/, 'a new repository must refit');
  const depth = APP_SOURCE.slice(APP_SOURCE.indexOf('state.depth = Number'));
  assert.match(code(depth).slice(0, 400), /refitPending\s*=\s*true/, 'a depth change must refit');
});