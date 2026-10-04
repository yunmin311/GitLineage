/**
 * Aggregation policy tests.
 *
 * These run against the real schema-2.0.0 view-model captured from
 * `yunmin311/obsidian-config`, because the whole point of the evidence-aware
 * subgrouping is that it reproduces a real 12/2 split from real evidence rather
 * than from a rule fitted to a fixture.
 *
 * The regression being guarded: 14 one-hop `references` must never become 14 long
 * spokes, and a group may only be named when a record shows where the claim was
 * made.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  VISIBLE_OBJECT_BUDGET,
  DeclarationForm,
  declarationForm,
  declaringPath,
  evidenceSubgroups,
  buildComposition,
  plateRows,
  plateHiddenRows,
  PLATE_MEMBER_ROWS,
} from '../src/web/client/lib/aggregate.mjs';

const FIXTURES = resolve(import.meta.dirname, '..', 'artifacts/acceptance');
const viewOf = (slug: string) => {
  const raw = JSON.parse(readFileSync(resolve(FIXTURES, `${slug}.view.json`), 'utf8'));
  return (raw.data && raw.data.view) || raw.data || raw;
};
// The composition decides how the one-hop relationships are drawn, so it is given
// all of them. The view-model's own primary/bundled split is the mechanism this
// policy replaces, not an input to it.
const visible = (view: ViewGraphLike) => view.edges;

type ViewGraphLike = {
  subject: { id: string };
  edges: Array<{ id: string; relationshipType: string; status: string; visibility: string; [k: string]: unknown }>;
  evidenceByRelationship?: Record<string, unknown[]>;
  bundles?: Array<{ key: string; count: number }>;
};

const OBSIDIAN = 'yunmin311__obsidian-config';
const GRPC = 'grpc__grpc';
const SPARSE = 'nachocebey__is';

// ------------------------------------------------------- declaration form

test('a table row and running prose are told apart by the observed line', () => {
  assert.equal(declarationForm({ observedText: '| [Dataview](https://github.com/x) | 0.5.68 |' }), DeclarationForm.TableRow);
  assert.equal(declarationForm({ observedText: '> Toolbar settings point at https://github.com/sponsors/y' }), DeclarationForm.Prose);
  assert.equal(declarationForm({ observedText: 'Inspired by https://github.com/a/b' }), DeclarationForm.Prose);
});

test('evidence with no observed text is never guessed into a group', () => {
  assert.equal(declarationForm({}), DeclarationForm.Unknown);
  assert.equal(declarationForm({ observedText: '   ' }), DeclarationForm.Unknown);
  assert.equal(declarationForm(null), DeclarationForm.Unknown);
  assert.equal(declarationForm({ observedText: 42 }), DeclarationForm.Unknown);
});

test('the declaring file comes from the evidence locator', () => {
  assert.equal(declaringPath({ locator: 'docs/plugins.md:21' }), 'docs/plugins.md');
  assert.equal(declaringPath({ locator: 'README.md' }), 'README.md');
  assert.equal(declaringPath({}), '');
});

test('a partially understood fan stays neutral', () => {
  // One member has no usable evidence, so no group may be named: a label on some
  // members would read as a claim about all of them.
  const members = [
    { edgeId: 'a', card: { observedText: '| x |', locator: 'p.md:1' } },
    { edgeId: 'b', card: { observedText: '| y |', locator: 'p.md:2' } },
    { edgeId: 'c', card: {} },
  ];
  assert.deepEqual(evidenceSubgroups(members), []);
});

test('a fan whose members are all singletons stays neutral', () => {
  const members = [
    { edgeId: 'a', card: { observedText: '| x |', locator: 'a.md:1' } },
    { edgeId: 'b', card: { observedText: 'prose b', locator: 'b.md:1' } },
  ];
  assert.deepEqual(evidenceSubgroups(members), [], 'one member per file is not a group');
});

// ------------------------------------------------- the real regression case

test('obsidian-config: 14 references become grouped plates, never 14 spokes', () => {
  const view = viewOf(OBSIDIAN);
  const composition = buildComposition(view as never, { edges: visible(view as never) as never });

  assert.equal(composition.looseEdgeIds.length, 0, 'no reference may be drawn as its own spoke');
  /*
   * Two plates, not one.
   *
   * The frozen design's key calls an aggregate "one tie per group", and its own first
   * paint for this repository shows the plugin table and the prose references as two
   * separate group plates. A single plate whose rows were group *summaries* read as
   * one undifferentiated block on the canvas and left twelve of the fourteen
   * relationships unreachable, because a summary row can only ever select the first
   * member it stands for.
   */
  assert.equal(composition.plates.length, 2, 'one tie per evidence-supported group');
  assert.equal(composition.plates.reduce((n, p) => n + p.count, 0), 14, 'all fourteen are still on the canvas');

  for (const plate of composition.plates) {
    assert.equal(plate.relationshipType, 'references');
    // Every member is named, with the real locator behind it.
    assert.equal(plate.members.length, plate.count);
    assert.ok(plate.members.every((m) => m.label.length > 0));
    /*
     * A *neutral* label claims only relation and count. A label the evidence named
     * says where the claim was written, which is the whole point of it, so the
     * vocabulary check applies to the neutral ones only -- otherwise it would forbid
     * the honest answer.
     */
    if (plate.form !== null) {
      assert.ok((plate.meta ?? '').length > 0, 'a named group must say where it was written');
      continue;
    }
    for (const forbidden of ['DECLARED', 'plugin', 'prose', 'table', 'declared by', 'depends']) {
      assert.equal(plate.label.includes(forbidden), false, `a neutral label must not claim "${forbidden}"`);
    }
    assert.match(plate.label, /references ×\d+$/);
  }
  // Neither label may escalate a reference into a dependency claim.
  for (const plate of composition.plates) {
    assert.doesNotMatch(plate.label, /depend/i, `${plate.label} must not read as a dependency`);
  }
});

