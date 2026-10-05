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

/*
 * THE WORLD IS A FIXED SPATIAL COORDINATE SYSTEM.
 *
 * 1920 x 1720, never re-laid-out and never re-scaled to fit the viewport. The shell
 * is what adapts; this is what it adapts around. A world point means the same place
 * at every window size, and only the window over it moves -- which is the whole
 * reason a narrower viewport can be a shell change rather than a second design.
 *
 * It replaced a 1864 x 940 frame that was *fitted* to the viewport. Fitting meant the
 * world itself changed size with the window, so the same layout was a different
 * composition at every width, and any screen-coordinate comparison between two
 * viewports was really comparing two different worlds.
 */
export const WORLD = Object.freeze({ width: 1920, height: 1720 });

/** Node plate metrics, shared with the renderer so placement cannot drift from drawing. */
const NODE_W = 216;
const NODE_H = 52;
/** Collapsed plate width, used to keep loose nodes clear of the data zone. */
const PLATE_W = 184;

/**
 * The drawable field, derived once.
 *
 * The field runs from the world's left composition margin to a plate's left edge,
 * less one node's half-width and the clearance. It was computed inline in three
 * places and each copy disagreed: 474, then 226, then 448 for the same field, and the
 * capacity figure followed whichever copy ran. It is derived here so the walls, the
 * pitch and the capacity cannot disagree.
 */
/** Clearance between neighbouring objects. */
const FIELD_GAP = 16;

/** Where the drawable field begins: the world's left margin, plus half a node and clearance. */
const FIELD_LEFT = 48 + NODE_W / 2 + FIELD_GAP;

export function fieldGeometry() {
  const HALF_W = NODE_W / 2;
  const HALF_H = NODE_H / 2;
  const GAP = FIELD_GAP;
  const leftWall = FIELD_LEFT;
  const rightWall = ZONES.dataLeft - PLATE_W / 2 - GAP;
  const bandWidth = rightWall - leftWall;
  const slotPitch = NODE_W + GAP * 2;
  const maxPerRow = Math.max(1, Math.floor((bandWidth - NODE_W) / slotPitch) + 1);
  const floor = ZONES.bandTop - HALF_H - GAP;
  const ceiling = ZONES.dataTop - HALF_H - GAP;
  const pitch = NODE_H + 22;
  // Rows are a real derivation, not a multiplication. `maxPerRow * (rowsAbove +
  // rowsBelow)` was the capacity the budget spent while the placement filled rows
  // outwards from the subject -- and those are different numbers, because the nearest
  // row holds one peer rather than a full row. The budget said eighteen and the field
  // held fourteen, so four real relationships were aggregated for no reason at all.
  const distances = [];
  for (let step = 1; distances.length < 16; step += 1) {
    const below = ZONES.subject.y + 104 + (step - 1) * pitch;
    if (below + HALF_H + GAP > floor) break;
    distances.push(below);
  }
  for (let step = 1; distances.length < 16; step += 1) {
    const above = ZONES.subject.y - 104 - (step - 1) * pitch;
    if (above - HALF_H - GAP < ceiling) break;
    distances.push(above);
  }
  distances.sort((a, b) => Math.abs(a - ZONES.subject.y) - Math.abs(b - ZONES.subject.y));
  // Row widths grow with distance: a narrow row beside the subject, the full band
  // further out. The mass widens away from the anchor instead of forming a rectangle.
  const perRow = distances.map((_, index) => {
    const t = distances.length === 1 ? 0 : index / (distances.length - 1);
    return Math.max(1, Math.min(maxPerRow, 1 + Math.round(t * maxPerRow)));
  });
  return {
    HALF_W, HALF_H, GAP,
    leftWall, rightWall, bandWidth,
    bandMid: (leftWall + rightWall) / 2,
    slotPitch, maxPerRow,
    floor, ceiling, pitch,
    distances, perRow,
    capacity: perRow.reduce((sum, n) => sum + n, 0),
  };
}

