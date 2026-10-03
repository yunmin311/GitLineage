/**
 * Graph geometry: layout slots, parallel-edge bowing, label anchors, and the
 * fit/zoom transform.
 *
 * Pure functions, no DOM.
 *
 * Direction is never computed here. `edge.arrow` and `edge.arrowheadAt` arrive
 * from the view-model, which derived them from `relationship.directed`. The only
 * geometry question this file answers is where a line is drawn.
 */

/**
 * Where each semantic slot sits relative to the subject, as a direction and a
 * distance in column units. The slot itself is a presentation decision made by
 * the view-model from relationship semantics; this file only turns it into
 * coordinates.
 */
export const SLOT_POSITIONS = {
  subject: { x: 0, y: 0, side: 'self' },
  upstream: { x: 0, y: -1, side: 'vertical' },
  downstream: { x: 0, y: 1, side: 'vertical' },
  'shared-near': { x: 1, y: 0, side: 'horizontal' },
  'attribution-far': { x: 1, y: -0.55, side: 'horizontal' },
  dependency: { x: 0.72, y: 0.95, side: 'horizontal' },
  similarity: { x: -1, y: 0, side: 'horizontal' },
};

// Wide enough for a real `owner/repository` name at the label size. A repository
// name is its identity, and shortening it to fit a narrower plate would throw
// away the one string a reader is actually looking for.
export const NODE_W = 216;
export const NODE_H = 52;
export const COL_GAP = 330;
export const ROW_GAP = 190;
/** Gap between adjacent nodes inside one slot's grid. */
export const NODE_GAP_X = 26;
export const NODE_GAP_Y = 22;
/** Past this many members a slot wraps into a second column instead of a line. */
export const SLOT_WRAP_AFTER = 6;
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 3;

/** Empty space kept between the subject and the nearest node of any slot. */
export const SUBJECT_CLEARANCE = 46;

/**
 * Lays a slot's members out as a grid centred on the slot's own centre.
 *
 * Real repositories produce hubs: `grpc/grpc` has 20 `uses_submodule` peers in
 * one slot. A single line would overprint every label and run off the canvas, so
 * a slot wraps into columns once it exceeds `SLOT_WRAP_AFTER` members.
 *
 * The grid is returned centred on the origin along with its half-extents. The
 * caller then pushes it away from the subject by exactly its own extent plus a
 * clearance, so a slot can never grow back into the subject.
 */
function slotGrid(members, side) {
  const count = members.length;
  const columns = side === 'vertical' ? 1 : Math.min(count, Math.max(1, Math.ceil(count / SLOT_WRAP_AFTER)));
  const rows = Math.ceil(count / columns);
  const stepX = NODE_W + NODE_GAP_X;
  const stepY = NODE_H + NODE_GAP_Y;

  const offsets = members.map((node, index) => {
    const column = columns === 1 ? 0 : index % columns;
    const row = Math.floor(index / columns);
    // Centre each column's contents against the grid's own vertical midpoint.
    const inColumn = Math.min(rows, count - column * rows);
    return {
      id: node.id,
      dx: (column - (columns - 1) / 2) * stepX,
      dy: (row - (inColumn - 1) / 2) * stepY,
    };
  });

  const halfWidth = columns === 1 ? NODE_W / 2 : ((columns - 1) * stepX) / 2 + NODE_W / 2;
  const tallestColumn = Math.min(rows, count);
  const halfHeight = ((tallestColumn - 1) * stepY) / 2 + NODE_H / 2;
  return { offsets, halfWidth, halfHeight, columns, rows };
}

/**
 * Places nodes by the semantic slot the view-model assigned.
 *
 * Only nodes reached by a visible edge are placed, so a bundled relationship's
 * endpoints do not leave an empty node stranded on the canvas.
 */
