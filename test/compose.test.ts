/**
 * Authored composition tests.
 *
 * The properties asserted here are the ones a screenshot would otherwise be the
 * only way to check: the world is fixed rather than fitted, the subject does not
 * drift with content, and loose nodes neither overlap each other nor the plates
 * they must stay clear of.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  WORLD,
  ZONES,
  capacity,
  subjectPosition,
  dataZonePositions,
  loosePositions,
  initialViewBox,
} from '../src/web/client/lib/compose.mjs';

const NODE_W = 216;
const NODE_H = 52;
/** The app bar's height, in the same CSS pixels the stage is measured in. */
const BAR_H = 44;
/** Collapsed plate half-extents: 184 wide, 60 tall. */
const platesAt = (ys: number[]) => ys.map((y) => ({ x: ZONES.dataLeft + 92, y, hw: 92, hh: 30 }));
const collides = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < NODE_W && Math.abs(a.y - b.y) < NODE_H;

/**
 * A window's four numbers, or a hard failure.
 *
 * Destructuring a `.map(Number)` yields `number | undefined` under this config, and a
 * test that quietly compared `undefined` would prove nothing.
 */
function windowOf(viewBox: string): [number, number, number, number] {
  const parts = String(viewBox).trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`unusable viewBox: ${viewBox}`);
  }
  return parts as [number, number, number, number];
}

test('the first window is the world seen through a window, not a fit to anything', () => {
  /*
   * The world is 1920 x 1720 and never scales. The opening window is the viewport's
   * own size at zoom 1, so a wider viewport sees more of the world and a narrower one
   * sees less -- and a world point keeps its meaning in both.
   *
   * It used to return the authored frame whatever the viewport, and before that it
   * fitted the frame to the viewport. Both made the world's own size a function of the
   * window, which is the property this test exists to prevent.
   */
  const wide = initialViewBox({ width: 1920, height: 990 });
  assert.equal(wide.zoom, 1, 'the world is never scaled to fit');
  const [x, y, w, h] = wide.viewBox.split(' ').map(Number);
  assert.equal(w, 1920, 'at 1920 wide the window is the viewport width in world units');
  assert.equal(h, 990, 'and its height is the viewport height in world units');

  const narrow = initialViewBox({ width: 1280, height: 720 });
  const [nx, ny, nw, nh] = narrow.viewBox.split(' ').map(Number);
  assert.equal(nw, 1280, 'a narrower window is smaller in world units, not scaled down');
  assert.equal(nh, 720);
  assert.equal(narrow.zoom, 1, 'and still at zoom 1');

  // Never past the world's edge, at any viewport.
  for (const viewport of [{ width: 400, height: 300 }, { width: 4000, height: 3000 }]) {
    const [bx, by, bw, bh] = windowOf(initialViewBox(viewport).viewBox);
    assert.ok(bx >= 0 && by >= 0, `${viewport.width}: the window starts inside the world`);
    assert.ok(bx + bw <= WORLD.width + 1e-9, `${viewport.width}: and ends inside it`);
    assert.ok(by + bh <= WORLD.height + 1e-9, `${viewport.width}: on both axes`);
  }
});

test('the world reserves a right-hand gutter for the Drawer', () => {
  // The Drawer must never move anything, so its width is inside the world.
  assert.ok(ZONES.gutterLeft + ZONES.gutterWidth <= WORLD.width, 'the gutter must fit the world');
  assert.ok(ZONES.dataLeft + ZONES.dataWidth <= ZONES.gutterLeft, 'the data zone must end before the gutter');
  // And nothing is placed on it.
  assert.ok(ZONES.subject.x + 108 < ZONES.gutterLeft, 'the subject clears the gutter');
});

test('the bottom band is inside the world, below everything placed', () => {
  assert.ok(ZONES.bandLeft + ZONES.bandWidth <= WORLD.width, 'the band fits the world horizontally');
  // The band is at the bottom of the authored composition, not at the bottom of the
  // world: the world's extra height is headroom a reader pans into, and a key 700
  // units below the composition would only be findable by panning.
  assert.ok(ZONES.bandTop < WORLD.height, 'the band is on the world');
  assert.ok(ZONES.bandTop > ZONES.subject.y + 200, 'and clear of the subject');
});

