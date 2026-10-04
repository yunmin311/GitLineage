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
import { buildComposition, plateRows, plateHiddenRows, PLATE_MEMBER_ROWS } from '../src/web/client/lib/aggregate.mjs';
import {
  fieldGeometry, capacity, drawableColumns, subjectPosition, frameTransform, initialViewBox, viewBoxFor,
  loosePositions, WORLD, ZONES,
} from '../src/web/client/lib/compose.mjs';

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

  /*
   * Two plates, not one plate with two lines in it.
   *
   * The frozen design's own key calls an aggregate "one tie per group", and its first
   * paint for this repository shows two group plates side by side. So a fan the
   * evidence genuinely splits becomes two aggregates. It used to become one plate
   * whose rows were group summaries, which meant only the first member of each group
   * was reachable and the other twelve could not be selected at all.
   */
  assert.equal(composition.plates.length, 2, 'one tie per evidence-supported group');

  const labels = composition.plates.map((plate) => plate.label).sort();
  assert.deepEqual(labels, ['Plugin-table references ×12', 'Prose references ×2']);
  const table = composition.plates.find((p) => p.form === 'table-row')!;
  const prose = composition.plates.find((p) => p.form === 'prose')!;
  assert.equal(table.memberEdgeIds.length, 12);
  assert.equal(prose.memberEdgeIds.length, 2);
  assert.equal(table.meta, 'docs/plugins.md');
  assert.equal(prose.meta, '2 files');

  /*
   * Every member named, not a group summary. A row is the way a reader reaches a
   * specific claim, so this is the difference between a plate you can read into and a
   * plate you can only take two words from.
   */
  for (const plate of composition.plates) {
    assert.equal(plate.members.length, plate.memberEdgeIds.length, `${plate.label}: every member is named`);
    for (const member of plate.members) {
      assert.ok(member.label && member.label.length > 0, `${plate.label}: member ${member.edgeId} has a name`);
      assert.ok(plate.memberEdgeIds.includes(member.edgeId), `${plate.label}: ${member.edgeId} belongs to it`);
      assert.equal(member.status, 'DECLARED', 'status is read from the relationship');
      assert.equal(member.directed, true, 'canonical direction is carried through');
    }
  }
  // The locators are the real ones, so a row can be checked against its source line.
  const locators = composition.plates.flatMap((plate) => plate.members.map((m) => m.meta));
  assert.ok(locators.some((l) => l === 'docs/plugins.md:20'), 'the Templater line is addressable');
});

test('a group plate lists its members and says how many it holds back', () => {
  const { composition } = compose('yunmin311__obsidian-config');
  const table = composition.plates.find((p) => p.form === 'table-row')!;
  assert.equal(table.open, true, 'an evidence-named plate shows its claims on the first paint');

  const capped = plateRows(table);
  assert.equal(capped.length, PLATE_MEMBER_ROWS, 'a bounded list, not the whole fan');
  assert.equal(plateHiddenRows(table), 12 - PLATE_MEMBER_ROWS, 'the remainder is stated, not implied');
  // Each row is exactly one relationship, so each is individually selectable.
  assert.equal(new Set(capped.map((r) => r.edgeId)).size, capped.length);
  assert.ok(capped.every((r) => r.memberEdgeIds.length === 1));

  // Expanded, the plate lists all twelve and holds nothing back.
  const full = plateRows({ ...table, expanded: true });
  assert.equal(full.length, 12);
  assert.equal(plateHiddenRows({ ...table, expanded: true }), 0);
});

test('a fan the evidence cannot split stays one neutral plate with no invented grouping', () => {
  // `uses_submodule` is not written down anywhere, so it can never carry a subgroup.
  const { composition } = compose('grpc__grpc');
  const submodules = composition.plates.filter((p) => p.relationshipType === 'uses_submodule');
  assert.equal(submodules.length, 1);
  assert.equal(submodules[0]!.form, null, 'no evidence form, so no named group');
  assert.equal(submodules[0]!.meta, '', 'and nothing claimed about where it was written');
  assert.equal(submodules[0]!.label, 'uses submodule ×16', 'the label claims only relation and count');
  // It still lists its members, so each one remains reachable.
  assert.equal(submodules[0]!.members.length, 16);
});

test('the neutral plate label claims nothing about provenance', () => {
  const { composition } = compose('grpc__grpc');
  for (const plate of composition.plates) {
    // A `references` claim is never promoted into dependency or declaration language.
    for (const forbidden of ['depends', 'DECLARED', 'declared', 'plugin', 'prose', 'table']) {
      assert.equal(
        plate.label.toLowerCase().includes(forbidden.toLowerCase()),
        false,
        `plate label "${plate.label}" must not claim "${forbidden}"`,
      );
    }
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
    assert.equal(plate.form ?? null, null, `${plate.relationshipType} must not be named for a document form`);
    assert.deepEqual(plate.subgroups, [], `${plate.relationshipType} must not carry document subgroups`);
  }
});