export function layoutGraph(view, visibleEdges) {
  const edges = visibleEdges || view.edges.filter((edge) => edge.visibility === 'primary');
  const connected = new Set([view.subject.id]);
  for (const edge of edges) {
    connected.add(edge.source);
    connected.add(edge.target);
  }

  const bySlot = new Map();
  for (const node of view.nodes) {
    if (!connected.has(node.id)) continue;
    const slot = node.slot || 'shared-near';
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push(node);
  }

  const positions = new Map();
  const originX = 470;
  const originY = 300;
  positions.set(view.subject.id, { x: originX, y: originY });

  // Subject first, then slots nearest the subject outwards, so the closest
  // semantic relationships sit closest to the centre of the picture.
  const order = ['upstream', 'shared-near', 'downstream', 'dependency', 'attribution-far', 'similarity'];
  const slots = [...bySlot.keys()].sort((a, b) => {
    const left = order.indexOf(a);
    const right = order.indexOf(b);
    return (left < 0 ? order.length : left) - (right < 0 ? order.length : right);
  });

  for (const slot of slots) {
    if (slot === 'subject') continue;
    const base = SLOT_POSITIONS[slot] || SLOT_POSITIONS['shared-near'];
    const grid = slotGrid(bySlot.get(slot), base.side);

    // Push the slot's centre away from the subject along each axis by that
    // axis' own half-extent plus a clearance, so a growing grid moves outwards
    // instead of back into the subject. A zero base component means "aligned on
    // this axis": `upstream` stacks directly above the subject rather than
    // drifting to one side.
    const centreX =
      originX + base.x * COL_GAP + (base.x === 0 ? 0 : (grid.halfWidth + SUBJECT_CLEARANCE) * Math.sign(base.x));
    const centreY =
      originY + base.y * ROW_GAP + (base.y === 0 ? 0 : (grid.halfHeight + SUBJECT_CLEARANCE) * Math.sign(base.y));

    for (const offset of grid.offsets) {
      positions.set(offset.id, { x: centreX + offset.dx, y: centreY + offset.dy });
    }
  }
  return positions;
}

/** Point where a line leaves a node box heading toward `toward`. */
export function nodeAnchor(node, toward) {
  const dx = toward.x - node.x;
  const dy = toward.y - node.y;
  const halfW = NODE_W / 2 + 6;
  const halfH = NODE_H / 2 + 6;
  if (dx === 0 && dy === 0) return { x: node.x, y: node.y };
  const scaleX = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : halfH / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: node.x + dx * scale, y: node.y + dy * scale };
}

/**
 * Which parallel-edge slot an edge occupies.
 *
 * Two repositories are routinely joined by several relationships at once — a
 * fork also shares history and identical content — and those edges would
 * otherwise be drawn on top of each other with overprinted labels.
 */
export function fanSlot(edge, edges) {
  const key = [edge.source, edge.target].sort().join('|');
  const parallel = edges.filter((item) => [item.source, item.target].sort().join('|') === key);
  return { fanIndex: parallel.indexOf(edge), fanCount: parallel.length };
}

/**
 * Degree of every node in the edge list.
 *
 * A hub like `grpc/grpc` has 20 distinct submodule peers, so every one of those
 * edges is a parallel fan of one and its label sits mid-line — all of them within
 * a few pixels of each other. Node degree is the signal that actually predicts
 * label collision, so it is what the renderer gates on.
 */
export function nodeDegrees(edges) {
  const degrees = new Map();
  const bump = (id) => degrees.set(id, (degrees.get(id) ?? 0) + 1);
  for (const edge of edges) {
    bump(edge.source);
    bump(edge.target);
  }
  return degrees;
}

/** True when either endpoint is busy enough that mid-line labels would collide. */
export function isCrowdedEdge(edge, degrees, limit) {
  return (degrees.get(edge.source) ?? 0) > limit || (degrees.get(edge.target) ?? 0) > limit;
}