/**
 * Columns the authored field supports.
 *
 * Derived from the geometry rather than asserted beside it. It was a literal `2`, and
 * it stayed 2 through a commit where `dataLeft` drifted right and the band quietly grew
 * to three columns -- so the constant and the geometry disagreed and nothing said so.
 *
 * A function, not a module-level const: the geometry reads `ZONES`, and a const would
 * evaluate it before `ZONES` is initialised.
 */
export function drawableColumns() {
  return fieldGeometry().maxPerRow;
}

/**
 * The field's capacity: how many peers it can hold without overlap.
 *
 * Derived from the zones, and the single number the composition budget spends, so
 * the two cannot disagree.
 */
export function capacity() {
  return fieldGeometry().capacity;
}

/** Node plate metrics, shared with the renderer so placement cannot drift from drawing. */
/** Collapsed plate width, used to keep loose nodes clear of the data zone. */

/** Zone anchors, in world units, measured off the frozen design. */
export const ZONES = Object.freeze({
  /**
   * The subject is the only mass with weight, and it never moves with the data.
   *
   * Measured, not chosen: it is where the design puts it, left of centre, so the data
   * mass reads as arriving *at* something rather than as a second column. It was a
   * literal at 700 while `dataLeft` was 1050, which put the field at three columns and
   * silently changed the composition's capacity.
   */
  subject: { x: 530, y: 560 },
  /**
   * The data zone. Derived from the field's requirement rather than hand-tuned, so
   * the walls, the pitch and the capacity cannot disagree.
   *
   * 786 is the design's own data-zone left edge. It is also what keeps the field at
   * two columns: the field runs from the world's left margin to a plate's left edge,
   * and a third 216-unit node on a 248 pitch would need 712 units where 506 exist.
   */
dataLeft: 786,
  dataTop: 200,
  dataWidth: 480,
  /**
   * The bottom band, and the edge key that lives on it.
   *
   * Both its extent and its position are constraints rather than preferences.
   *
   * The band is a world object, so it is on screen only where the window happens to
   * be -- and the window is the stage's own size, centred, because the world never
   * scales to fit. At 1280x800 the stage is 1280x756 and the window is world
   * 320..1600 by 182..938; at 1920 with the rail's 264 it is 132..1788 by 42..1078.
   * A band on the field's left wall (172) is clipped at 1280; one at the world's
   * margin (48) is clipped at 1920. And one at 980 is below the 800-tall window
   * entirely. 336..1520 by 900 sits inside every one of those windows, which is what
   * `the band is inside the opening window` exists to keep true.
   *
   * It sits at the bottom of the *authored composition*, not at the bottom of the
   * world: the world's extra height is headroom a reader pans into, and a key 700
   * units down would be only findable by panning.
   */
  bandTop: 900,
  bandLeft: 336,
  bandWidth: 1184,
  /** Where the Drawer's overlay is anchored. Never drawn on, never a placement target. */
  gutterLeft: 1548,
  gutterWidth: 372,
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
  // A stack that fits beside the subject is centred on the subject's line, so the
  // ties stay short and the mass reads as one group rather than as a plate hanging
  // in the corner. Only a genuinely tall stack starts at the authored zone top.
  const fitsBeside = subject.y - total / 2 >= ZONES.dataTop - 80;
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
  const G = fieldGeometry();
  const { HALF_W, HALF_H, GAP, leftWall, rightWall, floor, ceiling } = G;

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

  // The drawable field: between the world's left margin and the data zone, and
  // between the subject's upper allowance and the bottom band.
  //
  // The band runs 172..678 and the subject sits at 530, so it reaches further right
  // of the subject than left of it: 148 units against 358. Rows are therefore centred
  // on the *band* and clipped by its walls, which is what gives the mass its shape --
  // centring them on the subject instead pushed every row's right-hand slot past the
  // wall, where it was rejected, and each row silently held a single node.


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
  /*
   * The row plan, taken from the geometry rather than recomputed here.
   *
   * This function used to build its own `distances` and `perRow`, and `fieldGeometry`
   * used to build its own row count. Two derivations of the same shape meant the
   * budget and the placement could disagree, and they did: the budget promised
   * eighteen peers and the field placed fourteen. One plan, one answer.
   */
  const { distances, perRow } = G;
  const { slotPitch, bandMid } = G;

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
       * This is a composition limit, not a bug, and it is a stated one: the band runs
       * 172..678 at a 248 pitch, so a row holds two 216-unit nodes, and the rows widen
       * with distance -- the nearest holds one peer and the outer rows hold two. That
       * plan is `fieldGeometry().perRow` and its sum is `capacity()`.
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
 * The initial viewBox: the whole world, seen through a window of the viewport's size.
 *
 * The world is never scaled to fit. At zoom 1 one world unit is one CSS pixel, so a
 * narrow viewport shows *less of the world* rather than a shrunken copy of all of it --
 * which is what makes world coordinates comparable across window sizes at all. Fitting
 * (the previous behaviour) meant the world itself changed size with the window, so the
 * same layout was a different composition at every width.
 *
 * The window is centred on the world's horizontal midpoint and on the subject's own
 * line, then clamped so it can never show past the world's edge. Panning and zooming
 * are the reader's; nothing here is a content fit.
 */
export function initialViewBox(viewport) {
  const vw = Math.max(1, (viewport && viewport.width) || WORLD.width);
  const vh = Math.max(1, (viewport && viewport.height) || WORLD.height);
  // At zoom 1 the window is the viewport's own size in world units.
  const width = Math.min(WORLD.width, vw);
  const height = Math.min(WORLD.height, vh);
  const centreX = WORLD.width / 2;
  const centreY = ZONES.subject.y;
  return {
    viewBox: `${clamp(centreX - width / 2, 0, WORLD.width - width)} ${clamp(centreY - height / 2, 0, WORLD.height - height)} ${width} ${height}`,
    zoom: 1,
    world: WORLD,
  };
}

/** Keeps a value inside [min, max], so a window can never leave the world. */
function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * The viewBox for a camera position and zoom.
 *
 * The window is the viewport's size divided by the zoom, which is the only definition
 * that keeps a world unit the same physical size at every zoom level. It is then
 * clamped inside the world, so "the reader cannot pan into nothing" is structural
 * rather than a check somebody has to remember.
 */
export function viewBoxFor(viewport, pan, zoom) {
  const vw = Math.max(1, (viewport && viewport.width) || WORLD.width);
  const vh = Math.max(1, (viewport && viewport.height) || WORLD.height);
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const width = Math.min(WORLD.width, vw / z);
  const height = Math.min(WORLD.height, vh / z);
  const x = clamp((pan && Number.isFinite(pan.x) ? pan.x : WORLD.width / 2) - width / 2, 0, WORLD.width - width);
  const y = clamp((pan && Number.isFinite(pan.y) ? pan.y : ZONES.subject.y) - height / 2, 0, WORLD.height - height);
  return { viewBox: `${x} ${y} ${width} ${height}`, x, y, width, height, zoom: z };
}

/** The world point currently at the centre of a window. */
export function cameraCentre(viewBox) {
  const parts = String(viewBox || '').split(/\s+/).map(Number);
  if (parts.length < 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return { x: parts[0] + parts[2] / 2, y: parts[1] + parts[3] / 2 };
}

/**
 * Where the world's HTML layer lands inside a viewport.
 *
 * The overlays are authored in world units and go through the identical transform the
 * camera applies to the canvas, so an overlay always sits on the world coordinate it
 * annotates. This is the same derivation `viewBoxFor` performs, expressed as a
 * transform, because the overlays are HTML and the canvas is SVG.
 */
export function frameTransform(viewport, viewBox) {
  const parts = String(viewBox || '').split(/\s+/).map(Number);
  const vw = (viewport && viewport.width) || WORLD.width;
  const vh = (viewport && viewport.height) || WORLD.height;
  if (parts.length < 4 || parts.some((n) => !Number.isFinite(n)) || parts[2] <= 0) {
    return { scale: 1, x: 0, y: 0, width: WORLD.width, height: WORLD.height };
  }
  const scale = vw / parts[2];
  return {
    scale,
    // The world's origin sits at world x of the window's left edge, on screen.
    x: -parts[0] * scale,
    y: -parts[1] * scale,
    width: WORLD.width * scale,
    height: WORLD.height * scale,
  };
}

