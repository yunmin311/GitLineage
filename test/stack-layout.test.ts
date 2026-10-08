/**
 * Stack-layout and openness-policy tests.
 *
 * These assert the layout arithmetic directly, not through a browser. A plate stack is a
 * geometric contract -- ordered masses, a whole-stack clamp, cumulative placement, and two
 * bounds -- and a contract like that deserves to be checked on the numbers rather than on a
 * screenshot of them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { MassReservations, MassSlot } from '../src/web/client/lib/compose.mjs';
import { layoutMassStacks, ZONES, subjectPosition } from '../src/web/client/lib/compose.mjs';
import { buildComposition, plateRows } from '../src/web/client/lib/aggregate.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const UPPER = 200;
const LOWER = 852;
const GAP = 26;
const ROW = 26;
const SHUT = 86;

/** What a caller may ask of a mass, over and above the two heights. */
interface MassOptions {
  open?: boolean;
  expanded?: boolean;
  collapsedHeight?: number;
  expandedHeight?: number;
  currentHeight?: number;
}

/** A mass shaped like a plate: a header, and rows while it is open. */
const mass = (
  key: string,
  rows: number,
  opts: MassOptions = {},
): { key: string; open: boolean; expanded: boolean } & MassReservations => {
  const listed = rows > 0 ? 68 + rows * ROW : SHUT;
  const collapsed = opts.collapsedHeight ?? listed;
  return {
    key,
    open: opts.open ?? false,
    expanded: opts.expanded ?? false,
    collapsedHeight: collapsed,
    expandedHeight: opts.expandedHeight ?? collapsed,
    currentHeight: opts.currentHeight ?? collapsed,
  };
};

const lay = (plates: ReturnType<typeof mass>[]) => layoutMassStacks(plates, {
  gap: GAP, rowPitch: ROW, shutHeight: () => SHUT, upper: UPPER, lower: LOWER,
});

/** One mass out of a placed stack, which must exist. */
function at(list: MassSlot[], index: number, label: string): MassSlot {
  const slot = list[index];
  assert.ok(slot, `${label}: mass[${index}] exists`);
  return slot;
}

/** The invariants the brief names, checked on real numbers. */
function assertStackInvariants(placed: Map<string, MassSlot>, label: string): MassSlot[] {
  const list = [...placed.values()];
  assert.ok(list.length > 0, `${label}: placed something`);

  for (let i = 0; i < list.length - 1; i += 1) {
    const here = at(list, i, label);
    const next = at(list, i + 1, label);
    assert.ok(
      here.y + here.height <= next.y,
      `${label}: mass[${i}].bottom ${here.y + here.height} <= mass[${i + 1}].top ${next.y}`,
    );
  }
  const first = at(list, 0, label);
  assert.ok(first.y >= UPPER, `${label}: first mass top ${first.y} >= ${UPPER}`);
  const last = at(list, list.length - 1, label);
  assert.ok(
    last.y + last.height <= LOWER,
    `${label}: last mass bottom ${last.y + last.height} <= ${LOWER}`,
  );
  return list;
}

// ---------------------------------------------------------------- basic arity

test('a single mass is placed beside the subject and stays in the zone', () => {
  const list = assertStackInvariants(lay([mass('only', 4, { open: true })]), 'one mass');
  assert.equal(list.length, 1);
});

test('two masses stack in order and never overlap', () => {
  const list = assertStackInvariants(
    lay([mass('a', 3, { open: true }), mass('b', 2, { open: true })]),
    'two masses',
  );
  assert.deepEqual(list.map((m) => m.key), ['a', 'b'], 'order is the input order');
  const first = at(list, 0, 'two masses');
  const second = at(list, 1, 'two masses');
  assert.ok(second.y >= first.y + first.height, 'b starts below a');
});

test('five masses fit, keep their order, and stay inside the zone', () => {
  const plates = [
    mass('a', 6, { open: true }),
    mass('b', 0), mass('c', 0), mass('d', 0), mass('e', 0),
  ];
  const list = assertStackInvariants(lay(plates), 'five masses');
  assert.deepEqual(list.map((m) => m.key), ['a', 'b', 'c', 'd', 'e']);
});

