/**
 * Types for the authored-composition module. See `url-state.d.mts` for why these
 * are declared rather than compiled.
 */
import type { ViewGraph, LayoutSlot } from '../../../web/view-model.ts';

/**
 * The retired authored frame. Kept only so a diagnostic can name what it replaced;
 * nothing places geometry against it and no viewport scales to it any more.
 */
export declare const FRAME: Readonly<{ x: number; y: number; width: number; height: number }>;

/**
 * The world: a fixed spatial coordinate system.
 *
 * Never re-laid-out and never re-scaled to fit. A world point means the same place at
 * every window size; only the window over it moves. The shell adapts around this.
 */
export declare const WORLD: Readonly<{ width: number; height: number }>;


/** Zone anchors, in world units. The rail and Drawer are shell columns and reserve none. */
export declare const ZONES: Readonly<{
  subject: { x: number; y: number };
  /**
   * Left edge of the data zone.
   *
   * Derived from the field requirement rather than hand-tuned: the field needs
   * `NODE_W + slotPitch` for two columns, and the zone is that far from the world's
   * left margin plus a plate's width. It was a constant and it was short twice.
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
  /** Row-to-row pitch between placement rows. */
  pitch: number;
  /** Row centres from the subject, nearest first: the fill order. */
  distances: number[];
  /** How many peers each of those rows holds, widening with distance. */
  perRow: number[];
  /** `perRow` summed. The one number the composition budget spends. */
  capacity: number;
}

/** Columns the field supports, derived from its own geometry. */
export declare function drawableColumns(): number;

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
 * How tall a mass may draw, in the two states it can be in.
 *
 * The renderer measures these with the same function it draws with, so the reservation and
 * the plate cannot disagree about how tall the mass is.
 */
export interface MassReservations {
  /** Its header, and its rows while it is shut. */
  collapsedHeight: number;
  /** Its header and every row, which is the most it can ever ask for. */
  expandedHeight: number;
  /** Which of the two it wants right now. */
  currentHeight: number;
}

export interface MassStackOptions {
  /** Space left between two masses, which the layout may close but never past zero. */
  gap?: number;
  /** How much one member row is worth, used to step a mass down when it yields. */
  rowPitch?: number;
  /** The height of a mass with its header and nothing else. */
  shutHeight?: (plate: MassReservations & { open?: boolean; expanded?: boolean }) => number;
  /** The band the stack is not allowed to start above. */
  upper?: number;
  /** The band the stack is not allowed to pass below. */
  lower?: number;
}

export interface MassSlot {
  key: string;
  x: number;
  y: number;
  height: number;
  /** False when the masses could not all fit, so the caller can say so. */
  overflow: boolean;
}

/**
 * Masses placed as one ordered column against the two zone bounds.
 *
 * The stack is placed as a whole: it is never pushed above the upper bound nor below the
 * lower one, and when it does not fit the open masses yield rows before anything is allowed
 * to leave the zone. What a mass gives up is reported, never silently drawn.
 */
export declare function layoutMassStacks(
  plates: Array<{ key: string; open?: boolean; expanded?: boolean } & MassReservations>,
  options?: MassStackOptions,
): Map<string, MassSlot>;

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

/**
 * The opening window onto the world: a viewport-sized window at zoom 1, centred on the
 * world's midpoint and the subject's line, then clamped inside the world.
 *
 * The world is never scaled to fit. A narrow viewport shows less of the world rather
 * than a shrunken copy of all of it.
 */
export declare function initialViewBox(viewport: {
  width: number;
  height: number;
}): { viewBox: string; zoom: number; world: Readonly<{ width: number; height: number }> };

/** The window for a camera centre and zoom, clamped so it cannot leave the world. */
export declare function viewBoxFor(
  viewport: { width: number; height: number },
  pan: { x: number; y: number } | undefined,
  zoom: number | undefined,
): { viewBox: string; x: number; y: number; width: number; height: number; zoom: number };

/** The world point at the centre of a window, or null if the viewBox is unusable. */
export declare function cameraCentre(viewBox: string | null | undefined): { x: number; y: number } | null;

/**
 * Where the world's HTML layer lands inside a viewport.
 *
 * The same mapping the SVG's `viewBox` performs, expressed as a transform, because the
 * overlays are HTML and the canvas is SVG. Both are put through this one derivation so
 * an overlay always sits on the world coordinate it annotates.
 */
export declare function frameTransform(
  viewport: { width: number; height: number },
  viewBox: string | null | undefined,
): { scale: number; x: number; y: number; width: number; height: number };
