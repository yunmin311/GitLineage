/**
 * Authored composition.
 *
 * The scene is placed at authored coordinates rather than fitted to whatever the
 * content happens to be. Automatic layout plus `fitViewBox` produces a small graph
 * centred in a large empty field, which reads as a diagram that failed to fill its
 * page; the frozen design instead treats the canvas as a composed surface with
 * three active zones and a bottom band.
 *
 * The frame is the design's own, in world units:
 *
 *   L   x   46..542   context column: provenance, status, census, keys
 *   C   centre       the subject: the only mass with weight
 *   R   x 1016..1502  data mass: aggregate plates and loose topology
 *       y 876        bottom band: edge treatment key and camera state
 *       x 1548       reserved gutter, so the Drawer never moves anything
 *
 * Authoring the frame rather than fitting it is what makes the first paint already
 * composed. It also means expanding a plate cannot change where anything else is,
 * because the frame does not depend on the content.
 */

/** The authored world frame. Width includes the reserved right gutter. */
export const FRAME = Object.freeze({ x: 0, y: 0, width: 1864, height: 940 });

/** Node plate metrics, shared with the renderer so placement cannot drift from drawing. */
const NODE_W = 216;
const NODE_H = 52;
/** Collapsed plate width, used to keep loose nodes clear of the data zone. */
const PLATE_W = 184;

/**
 * Distinct peers the authored field holds before anything overflows.
 *
 * Three columns by the number of rows between the subject's line and the bottom
 * band, plus a small allowance above. `grpc/grpc` draws eleven loose peers, and
 * this is derived from the geometry rather than guessed, because a wrong figure
 * here would let a real relationship be dropped without anyone noticing.
 */
// Two columns, because the band supports two: 474 units wide, and two 216-unit
// nodes need 248 of pitch. A third would overlap, and a layout that overlaps is
// not a layout.
export const DRAWABLE_COLUMNS = 2;

/** Zone anchors, taken from the frozen design. */
export const ZONES = Object.freeze({
  contextLeft: 46,
  contextTop: 128,
  contextWidth: 496,
  subject: { x: 730, y: 478 },
  dataLeft: 1016,
  dataTop: 236,
  dataWidth: 486,
  bandTop: 876,
  bandLeft: 46,
  bandWidth: 1456,
  gutterLeft: 1548,
  gutterWidth: 316,
});

/**
 * Where the subject sits.
 *
 * Fixed, and independent of how much else there is. A composition whose anchor
 * moves with its content is not an anchor.
 */
export function subjectPosition() {
  return { x: ZONES.subject.x, y: ZONES.subject.y };
}

/**
 * Lays the data mass down the right-hand zone.
 *
 * Plates are stacked from the authored top of the zone, so the subject-to-plate
 * tie is short and near-horizontal instead of fanning into long diagonals. The
 * left edge is fixed and each entry widens away from the subject when open.
 */
export function dataZonePositions(entries) {
  const positions = [];
  if (!entries.length) return positions;

  // The zone's authored top is above the subject, which suits a tall column of
  // plates. A short stack would then sit high in the frame joined by one long
  // upward diagonal, so a stack that fits beside the subject is aligned to the
  // subject's line instead and grows downward. Only a genuinely tall stack uses
  // the authored top.
  const total = entries.reduce((sum, entry) => sum + entry.height + 26, -26);
  const subject = subjectPosition();
  // Centre the stack on the subject's line whenever it fits above the bottom band.
  // Letting it start at the authored top instead is what left the dense graph
  // sitting low with a large dead field above it.
  const fitsBeside = subject.y - total / 2 >= ZONES.dataTop - 60 && subject.y + total / 2 <= ZONES.bandTop - 40;
  let cursor = fitsBeside ? Math.round(subject.y - total / 2) : ZONES.dataTop;

  for (const entry of entries) {
    positions.push({ x: ZONES.dataLeft, y: cursor, height: entry.height });
    cursor += entry.height + 26;
  }
  return positions;
}

