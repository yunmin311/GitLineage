/**
 * Camera invariants.
 *
 * The camera is the SVG `viewBox` plus the zoom factor. "Nothing moved" is not a
 * single fact: pan, zoom, viewport centre and world focal are four different
 * quantities, and a change can hold three of them still while breaking the
 * fourth. They are computed separately here so a regression in any one of them
 * is visible on its own.
 *
 * Nothing in this file performs input handling or touches the DOM; it only
 * describes and compares camera state, which is what makes it testable.
 */

/** How the camera may be affected by a change to the scene. */
export const RefitTrigger = Object.freeze({
  /**
   * The scene is a different graph, or the same graph at a different depth.
   * What is on screen is not comparable with the new content, so the camera is
   * refitted. This is the only trigger that refits.
   */
  Dataset: 'dataset',
  /**
   * The same graph rearranged in place: an aggregate expanded or collapsed, an
   * object selected, the Drawer opened or closed. The camera must not move.
   */
  Local: 'local',
});

/**
 * Whether a change may move the camera.
 *
 * Local changes never refit. `moved = 0` alone is not sufficient evidence of
 * camera stability, so this is deliberately a separate question from layout:
 * expansion is allowed to reflow rows inside its own plate, and the camera is
 * required to stay exactly where it was regardless.
 */
export function shouldRefit(trigger) {
  return trigger === RefitTrigger.Dataset;
}

/** Parses a `viewBox` attribute into its four numbers, or null if unusable. */
export function parseViewBox(viewBox) {
  const parts = String(viewBox == null ? '' : viewBox).trim().split(/[\s,]+/).map(Number);
  const [x, y, width, height] = parts;
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return null;
  if (!(width > 0) || !(height > 0)) return null;
  return { x, y, width, height };
}

/**
 * The camera, broken into the four quantities that must hold still.
 *
 * `panX`/`panY` are the world coordinate at the viewport's top-left.
 * `centreX`/`centreY` are the world point at the middle of the viewport.
 * `focalX`/`focalY` are the world focal point: the same point, carried
 * explicitly, because it is the value a reader actually perceives as "what I am
 * looking at" and it must not shift even if pan and size were to agree.
 */
export function cameraState(viewBox, zoom = 1) {
  const box = parseViewBox(viewBox);
  if (!box) {
    return {
      valid: false,
      viewBox: viewBox == null ? '' : String(viewBox),
      zoom: Number.isFinite(zoom) ? zoom : 1,
      panX: NaN, panY: NaN, width: NaN, height: NaN,
      centreX: NaN, centreY: NaN, focalX: NaN, focalY: NaN,
    };
  }
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  return {
    valid: true,
    viewBox: `${box.x} ${box.y} ${box.width} ${box.height}`,
    zoom: Number.isFinite(zoom) ? zoom : 1,
    panX: box.x,
    panY: box.y,
    width: box.width,
    height: box.height,
    centreX,
    centreY,
    focalX: centreX,
    focalY: centreY,
  };
}

/** Exact equality on all four camera quantities, compared field by field. */
export function sameCamera(a, b, epsilon = 0) {
  if (!a || !b) return false;
  if (a.valid !== b.valid) return false;
  if (!a.valid) return a.viewBox === b.viewBox;
  const fields = ['zoom', 'panX', 'panY', 'width', 'height', 'centreX', 'centreY', 'focalX', 'focalY'];
  return fields.every((field) => {
    const left = a[field];
    const right = b[field];
    if (typeof left !== 'number' || typeof right !== 'number') return left === right;
    return Math.abs(left - right) <= epsilon;
  });
}

/**
 * Where a world point lands on screen.
 *
 * This is the check that catches the failure `sameCamera` cannot see on its own:
 * two different cameras can agree on the centre while placing content elsewhere,
 * because the viewport aspect ratio also decides the mapping.
 */
export function worldToScreen(viewBox, viewport, point) {
  const box = parseViewBox(viewBox);
  const width = (viewport && viewport.width) || 0;
  const height = (viewport && viewport.height) || 0;
  if (!box || !(width > 0) || !(height > 0)) return null;
  const scaleX = width / box.width;
  const scaleY = height / box.height;
  return {
    x: (point.x - box.x) * scaleX,
    y: (point.y - box.y) * scaleY,
    scaleX,
    scaleY,
  };
}

/**
 * A readable summary of the camera differences that matter.
 *
 * Returns an empty object when the two cameras agree, and otherwise names the
 * quantities that moved. A test or a diagnostic can report it directly, so a
 * regression says which invariant broke rather than only that something did.
 */
export function cameraDiff(before, after) {
  if (sameCamera(before, after)) return {};
  const fields = {
    zoom: 'zoom',
    panX: 'pan',
    panY: 'pan',
    width: 'zoom',
    height: 'zoom',
    centreX: 'centre',
    centreY: 'centre',
    focalX: 'worldFocal',
    focalY: 'worldFocal',
  };
  const moved = {};
  for (const [field, label] of Object.entries(fields)) {
    const left = before && before[field];
    const right = after && after[field];
    if (typeof left === 'number' && typeof right === 'number' && Math.abs(left - right) > 0) {
      moved[label] = true;
    }
  }
  return moved;
}