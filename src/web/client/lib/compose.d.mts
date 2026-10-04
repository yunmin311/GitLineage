/**
 * Types for the authored-composition module. See `url-state.d.mts` for why these
 * are declared rather than compiled.
 */
import type { ViewGraph, LayoutSlot } from '../../../web/view-model.ts';

/** The authored world frame, in world units. Includes the reserved right gutter. */
/**
 * Columns the authored band supports.
 *
 * Two, and that is a geometric limit rather than a preference: the band between the
 * context column and the data zone is 474 units wide and two 216-unit nodes need
 * 248 of centre-to-centre pitch, so three would not fit. Extra capacity is taken
 * from height instead.
 */
export declare const DRAWABLE_COLUMNS: number;

export declare const FRAME: Readonly<{ x: number; y: number; width: number; height: number }>;

/** Zone anchors, taken from the frozen design. */
export declare const ZONES: Readonly<{
  contextLeft: number;
  contextTop: number;
  contextWidth: number;
  subject: { x: number; y: number };
  /**
   * Left edge of the data zone.
   *
   * Derived from the field requirement rather than hand-tuned: the field needs
   * `NODE_W + slotPitch` for two columns, and the zone is that far from the
   * context column plus a plate's width. It was a constant and it was short twice.
   */
  dataLeft: number;
  dataTop: number;
  dataWidth: number;
  bandTop: number;
  bandLeft: number;
  bandWidth: number;
  gutterLeft: number;
  gutterWidth: number;
}>;

/**
 * The drawable field, derived once from the zones.
 *
 * Derived rather than restated, because three independent copies of this arithmetic
 * disagreed three times and the capacity figure followed whichever ran.
 */
export interface FieldGeometry {
  HALF_W: number;
  HALF_H: number;
  GAP: number;
  leftWall: number;
  rightWall: number;
  bandWidth: number;
  bandMid: number;
  slotPitch: number;
  maxPerRow: number;
  floor: number;
  ceiling: number;
  capacity: number;
}

export declare function fieldGeometry(): FieldGeometry;

/** How many peers the authored field holds without overlap. */
export declare function capacity(): number;

export interface ComposedPosition {
  x: number;
  y: number;
  height?: number;
  slot?: LayoutSlot;
}

export declare function subjectPosition(): { x: number; y: number };

/** Entries stacked down the data zone, each given its authored y. */
export declare function dataZonePositions(entries: Array<{ height: number }>): ComposedPosition[];

/**
 * Loose relationships placed on a downward-opening arc around the subject.
 *
 * Never upward: nothing may land in the empty upper field.
 */
export interface PlacementResult {
  positions: ComposedPosition[];
  /** How many could not be placed because the authored field was full. */
  overflowed: number;
  /** How many the authored field can hold, derived from the real row list. */
  capacity: number;
}

export declare function loosePositions(
  count: number,
  slots: LayoutSlot[],
  existing: ComposedPosition[],
  /** Plate extents to keep clear, as `{ x, y, hw, hh }` half-extents. */
  reserved?: Array<{ x: number; y: number; hw?: number; hh?: number }>,
): PlacementResult;

/** The authored frame as a viewBox, scaled to the viewport. Not a content fit. */
export declare function initialViewBox(viewport: { width: number; height: number }): { viewBox: string; zoom: number };

/**
 * Where the authored frame lands inside a viewport: the uniform scale the SVG's
 * default `meet` behaviour applies, plus the centred remainder.
 *
 * The HTML overlays are put through this so they keep their authored positions at
 * every viewport instead of only at the one whose scale happens to be about one.
 */
export declare function frameTransform(viewport: {
  width: number;
  height: number;
}): { scale: number; x: number; y: number; width: number; height: number };