/**
 * Places loose relationships in the field around the subject.
 *
 * Deliberately not a slot grid and not a plain arc. An arc alone collides as soon
 * as there are more than a handful of peers -- measured at 19 overlapping pairs
 * for fifteen nodes -- because the arc is one-dimensional while the plates are
 * 216 units wide. So placement is a ring walk with an explicit occupancy test:
 * candidate positions are generated on widening rings, and any that would overlap
 * an already-placed node or a reserved plate is rejected and the ring is widened.
 *
 * Nothing is placed upward, so the empty upper field stays empty on purpose.
 */
export function loosePositions(count, slots, existing, reserved = []) {
  const subject = subjectPosition();
  const HALF_W = NODE_W / 2;
  const HALF_H = NODE_H / 2;
  const GAP = 16;

  // Occupied rectangles, kept as real boxes rather than centre points. A
  // centre-point test with summed half-extents double-counts the clearance and
  // rejects positions that are actually fine; this compares extents properly.
  const boxes = [];
  const addBox = (x, y, hw, hh) => boxes.push({ x0: x - hw, x1: x + hw, y0: y - hh, y1: y + hh });

  addBox(subject.x, subject.y, HALF_W + 28, HALF_H + 28);
  for (const box of reserved) {
    const hw = box.hw != null ? box.hw : PLATE_W / 2;
    const hh = box.hh != null ? box.hh : 40;
    // Only the band this plate actually occupies is reserved. Reserving a
    // whole column for every plate blocked rows that were perfectly usable and
    // shrank the field for no reason.
    addBox(box.x, box.y, hw, hh);
  }

  for (const box of existing) {
    const hw = box.hw != null ? box.hw : HALF_W;
    const hh = box.hh != null ? box.hh : HALF_H;
    addBox(box.x, box.y, hw, hh);
  }

  // One unit everywhere: half-extents, expanded into a rectangle once. Mixing
  // half-extents and full extents here is what let a node overlap a plate while
  // the test reported it clear.
  const collides = (x, y) =>
    boxes.some((b) =>
      x - HALF_W - GAP < b.x1 && x + HALF_W + GAP > b.x0 &&
      y - HALF_H - GAP < b.y1 && y + HALF_H + GAP > b.y0);

  // Rows are placed on a fixed pitch; a node may only occupy its own row band.
  // The horizontal slide below therefore cannot move a node into a neighbouring
  // row, which is what keeps the count of overlaps at zero.

  // The drawable field: between the context column and the data zone, and between
  // the subject's upper allowance and the bottom band.
  // The field runs from the right edge of the context column to the left edge of
  // the data zone. The subject sits at 730, so this band is off-centre: it reaches
  // further right of the subject than left of it. Rows are therefore centred on the
  // subject and clipped by these walls, which is what gives the mass its shape.
  const leftWall = ZONES.contextLeft + ZONES.contextWidth / 2 + HALF_W + GAP;
  const rightWall = ZONES.dataLeft - HALF_W - GAP;
  const floor = ZONES.bandTop - HALF_H - GAP;
  // The upper allowance reaches the authored data-zone top rather than a fixed
  // distance above the subject: eleven peers did not fit in the lower field
  // alone, and dropping the eleventh would have hidden a real relationship.
  const ceiling = ZONES.dataTop - HALF_H - GAP;

  const positions = [];

  /*
   * Rows nearest the subject first, widening outward.
   *
   * A uniform grid was rejected on sight: two columns of equal rows read as a
   * mechanical stack, which is exactly what the frozen composition forbids. So
   * each row holds a different number of peers, growing with distance, and rows
   * are centred on the subject's x. The mass then reads as a constellation that
   * widens away from the anchor rather than as a table.
   */
  const pitch = NODE_H + 22;
  const perRow = [];
  // Distances from the subject, nearest first. Below the subject's line comes
  // first because that is where the eye goes; the allowance above is used last.
  const distances = [];
  for (let step = 1; step <= 8; step += 1) {
    const below = subject.y + 104 + (step - 1) * pitch;
    if (below + HALF_H + GAP <= floor) distances.push(below);
  }
  for (let step = 1; step <= 8; step += 1) {
    const above = subject.y - 104 - (step - 1) * pitch;
    if (above - HALF_H - GAP >= ceiling) distances.push(above);
  }
  // Nearest first, so the fill order is the reading order.
  distances.sort((a, b) => Math.abs(a - subject.y) - Math.abs(b - subject.y));

  /*
   * Row widths grow with distance: a narrow row beside the subject, the full band
   * further out. The mass then widens away from the anchor instead of forming a
   * rectangle.
   *
   * Rows are centred on the *band*, not on the subject. The subject sits at 730
   * and the band runs 418..892, so centring on the subject pushed every row's
   * right-hand slot outside the band, where the wall check rejected it and each
   * row silently held a single node.
   */
  const bandWidth = rightWall - leftWall;
  const bandMid = (leftWall + rightWall) / 2;
  // Centre-to-centre distance that actually clears a neighbour. This must be the
  // same arithmetic the collision test uses -- `NODE_W + GAP` is 232 while a node
  // needs 248, so the old pitch left adjacent slots overlapping by one gap and the
  // row could never hold more than one node.
  const slotPitch = NODE_W + GAP * 2;
  // A row of n slots spans NODE_W + (n - 1) * slotPitch, so the count that fits is
  // derived by solving for n rather than by dividing the band by the pitch, which
  // ignores the node's own width and undercounts by one.
  const maxPerRow = Math.max(1, Math.floor((bandWidth - NODE_W) / slotPitch) + 1);
  for (let index = 0; index < distances.length; index += 1) {
    const t = distances.length === 1 ? 0 : index / (distances.length - 1);
    // Nearest rows hold one peer; outer rows fill to what the band allows.
    perRow.push(Math.max(1, Math.min(maxPerRow, 1 + Math.round(t * maxPerRow))));
  }

  const capacity = perRow.reduce((sum, n) => sum + n, 0);
  let overflowed = 0;

  for (let index = 0; index < count; index += 1) {
    let placed = null;

    // Walk rows outward until one has a free slot.
    for (let r = 0; r < perRow.length && !placed; r += 1) {
      const rowY = Math.round(distances[r]);
      const slots = perRow[r];
      // Slot centres across the band, centred on the band midpoint, on the pitch
      // that clears a neighbour.
      const span = slots === 1 ? 0 : (slots - 1) * slotPitch;
      for (let c = 0; c < slots && !placed; c += 1) {
        const offset = slots === 1 ? 0 : (c / (slots - 1) - 0.5) * span;
        const candidate = { x: Math.round(bandMid + offset), y: rowY };
        // leftWall and rightWall already contain the half-width and the clearance.
        // Re-adding them here double-counted 124 units and rejected both columns:
        // capacity read 5 while the band holds 10.
        if (candidate.x < leftWall || candidate.x > rightWall) continue;
        if (collides(candidate.x, candidate.y)) continue;
        placed = candidate;
      }
    }

    if (!placed) {
      /*
       * The authored field is full.
       *
       * This is a composition limit, not a bug: the band is 474 units wide and two
       * 216-unit nodes need 248 of pitch, and the usable height leaves five rows.
       * That is a capacity of ten, so an eleven-peer graph is genuinely over the
       * field's budget.
       *
       * The node is not drawn loose. It is reported, so the caller can aggregate it
       * into a plate instead -- which is the mechanism that already exists and is
       * the honest answer: past the budget, relationships group rather than spill.
       * Silently dropping it would show fewer relationships than exist.
       */
      overflowed += 1;
      continue;
    }

    addBox(placed.x, placed.y, HALF_W, HALF_H);
    positions.push({ x: placed.x, y: placed.y, slot: slots[index] });
  }

  return { positions, overflowed, capacity };
}

/**
 * The initial viewBox.
 *
 * The authored frame, not a fit. Fitting is what produced the bottom-heavy scene
 * with a large inactive upper area, because a two-object graph is tiny next to the
 * page and gets centred in it.
 */
export function initialViewBox(viewport) {
  const scale = Math.min(
    (viewport.width || FRAME.width) / FRAME.width,
    (viewport.height || FRAME.height) / FRAME.height,
  );
  const zoom = scale > 0 && Number.isFinite(scale) ? scale : 1;
  return {
    viewBox: `${FRAME.x} ${FRAME.y} ${FRAME.width} ${FRAME.height}`,
    zoom,
  };
}
