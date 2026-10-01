/**
 * Types for the client geometry module. See `url-state.d.mts` for why these are
 * declared rather than compiled.
 */
import type { ViewGraph, ViewEdge } from '../../../web/view-model.ts';

export interface Point {
  x: number;
  y: number;
}

export interface LabelPoint extends Point {
  anchor: string;
}

export interface SlotPosition {
  x: number;
  y: number;
}

export type LayoutSlot =
  | 'subject'
  | 'upstream'
  | 'downstream'
  | 'dependency'
  | 'shared-near'
  | 'attribution-far'
  | 'similarity';

export interface FanSlot {
  fanIndex: number;
  fanCount: number;
}

export interface EdgeGeometry {
  start: Point;
  end: Point;
  path: string;
  spread: number;
  /**
   * Where the arrowhead sits, or `null` for a symmetric relationship. This is
   * derived from `edge.arrow`, which the server derived from
   * `relationship.directed`. It is never computed here.
   */
  arrowAt: Point | null;
  label: LabelPoint;
  badge: LabelPoint;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewBox {
  viewBox: string;
  zoom: number;
}

export declare const SLOT_POSITIONS: Record<LayoutSlot, SlotPosition>;
export declare const NODE_W: number;
export declare const NODE_H: number;
export declare const COL_GAP: number;
export declare const ROW_GAP: number;
export declare const MIN_ZOOM: number;
export declare const MAX_ZOOM: number;

export declare function layoutGraph(view: ViewGraph, visibleEdges: ViewEdge[]): Map<string, Point>;
export declare function nodeAnchor(node: Point, toward: Point): Point;
export declare function fanSlot(edge: ViewEdge, edges: ViewEdge[]): FanSlot;
export declare function nodeDegrees(edges: ViewEdge[]): Map<string, number>;
export declare function isCrowdedEdge(edge: ViewEdge, degrees: Map<string, number>, limit: number): boolean;
export declare function edgeGeometry(
  edge: ViewEdge,
  positions: Map<string, Point>,
  fanIndex: number,
  fanCount: number,
): EdgeGeometry | null;
export declare function contentBounds(positions: Map<string, Point>): Bounds;
export declare function clampZoom(zoom: number): number;
export declare function fitViewBox(bounds: Bounds, viewport: { width: number; height: number }, margin?: number): ViewBox;
export declare function zoomViewBox(current: string, factor: number, focus?: Point | null, currentZoom?: number): ViewBox;