export function edgeGeometry(edge, positions, fanIndex, fanCount) {
  const a = positions.get(edge.source);
  const b = positions.get(edge.target);
  if (!a || !b) return null;

  const start = nodeAnchor(a, b);
  const end = nodeAnchor(b, a);

  const spread = fanCount > 1 ? (fanIndex - (fanCount - 1) / 2) * 34 : 0;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const px = (-dy / length) * spread;
  const py = (dx / length) * spread;

  const midX = (start.x + end.x) / 2 + px;
  const midY = (start.y + end.y) / 2 + py;
  const path = `M ${start.x} ${start.y} Q ${midX} ${midY} ${end.x} ${end.y}`;

  // Label anchor: each edge in a parallel group is labelled at its own point on
  // the curve, so labels separate along the line as well as across it.
  const t = fanCount > 1 ? 0.26 + (fanIndex * 0.48) / Math.max(fanCount - 1, 1) : 0.5;
  const inv = 1 - t;
  const labelPoint = {
    x: inv * inv * start.x + 2 * inv * t * midX + t * t * end.x,
    y: inv * inv * start.y + 2 * inv * t * midY + t * t * end.y,
  };

  const side = spread >= 0 ? 1 : -1;
  const clearance = Math.abs(spread) / 2 + 16;

  return {
    start,
    end,
    path,
    spread,
    // Arrow placement is data, not geometry.
    arrowAt: edge.arrow === 'none' ? null : end,
    label: {
      x: labelPoint.x + side * clearance,
      y: labelPoint.y - 6,
      anchor: 'start',
    },
    badge: {
      x: labelPoint.x + side * clearance,
      y: labelPoint.y + 8,
      anchor: 'start',
    },
  };
}

/** Bounding box of the laid-out graph, used by fit-to-view. */
export function contentBounds(positions) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const position of positions.values()) {
    minX = Math.min(minX, position.x - NODE_W);
    maxX = Math.max(maxX, position.x + NODE_W);
    minY = Math.min(minY, position.y - NODE_H);
    maxY = Math.max(maxY, position.y + NODE_H);
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function clampZoom(zoom) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** ViewBox that fits `bounds` into a `viewport`, with margin. */
export function fitViewBox(bounds, viewport, margin = 70) {
  const width = Math.max(viewport.width || 0, 1);
  const height = Math.max(viewport.height || 0, 1);
  // A viewport narrower than the margin still has to show the content, so the
  // usable area is clamped rather than allowed to go negative.
  const usableWidth = Math.max(width - margin * 2, width * 0.2);
  const usableHeight = Math.max(height - margin * 2, height * 0.2);
  const scale = Math.min(usableWidth / Math.max(bounds.width, 1), usableHeight / Math.max(bounds.height, 1));
  const zoom = clampZoom(Number.isFinite(scale) && scale > 0 ? scale : 1);
  const viewWidth = width / zoom;
  const viewHeight = height / zoom;
  return {
    viewBox: `${bounds.x + bounds.width / 2 - viewWidth / 2} ${bounds.y + bounds.height / 2 - viewHeight / 2} ${viewWidth} ${viewHeight}`,
    zoom,
  };
}

/**
 * Zooms the viewBox around a focus point.
 *
 * `factor > 1` zooms in. The viewBox shrinks about the focus, which is the point
 * under the cursor (or the graph centre when no pointer is involved).
 *
 * `currentZoom` is the absolute zoom the viewBox is at, so the returned zoom is
 * absolute too and the control can show a truthful number.
 */
export function zoomViewBox(current, factor, focus, currentZoom = 1) {
  const parts = String(current).split(/\s+/).map(Number);
  const [x, y, width, height] = parts;
  if (![x, y, width, height].every(Number.isFinite)) return { viewBox: current, zoom: currentZoom };
  const nextZoom = clampZoom(currentZoom * factor);
  if (!(nextZoom > 0) || nextZoom === currentZoom) return { viewBox: current, zoom: currentZoom };
  const safeFactor = nextZoom / currentZoom;

  const nextWidth = width / safeFactor;
  const nextHeight = height / safeFactor;

  const fx = focus ? focus.x : x + width / 2;
  const fy = focus ? focus.y : y + height / 2;
  const ratioX = (fx - x) / (width || 1);
  const ratioY = (fy - y) / (height || 1);
  const nextX = fx - nextWidth * ratioX;
  const nextY = fy - nextHeight * ratioY;

  return {
    viewBox: `${nextX} ${nextY} ${nextWidth} ${nextHeight}`,
    zoom: nextZoom,
  };
}