test('the whole authored composition is inside the opening window at every desktop width', () => {
  /*
   * The regression, stated as geometry.
   *
   * The band is a world object and the world never scales to fit, so the band is only
   * on screen where the window happens to be. The window is the stage's own size,
   * centred -- 1280x756 at 1280x800 with the rail collapsed, and 1656x1036 at 1920
   * with the rail's 264. So the window is world 320..1600 by 182..938, and world
   * 132..1788 by 42..1078.
   *
   * The band was on the field's left wall (172) and clipped at 1280; then at the
   * world's margin (48) and clipped at 1920; then at y 980, which is below the
   * 800-tall window entirely. Every one of those passed every automated check, because
   * the band was positioned by literals in the stylesheet and nothing compared them
   * with the zones. This compares them, on both axes, at every supported width.
   */
  // The band's own drawn height: a rule, its padding, and one row of small type.
  const BAND_H = 30;
  // The stage is the viewport minus the rail, which collapses below the breakpoint.
  for (const [viewport, rail] of [
    [{ width: 1280, height: 800 }, 0],
    [{ width: 1440, height: 900 }, 0],
    [{ width: 1920, height: 1080 }, 264],
    [{ width: 2560, height: 1440 }, 264],
  ] as const) {
    const stage = { width: viewport.width - rail, height: viewport.height - BAR_H };
    const [x, y, w, h] = windowOf(initialViewBox(stage).viewBox);
    const where = `${viewport.width}x${viewport.height}`;
    assert.ok(ZONES.bandLeft >= x - 1e-9,
      `${where}: the band's left (${ZONES.bandLeft}) is inside the window (${x})`);
    assert.ok(ZONES.bandLeft + ZONES.bandWidth <= x + w + 1e-9,
      `${where}: its right (${ZONES.bandLeft + ZONES.bandWidth}) is too, window ends ${x + w}`);
    assert.ok(ZONES.bandTop >= y - 1e-9,
      `${where}: the band's top (${ZONES.bandTop}) is inside the window (${y})`);
    assert.ok(ZONES.bandTop + BAND_H <= y + h + 1e-9,
      `${where}: its bottom (${ZONES.bandTop + BAND_H}) is too, window ends ${y + h}`);
    // And the data zone it belongs to, so the band is never the only thing on screen.
    assert.ok(ZONES.dataTop >= y - 1e-9,
      `${where}: the data zone's top (${ZONES.dataTop}) is inside the window (${y})`);
    assert.ok(ZONES.subject.y >= y && ZONES.subject.y <= y + h,
      `${where}: the subject (${ZONES.subject.y}) is inside the window ${y}..${y + h}`);
  }
});

