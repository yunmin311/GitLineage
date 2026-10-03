/**
 * Authored composition tests.
 *
 * The properties asserted here are the ones a screenshot would otherwise be the
 * only way to check: the frame is authored rather than fitted, the subject does
 * not drift with content, and loose nodes neither overlap each other nor the
 * plates they must stay clear of.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FRAME,
  ZONES,
  subjectPosition,
  dataZonePositions,
  loosePositions,
  initialViewBox,
} from '../src/web/client/lib/compose.mjs';

const NODE_W = 216;
const NODE_H = 52;
/** Collapsed plate half-extents: 184 wide, 60 tall. */
const platesAt = (ys: number[]) => ys.map((y) => ({ x: ZONES.dataLeft + 92, y, hw: 92, hh: 30 }));
const collides = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < NODE_W && Math.abs(a.y - b.y) < NODE_H;

test('the first frame is the authored frame, not a fit to the content', () => {
  // A fit is what produced the bottom-heavy scene: a two-object graph is small
  // beside the page and ends up centred in it.
  const framed = initialViewBox({ width: 1920, height: 990 });
  assert.equal(framed.viewBox, `${FRAME.x} ${FRAME.y} ${FRAME.width} ${FRAME.height}`);
  // Identical whatever the viewport, so the composition does not depend on it.
  const other = initialViewBox({ width: 1280, height: 720 });
  assert.equal(other.viewBox, framed.viewBox);
});

test('the frame reserves the right-hand gutter for the Drawer', () => {
  // The Drawer must never move anything, so its width is inside the frame.
  assert.ok(ZONES.gutterLeft + ZONES.gutterWidth <= FRAME.width, 'the gutter must fit the frame');
  assert.ok(ZONES.dataLeft + ZONES.dataWidth <= ZONES.gutterLeft, 'the data zone must end before the gutter');
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
   * Measured three times and wrong each time, which is why it is pinned here.
   *
   * The band between the context column and the data zone is 474 units wide. Two
   * 216-unit nodes need 248 of centre-to-centre pitch, so a row of n spans
   * 216 + (n-1)*248: two columns fit in 464, three would need 712. Rows are five
   * deep once the subject's clearance is respected, so the capacity is nine.
   *
   * Earlier readings of 5 and of 18 were both bugs -- a double-counted clearance
   * and a pitch that ignored the node's width -- not geometry. The number below is
   * derived from the same arithmetic the placement uses.
   */
  const full = loosePositions(9, new Array(9).fill('dependency'), [subjectPosition()]);
  assert.equal(full.overflowed, 0, 'nine peers fit the authored field');
  assert.equal(full.positions.length, 9);
  assert.equal(full.capacity, 9);

  // Past the budget, the overflow is reported rather than dropped: `grpc/grpc`
  // draws eleven loose peers, so this path is real.
  const over = loosePositions(11, new Array(11).fill('dependency'), [subjectPosition()]);
  assert.equal(over.overflowed, 2, 'the peers past the budget are reported');
  assert.equal(over.positions.length + over.overflowed, 11, 'every peer is accounted for');
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
