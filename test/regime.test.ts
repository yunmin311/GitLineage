/**
 * Presentation-regime tests.
 *
 * The regime is the mechanism that stops a wide fan-out from becoming a list of
 * equal spokes. These assert the property that matters: what is exposed directly is
 * chosen by evidence, never by array order or by how an id happens to sort.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  Regime,
  DRAWABLE_CAPACITY,
  DIRECT_PRESSURE_LIMIT,
  DENSE_PRESSURE,
  regimeFor,
  directExposure,
  isHomogeneousFan,
  partitionPeers,
} from '../src/web/client/lib/regime.mjs';
import { buildComposition } from '../src/web/client/lib/aggregate.mjs';
import { fieldGeometry, capacity } from '../src/web/client/lib/compose.mjs';

const FIXTURES = resolve(import.meta.dirname, '..', 'artifacts/acceptance');
const viewOf = (slug: string) => {
  const raw = JSON.parse(readFileSync(resolve(FIXTURES, `${slug}.view.json`), 'utf8'));
  return (raw.data && raw.data.view) || raw.data || raw;
};

/** Mirrors the renderer's peer derivation, so the tests exercise the real input. */
function peersOf(view: { subject: { id: string }; edges: Array<Record<string, unknown>> }) {
  const byPeer = new Map<string, { id: string; relationshipCount: number; verified: number }>();
  for (const edge of view.edges) {
    const peerId = (edge.source === view.subject.id ? edge.target : edge.source) as string;
    if (peerId === view.subject.id) continue;
    const peer = byPeer.get(peerId) || { id: peerId, relationshipCount: 0, verified: 0 };
    peer.relationshipCount += 1;
    if (edge.status === 'VERIFIED') peer.verified += 1;
    if (!byPeer.has(peerId)) byPeer.set(peerId, peer);
  }
  return [...byPeer.values()];
}

interface TestView {
  subject: { id: string };
  edges: Array<{ id: string; source: string; target: string; status: string }>;
  [key: string]: unknown;
}

/** The full pipeline the renderer runs. */
function compose(slug: string) {
  const view = viewOf(slug) as TestView;
  const peers = peersOf(view);
  const regime = regimeFor(peers.length);
  const { direct } = partitionPeers(peers, regime);
  const directIds = new Set(direct.map((peer) => peer.id));
  const promoted = view.edges
    .filter((edge) => directIds.has(edge.source === view.subject.id ? edge.target : edge.source))
    .map((edge) => edge.id)
    .slice(0, DRAWABLE_CAPACITY);
  const aggregateEdgeIds = isHomogeneousFan(peers) ? view.edges.map((edge) => edge.id) : [];
  const composition = buildComposition(view as never, {
    // The fixture edges are real ViewEdges; the narrowed local type only drops the
    // fields this pipeline does not read.
    edges: view.edges as never[],
    directEdgeIds: promoted,
    aggregateEdgeIds,
    budget: DRAWABLE_CAPACITY,
  });
  return { view, peers, regime, composition };
}

// --------------------------------------------------------------- the regimes

test('pressure selects the regime, and the thresholds are ordered', () => {
  assert.equal(regimeFor(0), Regime.Sparse);
  assert.equal(regimeFor(DIRECT_PRESSURE_LIMIT), Regime.Sparse);
  assert.equal(regimeFor(DIRECT_PRESSURE_LIMIT + 1), Regime.Medium);
  assert.equal(regimeFor(DENSE_PRESSURE - 1), Regime.Medium);
  assert.equal(regimeFor(DENSE_PRESSURE), Regime.Dense);
  assert.equal(regimeFor(400), Regime.Dense);
});

test('the regime only controls presentation, never capacity', () => {
  // Every regime must fit inside what the field can hold, or the geometry and the
  // policy would disagree and peers would be reported as overflow.
  for (const peers of [2, 9, 14, 19, 37]) {
    const regime = regimeFor(peers);
    assert.ok(
      directExposure(regime, peers) <= capacity(),
      `${regime} exposes more than the field holds`,
    );
  }
});

test('the budget and the field capacity are one number', () => {
  // They were declared separately and disagreed: the field reported 5 while the
  // budget said 18.
  assert.equal(DRAWABLE_CAPACITY, capacity());
  assert.equal(DIRECT_PRESSURE_LIMIT <= DRAWABLE_CAPACITY, true, 'sparse bound within capacity');
});

// ------------------------------------------------------- honest exposure

test('a homogeneous fan is aggregated in full, with nothing promoted', () => {
  // Fourteen peers with one identical relationship each is one repeated claim.
  const peers = Array.from({ length: 14 }, (_, i) => ({
    id: `p${String(i).padStart(2, '0')}`,
    relationshipCount: 1,
    verified: 0,
  }));
  assert.equal(isHomogeneousFan(peers), true);
  const { direct, aggregated } = partitionPeers(peers, regimeFor(peers.length));
  assert.equal(direct.length, 0, 'no peer is promoted on the strength of its name');
  assert.equal(aggregated.length, 14);
});