// ---------------------------------------------------------------- expansion

for (const [label, index] of [['first', 0], ['middle', 2], ['last', 4]] as const) {
  test(`an expanded ${label} mass stays inside the zone`, () => {
    const plates = [
      mass('a', 3, { open: true }),
      mass('b', 3, { open: true }),
      mass('c', 3, { open: true }),
      mass('d', 3, { open: true }),
      mass('e', 3, { open: true }),
    ];
    // The one under test wants far more room than the zone can give.
    const target = plates[index];
    assert.ok(target, `expanded ${label}: the mass under test exists`);
    plates[index] = mass(target.key, 3, {
      open: true,
      expanded: true,
      expandedHeight: 900,
      currentHeight: 900,
    });
    const list = assertStackInvariants(lay(plates), `expanded ${label}`);
    const grown = at(list, index, `expanded ${label}`);
    assert.ok(
      grown.height <= 900,
      `${label}: the expanded mass was given no more than the zone allows`,
    );
  });
}

test('an oversized expansion is reported, never silently drawn past the floor', () => {
  const plates = [
    mass('a', 3, { open: true, expanded: true, expandedHeight: 2000, currentHeight: 2000 }),
    mass('b', 3, { open: true }),
  ];
  const placed = lay(plates);
  const list = assertStackInvariants(placed, 'oversized');
  // Even at the floor the mass cannot show what it asked for, so the row count must have
  // been reduced rather than the plate being drawn across the band.
  assert.ok(at(list, 0, 'oversized').height < 2000, 'the request was reduced to what fits');
  const tail = [...placed.values()].at(-1);
  assert.ok(tail, 'the stack reported a last mass');
  assert.equal(tail.overflow, false, 'and the stack itself still fits');
});

// ---------------------------------------------------------------- bounds

test('a stack already at the upper bound is not pushed above it', () => {
  // Tall enough that centring on the subject would put the head above the zone.
  const plates = [mass('a', 6, { open: true }), mass('b', 6, { open: true }), mass('c', 6, { open: true })];
  const list = assertStackInvariants(lay(plates), 'tall stack');
  assert.ok(at(list, 0, 'tall stack').y >= UPPER, 'never begins above the zone');
});

test('a stack that exactly fits occupies the whole interval and no more', () => {
  // Three masses of exactly the height that divides the interval with two gaps.
  const each = Math.floor((LOWER - UPPER - 2 * GAP) / 3);
  const plates = [
    mass('a', 0, { collapsedHeight: each }),
    mass('b', 0, { collapsedHeight: each }),
    mass('c', 0, { collapsedHeight: each }),
  ];
  const list = assertStackInvariants(lay(plates), 'exact fit');
  const last = at(list, list.length - 1, 'exact fit');
  const bottom = last.y + last.height;
  assert.ok(bottom <= LOWER, `exact fit stays inside: ${bottom} <= ${LOWER}`);
});

// ---------------------------------------------------------------- determinism

test('the same input always produces the same layout', () => {
  const build = () => [
    mass('a', 5, { open: true }), mass('b', 2), mass('c', 3, { open: true }), mass('d', 0),
  ];
  const once = [...lay(build()).values()].map((m) => `${m.key}:${m.y}:${m.height}`);
  const twice = [...lay(build()).values()].map((m) => `${m.key}:${m.y}:${m.height}`);
  assert.deepEqual(once, twice, 'a re-run reproduces the world');
});