test('obsidian-config: the 12/2 split comes from real evidence, not from the rule', () => {
  const view = viewOf(OBSIDIAN);
  const composition = buildComposition(view as never, { edges: visible(view as never) as never });

  // The frozen design's groups, derived only from where each claim was written.
  const table = composition.plates.find((p) => p.form === 'table-row')!;
  const prose = composition.plates.find((p) => p.form === 'prose')!;
  assert.ok(table && prose, 'both evidence forms are found');
  assert.equal(table.label, 'Plugin-table references ×12');
  assert.equal(prose.label, 'Prose references ×2');
  assert.equal(table.memberEdgeIds.length, 12);
  assert.equal(prose.memberEdgeIds.length, 2);
  assert.equal(table.meta, 'docs/plugins.md');
  assert.equal(prose.meta, '2 files');
  // Every member belongs to exactly one plate: the split partitions the fan.
  assert.deepEqual(
    [...composition.plates.flatMap((p) => p.memberEdgeIds)].sort(),
    [...composition.drawnEdgeIds].filter((id) => composition.plates.some((p) => p.memberEdgeIds.includes(id))).sort(),
    'the groups partition the fan with nothing dropped and nothing doubled',
  );
  assert.deepEqual(
    [...table.memberEdgeIds, ...prose.memberEdgeIds].sort(),
    composition.plates.reduce<string[]>((all, p) => all.concat(p.memberEdgeIds), []).sort(),
    'every member is claimed once',
  );
});

test('obsidian-config: every table subgroup member really is a table row', () => {
  // Guards against the classifier drifting into claiming provenance it cannot see.
  const view = viewOf(OBSIDIAN);
  const evidence = view.evidenceByRelationship as Record<string, Array<Record<string, unknown>>>;
  const composition = buildComposition(view as never, { edges: visible(view as never) as never });
  const table = composition.plates.find((p) => p.form === 'table-row')!;
  const prose = composition.plates.find((p) => p.form === 'prose')!;

  for (const edgeId of table.memberEdgeIds) {
    const card = evidence[edgeId]![0]!;
    assert.match(String(card.observedText), /^\s*\|/, `${edgeId} is not a table row`);
    assert.equal(declaringPath(card), 'docs/plugins.md');
  }
  for (const edgeId of prose.memberEdgeIds) {
    const card = evidence[edgeId]![0]!;
    assert.doesNotMatch(String(card.observedText), /^\s*\|/, `${edgeId} is not prose`);
  }
});