test('the field geometry derives its numbers rather than restating them', () => {
  // The walls, pitch, column count and capacity were each computed inline more than
  // once and the copies disagreed -- 474, 226 and 448 for the same field. There is
  // now one derivation, and the capacity is the placement's own row plan rather than a
  // multiplication beside it.
  const geometry = fieldGeometry();
  assert.equal(geometry.maxPerRow, 2, 'two columns: the band holds two, not three');
  assert.equal(drawableColumns(), geometry.maxPerRow, 'the exported column count is the geometry');
  assert.ok(geometry.bandWidth >= 216 + 248, 'the band must clear two nodes at pitch');
  assert.ok(geometry.capacity > 0);
  // Capacity is the sum of the rows the placement actually fills. It used to be
  // `maxPerRow * (rowsAbove + rowsBelow)`, which is a different number: eighteen
  // against fourteen, so four real relationships were aggregated for no reason.
  assert.equal(
    geometry.capacity,
    geometry.perRow.reduce((sum, n) => sum + n, 0),
    'capacity is the row plan, summed',
  );
  assert.equal(capacity(), geometry.capacity, 'and both agree');
  // And the placement reports the same number, so a budget can never promise more
  // than the canvas can draw.
  const placement = loosePositions(geometry.capacity, new Array(geometry.capacity).fill('dependency'), [subjectPosition()]);
  assert.equal(placement.capacity, geometry.capacity, 'placement agrees with the geometry');
  assert.equal(placement.overflowed, 0, 'and the field really does hold them all');

  /*
   * The subject sits inside the field but to the RIGHT of its midpoint. The design
   * puts the data mass to the subject's right, so the band is pushed left of it: 358
   * units of field to the subject's left against 148 to its right. The old test
   * demanded the midpoint, and the old zones satisfied it only because the rail lived
   * inside the world and the whole field had been shifted right to clear it.
   */
  const subject = subjectPosition();
  assert.ok(subject.x > geometry.leftWall, 'the subject is inside the field');
  assert.ok(subject.x < geometry.rightWall, 'on both sides');
  assert.ok(
    subject.x > geometry.bandMid,
    'and to the right of the midpoint, leaving the constellation its room on the left',
  );
  assert.ok(
    (subject.x - geometry.leftWall) > (geometry.rightWall - subject.x),
    'by the design\'s own margin: more field left of the subject than right',
  );

  /*
   * The zone is derived from the field's requirement, and the arithmetic is spelled
   * out here rather than restated, so this asserts the relationship rather than a
   * tuned constant:
   *
   *   dataLeft = worldMargin + halfNode + clearance    (the field's left wall)
   *            + NODE_W + slotPitch                   (the band's required width)
   *            + PLATE_W/2 + clearance                 (the field's right wall)
   *
   * The left wall is the world's left composition margin. It used to be the context
   * column's right edge, because the rail lived inside the world; the rail is a shell
   * column now, so the world has a margin of its own.
   */
  const fieldLeft = 48 + 216 / 2 + 16;
  const fieldRight = ZONES.dataLeft - 184 / 2 - 16;
  assert.equal(fieldLeft, geometry.leftWall, 'left wall clears the world margin');
  assert.equal(fieldRight, geometry.rightWall, 'right wall clears the plates');
  assert.equal(fieldRight - fieldLeft, geometry.bandWidth, 'band width is consistent');
  // And that band is wide enough for two columns at pitch, which is why it is two.
  assert.ok(geometry.bandWidth >= 216 + geometry.slotPitch, 'the band holds two columns');
});

test('the geometry has two columns and a real capacity', () => {
  const geometry = fieldGeometry();
  // Two, and that is arithmetic rather than a preference: a third 216-unit node on the
  // 248 pitch needs 712 units of band and there are 506. It was three for one commit,
  // because `dataLeft` had drifted right while the subject had not, and the extra
  // column silently changed how many relationships each graph drew directly.
  assert.equal(geometry.maxPerRow, 2, 'two columns: the band holds two, not three');
  assert.ok(geometry.bandWidth >= 216 + 248, 'the band must clear two nodes at pitch');
  assert.ok(geometry.bandWidth < 216 + 2 * 248, 'and must not clear three');
  // Capacity is columns times the rows between the subject's line and the band, and
  // it is the one number the composition budget spends.
  assert.ok(geometry.capacity >= 2, 'the field holds real work');
  assert.equal(capacity(), geometry.capacity, 'and both agree');
  assert.ok(geometry.floor > 0 && geometry.ceiling > 0, 'the field has room above and below the subject');
});

// ------------------------------------------------------- the world's HTML layer

/**
 * A window's four numbers, or a hard failure.
 *
 * Parsed with a check rather than destructured: an index out of range is `undefined`
 * under this config's type settings, and a test that compares `undefined` silently
 * proves nothing.
 */
function parseWindow(viewBox: string): [number, number, number, number] {
  const parts = String(viewBox).trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`unusable viewBox: ${viewBox}`);
  }
  return parts as [number, number, number, number];
}