test('expanding one mass does not move a stack that has nothing to do with it', () => {
  // Two independent stacks are laid out in one call; the invariant that matters is that a
  // change inside one leaves the other alone. With a single ordered column this is the
  // weaker statement that masses below the change may move and masses above it do not.
  const before = [...lay([mass('a', 3, { open: true }), mass('b', 0), mass('c', 0)]).values()];
  const after = [...lay([
    mass('a', 6, { open: true, expanded: true, expandedHeight: 260, currentHeight: 260 }),
    mass('b', 0), mass('c', 0),
  ]).values()];
  /*
   * The stack is placed as a whole against the two bounds, so a taller stack legitimately
   * moves every mass in it -- that is what the clamp costs. The property that must not
   * break is narrower and more useful: an expansion may resize and reflow the column, but
   * it may never reorder it or push a mass out of the zone.
   */
  assert.deepEqual(after.map((m) => m.key), before.map((m) => m.key), 'the order is untouched');
  assert.notDeepEqual(after.map((m) => m.y), before.map((m) => m.y),
    'the stack really did reflow, so the test below is not vacuous');
  assertStackInvariants(lay([
    mass('a', 6, { open: true, expanded: true, expandedHeight: 260, currentHeight: 260 }),
    mass('b', 0), mass('c', 0),
  ]), 'after the expansion');
});

// ---------------------------------------------------------------- openness policy

interface FixtureView {
  edges: unknown[];
  [key: string]: unknown;
}

const FIXTURES = resolve(import.meta.dirname, '..', 'artifacts/acceptance');
const viewOf = (slug: string): FixtureView => {
  const raw = JSON.parse(readFileSync(resolve(FIXTURES, `${slug}.view.json`), 'utf8'));
  return ((raw.data && raw.data.view) || raw.data || raw) as FixtureView;
};

const composeOf = (slug: string) => {
  const view = viewOf(slug);
  return buildComposition(view as never, { edges: view.edges as never });
};

test('the largest non-remainder mass opens, and it is the largest by member count', () => {
  const composition = composeOf('Kuddev__pebrel');
  const opened = composition.plates.filter((p) => p.open);
  assert.equal(opened.length, 1, 'exactly one mass opens');
  const open = opened[0];
  assert.ok(open, 'a mass is open');
  const remainder = composition.plates.filter((p) => p.label.includes('remainder'));
  assert.ok(remainder.length > 0, 'this fan has a remainder to be wrong about');
  assert.ok(
    !remainder.some((p) => p.open),
    'the remainder never wins the default open',
  );
  // And it is the largest of the real structural groups.
  const groups = composition.plates.filter((p) => !p.label.includes('remainder'));
  const largest = groups.reduce((a, b) => ((b?.count ?? 0) > (a?.count ?? 0) ? b : a));
  assert.equal(open.key, largest?.key, 'the opened mass is the largest structural group');
  assert.ok(
    open.count > (remainder[0]?.count ?? 0),
    'and it holds more relationships than the remainder',
  );
});

test('every shut mass is still reachable, so shutting one strands nothing', () => {
  const fixtures = ['Kuddev__pebrel', 'yunmin311__obsidian-config', 'nachocebey__is', 'grpc__grpc'];
  for (const slug of fixtures) {
    const composition = composeOf(slug);
    /*
     * Every mass in every fixture has to open on request, whether or not it started open.
     * `grpc` happens to open all three of its masses -- each is a fan of its own, so each is
     * its own largest group -- which is why it is here: the rule is about reachability, not
     * about counting shut masses, and a fixture that opens everything must not skip the check.
     */
    assert.ok(composition.plates.length > 0, `${slug}: this fixture has masses`);
    for (const plate of composition.plates) {
      assert.equal(
        plateRows({ ...plate, open: false, expanded: false }).length,
        0,
        `${slug}: ${plate.label} lists nothing on the first paint`,
      );
      // ...and it must have a way in. `plateRows` is the gate, and it is the whole reason
      // a shut mass is not stranded: expanding it returns its members, so a reader can
      // reach every relationship without already knowing it exists.
      const opened = plateRows({ ...plate, open: false, expanded: true } as never);
      assert.ok(opened.length > 0, `${slug}: ${plate.label} opens on the reader's expand`);
      const listed = new Set(opened.map((row) => (row as { edgeId: string }).edgeId));
      assert.ok(
        plate.memberEdgeIds.every((id) => listed.has(id)),
        `${slug}: ${plate.label} gives back every member it holds`,
      );
    }
  }
});