test('obsidian-config: a plate lists named members, bounded, and never re-spokes them', () => {
  const view = viewOf(OBSIDIAN);
  const edges = visible(view as never);
  const composition = buildComposition(view as never, { edges: edges as never });
  const table = composition.plates.find((p) => p.form === 'table-row')!;

  /*
   * Rows are relationships, not group summaries.
   *
   * This is the whole point of the change. A summary row cannot be checked: it can
   * only select the first member it stands for, so twelve of the fourteen claims in
   * this graph had no way to be opened at all.
   */
  const capped = plateRows(table);
  assert.equal(capped.length, PLATE_MEMBER_ROWS, 'a bounded list');
  assert.equal(plateHiddenRows(table), 12 - PLATE_MEMBER_ROWS, 'and the remainder is stated out loud');
  for (const row of capped) {
    assert.equal(row.memberEdgeIds.length, 1, 'one relationship per row');
    assert.ok(row.label.length > 0, 'the row names the peer');
    assert.ok(table.memberEdgeIds.includes(row.edgeId));
  }
  // Every locator is the real one, so any row can be checked against its source line.
  assert.ok(
    table.members.every((m) => /^docs\/plugins\.md:\d+$/.test(m.meta)),
    'locators are the observed ones',
  );

  // Expanding lists every member and changes nothing about which relationships exist.
  const expanded = buildComposition(view as never, {
    edges: edges as never,
    expandedAggregates: new Set([table.key]),
  });
  const expandedTable = expanded.plates.find((p) => p.key === table.key)!;
  const full = plateRows(expandedTable);
  assert.equal(full.length, 12, 'all twelve listed');
  assert.equal(plateHiddenRows(expandedTable), 0);
  // The Templater claim is the one the frozen design shows selected, so it has to be
  // reachable by name and by line.
  assert.ok(full.some((r) => r.label === 'SilentVoid13/Templater'), 'Templater is listed by name');
  assert.ok(full.some((r) => r.meta === 'docs/plugins.md:20'), 'and its line is addressable');
  assert.deepEqual(expandedTable.memberEdgeIds, table.memberEdgeIds);
  assert.equal(expanded.looseEdgeIds.length, 0, 'expansion must not re-spoke members');
  assert.deepEqual(expanded.drawnEdgeIds, composition.drawnEdgeIds, 'the relationship set is unchanged');
});

test('obsidian-config: expansion does not move the camera or the composition', () => {
  const view = viewOf(OBSIDIAN);
  const edges = visible(view as never);
  const before = buildComposition(view as never, { edges: edges as never });
  const after = buildComposition(view as never, {
    edges: edges as never,
    expandedAggregates: new Set([before.plates[0]!.key]),
  });
  // Same subject, same loose set, same plates, same members: only the plate's own
  // `expanded` flag differs. Nothing global moved.
  assert.equal(after.subjectId, before.subjectId);
  assert.deepEqual(after.looseEdgeIds, before.looseEdgeIds);
  assert.deepEqual(after.plates.map((p) => p.key), before.plates.map((p) => p.key));
  assert.equal(after.plates[0]!.expanded, true);
  assert.equal(before.plates[0]!.expanded, false);
});

// --------------------------------------------------------- budget behaviour

test('the budget is a canvas limit, not an ontology rule', () => {
  // Two fans of seven against a budget of twelve: the first is drawn loose, the
  // second has only five objects left and collapses, so exactly one plate. Nothing about `depends_on` or `references` decided it.
  const edges = [
    ...Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, relationshipType: 'depends_on', status: 'DECLARED', visibility: 'primary' })),
    ...Array.from({ length: 7 }, (_, i) => ({ id: `b${i}`, relationshipType: 'references', status: 'DECLARED', visibility: 'primary' })),
  ];
  const composition = buildComposition({ subject: { id: 's' }, edges, evidenceByRelationship: {} } as never, { edges: edges as never });
  assert.equal(composition.budget, VISIBLE_OBJECT_BUDGET);
  assert.equal(composition.looseEdgeIds.length, 7);
  assert.equal(composition.plates.length, 1);
  assert.equal(composition.plates[0]!.relationshipType, 'references');
});

test('a fan within budget is never aggregated away', () => {
  const edges = Array.from({ length: 3 }, (_, i) => ({ id: `e${i}`, relationshipType: 'references', status: 'DECLARED', visibility: 'primary' }));
  const composition = buildComposition({ subject: { id: 's' }, edges, evidenceByRelationship: {} } as never, { edges: edges as never });
  assert.equal(composition.plates.length, 0, 'a small fan must stay drawn');
  assert.equal(composition.looseEdgeIds.length, 3);
});

test('mixed relation families stay independently visible', () => {
  // A fan is keyed by relation type and status, so families never merge into one
  // plate and a `depends_on` is never folded into a `references` count. With
  // three 7-member fans and a budget of 12, one fits and is drawn loose while the
  // other two become plates -- all three families stay present and countable.
  const edges = [
    ...Array.from({ length: 7 }, (_, i) => ({ id: `d${i}`, relationshipType: 'depends_on', status: 'DECLARED', visibility: 'primary' })),
    ...Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, relationshipType: 'references', status: 'DECLARED', visibility: 'primary' })),
    ...Array.from({ length: 7 }, (_, i) => ({ id: `u${i}`, relationshipType: 'uses_submodule', status: 'VERIFIED', visibility: 'primary' })),
  ];
  const composition = buildComposition({ subject: { id: 's' }, edges, evidenceByRelationship: {} } as never, { edges: edges as never });
  const byId = new Map(edges.map((e) => [e.id, e]));

  // Every family is represented, and no plate mixes two of them.
  const represented = new Set<string>(composition.plates.map((p) => p.relationshipType));
  for (const edgeId of composition.looseEdgeIds) represented.add(byId.get(edgeId)!.relationshipType);
  assert.deepEqual([...represented].sort(), ['depends_on', 'references', 'uses_submodule']);

  for (const plate of composition.plates) {
    for (const edgeId of plate.memberEdgeIds) {
      assert.equal(byId.get(edgeId)!.relationshipType, plate.relationshipType, 'a plate holds one relation only');
      assert.equal(byId.get(edgeId)!.status, plate.status, 'a plate holds one status only');
    }
    assert.ok(plate.count >= 2, 'no plate may hold a single relationship');
  }
  // And the total is conserved exactly.
  const seen = [...composition.looseEdgeIds, ...composition.plates.flatMap((p) => p.memberEdgeIds)].sort();
  assert.deepEqual(seen, edges.map((e) => e.id).sort());
});