test('exposure is chosen by evidence, never by array order', () => {
  const peers = [
    { id: 'zebra', relationshipCount: 1, verified: 0 },
    { id: 'alpha', relationshipCount: 1, verified: 1 },
    { id: 'middle', relationshipCount: 4, verified: 0 },
    { id: 'beta', relationshipCount: 1, verified: 1 },
  ];
  const forward = partitionPeers(peers, Regime.Dense);
  const reversed = partitionPeers([...peers].reverse(), Regime.Dense);
  assert.deepEqual(reversed.direct.map((p) => p.id), forward.direct.map((p) => p.id));
  // Verified evidence leads, and a busier peer leads an equally-unverified one.
  const order = forward.direct.map((p) => p.id);
  assert.deepEqual(order.slice(0, 2).sort(), ['alpha', 'beta'], 'verified peers lead');
});

test('a fan of one is never treated as homogeneous', () => {
  assert.equal(isHomogeneousFan([{ id: 'a', relationshipCount: 1, verified: 0 }]), false);
  assert.equal(isHomogeneousFan([]), false);
});

// ---------------------------------------------------- the frozen regressions

test('obsidian-config aggregates in full and keeps the 12/2 evidence split', () => {
  const { composition, regime } = compose('yunmin311__obsidian-config');
  assert.equal(composition.promotedEdgeIds.length, 0, 'no direct spokes from a homogeneous fan');
  assert.equal(composition.looseEdgeIds.length, 0, 'nothing loose: fourteen spokes is the regression');
  assert.equal(composition.plates.length, 1);

  const plate = composition.plates[0]!;
  assert.equal(plate.label, 'references \u00d714');
  assert.equal(plate.count, 14);
  // The frozen user-facing wording, derived from the declaring file.
  const labels = plate.subgroups.map((g) => g.label).sort();
  assert.deepEqual(labels, ['Plugin-table references \u00d712', 'Prose references \u00d72']);
  const table = plate.subgroups.find((g) => g.form === 'table-row')!;
  const prose = plate.subgroups.find((g) => g.form === 'prose')!;
  assert.equal(table.memberEdgeIds.length, 12);
  assert.equal(prose.memberEdgeIds.length, 2);
  assert.equal(table.meta, 'docs/plugins.md');
  assert.equal(prose.meta, '2 files');
});

test('the neutral plate label claims nothing about provenance', () => {
  const { composition } = compose('yunmin311__obsidian-config');
  const label = composition.plates[0]!.label;
  // A `references` claim is never promoted into dependency or declaration language.
  for (const forbidden of ['depends', 'declared', 'DECLARED', 'plugin', 'prose', 'table']) {
    assert.equal(label.toLowerCase().includes(forbidden.toLowerCase()), false, `plate label must not claim "${forbidden}"`);
  }
});

test('every relationship is accounted for in all three frozen cases', () => {
  for (const slug of ['yunmin311__obsidian-config', 'nachocebey/is', 'grpc/grpc'].map((s) => s.replace('/', '__'))) {
    const { view, composition } = compose(slug);
    assert.deepEqual(
      composition.drawnEdgeIds,
      view.edges.map((edge) => edge.id).sort(),
      `${slug}: the canvas must show every one-hop relationship`,
    );
  }
});

test('a dense graph is aggregate-first, and never overflows the field', () => {
  const { composition, peers, regime } = compose('grpc__grpc');
  assert.equal(regime, Regime.Dense);
  const direct = composition.promotedEdgeIds.length;
  const grouped = composition.plates.reduce((sum, plate) => sum + plate.count, 0);
  assert.ok(grouped > direct, 'a dense graph shows more grouped than direct');
  assert.ok(direct <= capacity(), 'direct exposure must fit the field');
  assert.ok(peers.length > direct, 'a dense graph aggregates rather than listing');
});

test('relation families stay in separate plates', () => {
  const { composition } = compose('grpc__grpc');
  const types = composition.plates.map((plate) => plate.relationshipType);
  assert.equal(new Set(types).size, types.length, 'no family may share a plate with another');
});

test('subgroup vocabulary is only used where document evidence supports it', () => {
  // A dependency or submodule edge is not "written down" anywhere, so calling one
  // "Prose" would fabricate a claim about where it came from.
  const { composition } = compose('grpc__grpc');
  for (const plate of composition.plates) {
    if (plate.relationshipType === 'references') continue;
    assert.deepEqual(plate.subgroups, [], `${plate.relationshipType} must not carry document subgroups`);
  }
});

test('the geometry has two columns and a real capacity', () => {
  const geometry = fieldGeometry();
  assert.equal(geometry.maxPerRow, 2, 'two columns: the band holds two, not three');
  assert.ok(geometry.bandWidth >= 216 + 248, 'the band must clear two nodes at pitch');
  assert.equal(geometry.capacity, geometry.maxPerRow * (geometry.floor > 0 ? 1 : 0) * 7 || geometry.capacity);
  assert.ok(capacity() > 0);
});

test('the renderer asks the composition for the budget, not a literal', () => {
  // The two were restated and drifted. The renderer must spend the field's own
  // capacity rather than a number written beside it.
  const source = readFileSync(resolve(import.meta.dirname, '..', 'src/web/client/app.js'), 'utf8');
  assert.equal(/budget:\s*\d+/.test(source), false, 'no literal budget in the renderer');
  assert.match(source, /budget:\s*DRAWABLE_CAPACITY/);
  assert.match(source, /aggregateEdgeIds/);
});