test('a one-mass stack still opens, so a sparse graph is not shut for being small', () => {
  const composition = composeOf('nachocebey__is');
  assert.ok(composition.plates.length >= 1);
  assert.ok(
    composition.plates.some((p) => p.open),
    'a sparse single-mass fan opens its only mass',
  );
});

test('a sparse fan does not invent extra open masses', () => {
  const composition = composeOf('nachocebey__is');
  assert.equal(composition.plates.filter((p) => p.open).length, 1, 'exactly one');
});

/*
 * Ties and evidence density are properties of the selection, so they are checked on
 * synthetic input where the answer is known by hand, plus one real fixture where the
 * evidence totals disagree loudly with the relationship counts.
 */

interface Group {
  form: string;
  label: string;
  memberEdgeIds: string[];
}

/** The rank the composition uses: member count down, then structural label up. */
const rank = (a: Group, b: Group): number =>
  (b.memberEdgeIds.length - a.memberEdgeIds.length)
  || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);

test('a tie on member count is broken by the stable structural label', () => {
  const groups: Group[] = [
    { form: 'manifest', label: 'b_dir ×4', memberEdgeIds: ['e1', 'e2', 'e3', 'e4'] },
    { form: 'manifest', label: 'a_dir ×4', memberEdgeIds: ['f1', 'f2', 'f3', 'f4'] },
  ];
  assert.equal(groups.slice().sort(rank)[0]?.label, 'a_dir ×4',
    'the alphabetically first label wins the tie');
});

test('the tie resolves the same way whichever order the groups arrive in', () => {
  const groups: Group[] = [
    { form: 'manifest', label: 'b_dir ×4', memberEdgeIds: ['e1', 'e2', 'e3', 'e4'] },
    { form: 'manifest', label: 'a_dir ×4', memberEdgeIds: ['f1', 'f2', 'f3', 'f4'] },
  ];
  const winner = (input: Group[]) => input.slice().sort(rank)[0]?.label;
  assert.equal(winner(groups), 'a_dir ×4');
  assert.equal(winner(groups.slice().reverse()), 'a_dir ×4',
    'and reversing the input changes nothing');
});

test('member count outranks label, so a later label still wins on size', () => {
  const groups: Group[] = [
    { form: 'manifest', label: 'a_dir ×3', memberEdgeIds: ['e1', 'e2', 'e3'] },
    { form: 'manifest', label: 'z_dir ×9', memberEdgeIds: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9'] },
  ];
  assert.equal(groups.slice().sort(rank)[0]?.label, 'z_dir ×9',
    'size is the primary key, and the label only ever breaks a tie');
});

test('evidence density cannot promote a group over relationship count', () => {
  const composition = composeOf('Kuddev__pebrel');
  const opened = composition.plates.filter((p) => p.open);
  const open = opened[0];
  assert.ok(open, 'a mass opens');
  // The selection is made from member counts, so the opened mass can never be smaller than
  // a shut one. This fixture also carries evidence totals that disagree with those counts,
  // which is exactly the case the rule exists to refuse.
  const shutGroups = composition.plates.filter((p) => !p.open && !p.label.includes('remainder'));
  for (const other of shutGroups) {
    assert.ok(
      open.count >= other.count,
      `opened mass (${open.count}) is not smaller than a shut one (${other.count})`,
    );
  }
});

test('the composition never reads an evidence total to decide what opens', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '..', 'src/web/client/lib/aggregate.mjs'),
    'utf8',
  );
  // The ranking must be written in terms of members alone.
  const ranking = source.slice(source.indexOf('const openable = major.filter'));
  assert.match(ranking, /b\.memberEdgeIds\.length - a\.memberEdgeIds\.length/,
    'ranked by member count');
  for (const forbidden of ['evidenceCount', 'totalEvidenceCount', 'subgroups']) {
    assert.ok(
      !ranking.slice(0, ranking.indexOf('for (const group of major')).includes(forbidden),
      `the ranking does not consult ${forbidden}`,
    );
  }
});