test('the composition is deterministic under reordered input', () => {
  const view = viewOf(OBSIDIAN);
  const edges = visible(view as never) as Array<{ id: string }>;
  const forward = buildComposition(view as never, { edges: edges as never });
  const reversed = buildComposition(view as never, { edges: [...edges].reverse() as never });
  const shuffled = buildComposition(view as never, {
    edges: [...edges].sort((a, b) => (a.id < b.id ? 1 : -1)) as never,
  });
  assert.deepEqual(reversed.looseEdgeIds, forward.looseEdgeIds);
  assert.deepEqual(reversed.plates, forward.plates);
  assert.deepEqual(shuffled.plates, forward.plates);
  // Including the subgroup labels and their member order.
  assert.deepEqual(reversed.plates[0]!.subgroups, forward.plates[0]!.subgroups);
});

test('canonical direction and status survive aggregation untouched', () => {
  const view = viewOf(GRPC);
  const edges = visible(view as never);
  const composition = buildComposition(view as never, { edges: edges as never });
  const byId = new Map(edges.map((e) => [e.id, e]));
  for (const plate of composition.plates) {
    for (const edgeId of plate.memberEdgeIds) {
      const edge = byId.get(edgeId)!;
      assert.equal(edge.directed, (edge.directed as boolean), 'direction is carried through unchanged');
      assert.equal(plate.relationshipType, edge.relationshipType);
      assert.equal(plate.status, edge.status);
    }
  }
  // The view carries every one-hop relationship, aggregated or not. It is not
  // the canonical total: deeper hops are counted separately as hidden.
  const v = view as unknown as { edges: unknown[]; primaryEdgeCount: number; bundledEdgeCount: number };
  assert.equal(v.edges.length, v.primaryEdgeCount + v.bundledEdgeCount);
});

test('aggregation never drops or invents a relationship', () => {
  for (const slug of [OBSIDIAN, GRPC, SPARSE]) {
    const view = viewOf(slug);
    const edges = visible(view as never) as Array<{ id: string }>;
    const composition = buildComposition(view as never, { edges: edges as never });
    const seen = [
      ...composition.looseEdgeIds,
      ...composition.plates.flatMap((p) => p.memberEdgeIds),
    ].sort();
    assert.deepEqual(seen, edges.map((e) => e.id).sort(), `${slug}: every visible relationship accounted for`);
  }
});

// The renderer must offer the composition every one-hop relationship.
test('the renderer does not pre-filter the composition input', () => {
  // Regression found in Chromium, not by these tests: `draw()` passed the
  // primary-only edge set, so a repository whose relationships were all `bundled`
  // reached the canvas as a lone subject with no plate at all. The unit tests
  // passed because they handed the composition `view.edges` directly.
  const source = readFileSync(resolve(import.meta.dirname, '..', 'src/web/client/app.js'), 'utf8');
  assert.equal(
    /buildComposition\(\s*\w+\s*,\s*\{\s*edges:\s*currentEdges\(\)/.test(source),
    false,
    'the composition must never receive the primary-only edge set',
  );
  // It starts from every one-hop relationship, with layers applied first.
  assert.match(source, /function visibleCandidates\(/, 'the candidate set must be one named helper');
  const helper = source.slice(source.indexOf('function visibleCandidates('), source.indexOf('function currentComposition('));
  assert.match(helper, /view\.edges\.filter/, 'candidates come from every one-hop edge');
  assert.match(helper, /state\.layers\[edge\.family\]/, 'layers are applied first');
  // And draw() must use that helper, not an undefined local.
  const draw = source.slice(source.indexOf('function draw()'), source.indexOf('const bounds = contentBounds'));
  assert.match(draw, /visibleCandidates\(view\)/, 'draw must take its edges from the shared helper');
  assert.equal(/const edges = candidates\.filter/.test(draw), false, 'draw must not read a stale local');
});