test('the world layer is mapped by the camera, identically to the canvas', () => {
  /*
   * The band's coordinates are world coordinates, so they must go through the same
   * mapping the SVG's `viewBox` performs. While they were positioned in raw pixels
   * they were only correct at a viewport whose scale happened to be about one: at 1280
   * the canvas scaled to 0.69, the band stayed at its world y of 876, and it landed
   * 180px below the fold with a scrollbar on a canvas that is not supposed to scroll.
   *
   * With a fixed world the mapping is one derivation, so this asserts it directly:
   * at zoom 1 a world unit is a CSS pixel, and a panned window shifts both together.
   */
  const viewport = { width: 1920, height: 1080 };
  const viewBox = initialViewBox(viewport).viewBox;
  const t = frameTransform(viewport, viewBox);

  const [vx, vy, vw] = parseWindow(viewBox);
  assert.equal(t.scale, viewport.width / vw, 'one world unit is one CSS pixel at zoom 1');
  assert.ok(Math.abs(t.x + vx * t.scale) < 1e-6, 'the window origin is where the pan says it is');
  assert.ok(Math.abs(t.y + vy * t.scale) < 1e-6, 'on both axes');
  assert.equal(t.width, WORLD.width * t.scale, 'the layer spans the whole world, not the window');
});

test('the same world coordinate lands in the same place at every viewport', () => {
  /*
   * The point of a fixed world. A narrower viewport sees *less* of the world at zoom 1
   * rather than a shrunken copy of all of it, so the band keeps its world y and the
   * camera keeps showing the same coordinate -- what changes is how much of the world
   * fits, which is a window property and not a layout one.
   *
   * The assertion is made on screen position in world units: inverting the transform
   * by dividing out the scale must return the band's own world y at every viewport.
   * A shell that reflowed or rescaled the world would make these differ.
   */
  const bandTop = ZONES.bandTop;
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 800 },
    { width: 2560, height: 1440 },
  ]) {
    const viewBox = initialViewBox(viewport).viewBox;
    const t = frameTransform(viewport, viewBox);
    const screenY = bandTop * t.scale + t.y;
    const worldY = (screenY - t.y) / t.scale;
    assert.ok(Math.abs(worldY - bandTop) < 1e-6,
      `${viewport.width}: the band is at world y ${bandTop}, not at ${worldY}`);
    // At zoom 1 the world is not scaled, so the band really is on screen when the
    // window is tall enough to contain it -- which is the visible consequence of the
    // same property.
    if (viewport.height >= WORLD.height) {
      assert.ok(Math.abs(screenY - bandTop) < 1e-6, `${viewport.width}: one world unit is one pixel`);
    }
  }
});

test('the camera cannot leave the world at any viewport or zoom', () => {
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 800 },
    { width: 4000, height: 3000 },
  ]) {
    for (const zoom of [0.25, 1, 2.5]) {
      // Centres far outside the world, in every direction, and a nonsense zoom.
      for (const pan of [
        { x: -9999, y: -9999 },
        { x: 9999, y: 9999 },
        { x: WORLD.width / 2, y: ZONES.subject.y },
      ]) {
        const box = viewBoxFor(viewport, pan, zoom);
        const [x, y, w, h] = parseWindow(box.viewBox);
        assert.ok(x >= -1e-9, `${viewport.width}@${zoom}: the window starts inside the world`);
        assert.ok(y >= -1e-9, `${viewport.width}@${zoom}: on both axes`);
        assert.ok(x + w <= WORLD.width + 1e-6, `${viewport.width}@${zoom}: and ends inside it`);
        assert.ok(y + h <= WORLD.height + 1e-6, `${viewport.width}@${zoom}: on both axes`);
        assert.ok(w > 0 && h > 0, `${viewport.width}@${zoom}: the window is never empty`);
      }
    }
  }
});

test('a nonsense zoom resolves rather than producing an empty window', () => {
  const viewport = { width: 1280, height: 800 };
  for (const zoom of [0, -1, NaN, Infinity, undefined]) {
    const box = viewBoxFor(viewport, { x: WORLD.width / 2, y: ZONES.subject.y }, zoom as number);
    assert.ok(box.width > 0 && box.height > 0, `${String(zoom)}: the window is usable`);
    assert.equal(box.zoom, 1, `${String(zoom)}: and falls back to 1`);
  }
});

test('the renderer asks the composition for the budget, not a literal', () => {
  // The two were restated and drifted. The renderer must spend the field's own
  // capacity rather than a number written beside it.
  const source = readFileSync(resolve(import.meta.dirname, '..', 'src/web/client/app.js'), 'utf8');
  assert.equal(/budget:\s*\d+/.test(source), false, 'no literal budget in the renderer');
  assert.match(source, /budget:\s*DRAWABLE_CAPACITY/);
  assert.match(source, /aggregateEdgeIds/);
});