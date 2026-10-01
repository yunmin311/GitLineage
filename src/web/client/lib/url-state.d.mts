/**
 * Types for the pure client modules.
 *
 * The browser client is plain ES modules with no build step required, so the
 * runtime shape is declared here instead of being compiled. Keeping these
 * declarations next to the view-model means a change to the API contract breaks
 * the type check here rather than silently breaking the UI.
 */
import type { ViewGraph, ViewEdge, ViewNode } from '../../../web/view-model.ts';

export interface RepositoryRef {
  owner: string;
  name: string;
}

export interface ViewState {
  edge: string;
  node: string;
  layers: string;
  search: string;
  bundles: string;
  depth: string;
}

export interface LayerState {
  ancestry: boolean;
  dependency: boolean;
  attribution: boolean;
  'source-identity': boolean;
  similarity: boolean;
}

export declare function parseRepositoryPath(pathname: string): RepositoryRef | null;
export declare function resolveRepositoryInput(input: string): RepositoryRef | null;
export declare function repositoryPath(repository: RepositoryRef): string;

export declare const VIEW_DEFAULTS: ViewState;
export declare function readViewState(search: string): ViewState;
export declare function writeViewState(state: Partial<ViewState>): string;

export declare const LAYER_KEYS: Array<keyof LayerState>;
export declare const DEFAULT_LAYER_STATE: string;
export declare function parseLayerState(raw: string): LayerState;
export declare function serializeLayerState(layers: Partial<LayerState>): string;
export declare function isDefaultLayerState(layers: Partial<LayerState>): boolean;