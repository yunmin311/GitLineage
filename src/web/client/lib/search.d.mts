/**
 * Types for the client search module. See `url-state.d.mts` for why these are
 * declared rather than compiled.
 */
import type { ViewGraph, ViewEdge } from '../../../web/view-model.ts';
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