test('the band is positioned from the zones, not from literals in the stylesheet', () => {
  // The duplication that let it drift: `left: 46px; top: 876px; width: 1456px` sat in
  // the stylesheet while the zones said something else, and a stylesheet cannot
  // disagree with a test that only reads the stylesheet.
  const css = readFileSync(resolve(import.meta.dirname, '..', 'src/web/client/app.css'), 'utf8');
  const rule = /\.band\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.match(rule, /left:\s*var\(--band-left/, 'the band takes its left from the renderer');
  assert.match(rule, /top:\s*var\(--band-top/, 'and its top');
  assert.match(rule, /width:\s*var\(--band-w/, 'and its width');
  // The renderer is the only thing that writes them.
  const app = readFileSync(resolve(import.meta.dirname, '..', 'src/web/client/app.js'), 'utf8');
  assert.match(app, /--band-left/);
  assert.match(app, /ZONES\.bandLeft/);
  assert.match(app, /ZONES\.bandTop/);
  assert.match(app, /ZONES\.bandWidth/);
});

test('the subject is fixed and independent of content', () => {
  assert.deepEqual(subjectPosition(), { x: ZONES.subject.x, y: ZONES.subject.y });
  // Same answer every time: an anchor that moves with its content is not an anchor.
  assert.deepEqual(subjectPosition(), subjectPosition());
});

test('a short plate stack sits beside the subject, not high in the frame', () => {
  const stack = dataZonePositions([{ height: 98 }]);
  assert.equal(stack.length, 1);
  // A single plate must not float above the subject joined by a long diagonal.
  assert.ok(Math.abs(stack[0]!.y - ZONES.subject.y) < 200, 'a lone plate belongs near the subject line');
});

test('a tall plate stack still starts at the authored zone top', () => {
  const tall = dataZonePositions(Array.from({ length: 8 }, () => ({ height: 98 })));
  assert.equal(tall.length, 8);
  assert.equal(tall[0]!.y, ZONES.dataTop);
});

test('loose nodes never overlap each other, at any count', () => {
  // Measured before: 19 overlapping pairs at fifteen nodes on a plain arc.
  for (const count of [1, 2, 3, 5, 8]) {
    const result = loosePositions(count, new Array(count).fill('dependency'), [subjectPosition()]);
    const placed = result.positions;
    assert.equal(result.overflowed, 0, `${count} nodes must fit the authored field`);
    assert.equal(placed.length, count, `${count} nodes must all be placed`);

    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        assert.equal(
          collides(placed[i]!, placed[j]!),
          false,
          `${count}: nodes ${i} and ${j} overlap`,
        );
      }
    }
  }
});

test('loose nodes never land on a plate', () => {
  // Collapsed plates, which is what a plate is when the field is being laid out.
  // Reserving expanded extents instead blocked the whole right-hand column and
  // silently halved capacity.
  const reserved = platesAt([300, 450, 600]);
  for (const count of [5, 8, 11]) {
    const placed = loosePositions(count, new Array(count).fill('dependency'), [subjectPosition()], reserved).positions;
    for (const node of placed) {
      for (const plate of reserved) {
        const overlap =
          Math.abs(node.x - plate.x) < NODE_W / 2 + plate.hw &&
          Math.abs(node.y - plate.y) < NODE_H / 2 + plate.hh;
        assert.equal(overlap, false, `${count}: a node landed on a plate at ${node.x},${node.y}`);
      }
    }
  }
});

test('a full field reports overflow instead of dropping nodes silently', () => {
  // A dropped node would look like a relationship that does not exist, which is
  // worse than a crowded canvas.
  const result = loosePositions(40, new Array(40).fill('dependency'), [subjectPosition()]);
  assert.ok(result.capacity > 0);
  assert.equal(result.positions.length + result.overflowed, 40);
  assert.ok(result.overflowed > 0, 'forty nodes must not fit the authored field');
});

test('the field holds the capacity its geometry allows, and no more', () => {
  /*
   * Measured three times and wrong each time, which is why it is pinned here -- but
   * pinned against the geometry rather than against a literal. The band between the
   * world's left margin and the data zone is 506 units wide; two 216-unit nodes need
   * 248 of centre-to-centre pitch, so a row of n spans 216 + (n-1)*248. Rows are nine
   * deep once the subject's clearance is respected, so the capacity is eighteen.
   *
   * Earlier readings of 5 and of 9 were both bugs -- a double-counted clearance and a
   * pitch that ignored the node's width -- not geometry. Asserting the number itself
   * would only re-introduce the same brittleness: the invariant is that placement
   * agrees with the geometry, whatever the geometry currently says.
   */
  const budget = capacity();
  const full = loosePositions(budget, new Array(budget).fill('dependency'), [subjectPosition()]);
  assert.equal(full.overflowed, 0, `${budget} peers fit the authored field`);
  assert.equal(full.positions.length, budget);
  assert.equal(full.capacity, budget, 'the placement reports the geometry it was given');

  // Past the budget, the overflow is reported rather than dropped: `grpc/grpc`
  // draws eleven loose peers, so this path is real.
  const over = loosePositions(budget + 3, new Array(budget + 3).fill('dependency'), [subjectPosition()]);
  assert.equal(over.overflowed, 3, 'the peers past the budget are reported');
  assert.equal(over.positions.length + over.overflowed, budget + 3, 'every peer is accounted for');
});

test('nothing is placed in the empty upper field', () => {
  // The composition is bottom-weighted on purpose; a node drifting above the
  // subject reintroduces the dead band the authored frame removes.
  for (const count of [5, 15, 26]) {
    const placed = loosePositions(count, new Array(count).fill('dependency'), [subjectPosition()]).positions;
    for (const node of placed) {
      assert.ok(
        node.y <= ZONES.bandTop,
        `${count}: node at y=${node.y} is below the bottom band`,
      );
    }
  }
});

test('placement is deterministic under reordered slots', () => {
  const forward = loosePositions(9, new Array(9).fill('dependency'), [subjectPosition()]).positions;
  const again = loosePositions(9, new Array(9).fill('dependency'), [subjectPosition()]).positions;
  assert.deepEqual(again, forward);
});
