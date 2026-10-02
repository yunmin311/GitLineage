/**
 * Types for the client search module. See `url-state.d.mts` for why these are
 * declared rather than compiled.
 */
import type { ViewGraph, ViewEdge, ViewBundle } from '../../../web/view-model.ts';
import type { LayerState } from './url-state.mjs';

export interface VisibleEdgeOptions {
  layers?: Partial<LayerState>;
  expandedBundles?: Set<string>;
}

export declare function normalizeQuery(raw: string): string;
export declare function searchNodes(view: ViewGraph, query: string): string[];
export declare function searchEdges(view: ViewGraph, query: string): string[];
export declare function edgesForNode(view: ViewGraph, nodeId: string): string[];
export declare function allLayersOn(): LayerState;
export declare function layerCount(view: ViewGraph, layers: Partial<LayerState>): Record<string, number>;
export declare function visibleEdges(view: ViewGraph, options: VisibleEdgeOptions): ViewEdge[];

/**
 * Whether the canvas would be left with no drawn relationships.
 *
 * Real repositories whose entire story is declared dependencies produce this:
 * every relationship is a bulk family, so all of them are bundled and the default
 * view has nothing to draw. It is visually identical to a genuine empty result,
 * which is misleading.
 */
export declare function hasDrawnEdges(view: ViewGraph, options: VisibleEdgeOptions): boolean;

/** Bundles that have no drawn representative, i.e. everything when nothing is drawn. */
export declare function orphanBundles(view: ViewGraph, options: VisibleEdgeOptions): ViewBundle[];