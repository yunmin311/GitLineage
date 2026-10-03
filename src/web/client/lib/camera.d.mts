/**
 * Types for the camera-invariant module. See `url-state.d.mts` for why these are
 * declared rather than compiled.
 */

/** A `viewBox` in the shape the fit/zoom helpers return. */
export interface ViewBox {
  viewBox: string;
  zoom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The camera, split into the four quantities that must each hold still.
 *
 * `valid` is false for an unparseable `viewBox`, in which case the numeric
 * fields are NaN and only `viewBox` carries information.
 */
export interface CameraState {
  valid: boolean;
  viewBox: string;
  zoom: number;
  /** World coordinate at the viewport's top-left. */
  panX: number;
  panY: number;
  /** Visible world extent. */
  width: number;
  height: number;
  /** World point at the middle of the viewport. */
  centreX: number;
  centreY: number;
  /** World focal point: what the reader perceives as the subject of the view. */
  focalX: number;
  focalY: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

/** Named camera quantities that can move. */
export interface CameraDiff {
  pan?: boolean;
  zoom?: boolean;
  centre?: boolean;
  worldFocal?: boolean;
}

export declare const RefitTrigger: Readonly<{
  Dataset: 'dataset';
  Local: 'local';
}>;

/** Whether a scene change is permitted to refit the camera. */
export declare function shouldRefit(trigger: string): boolean;

export declare function parseViewBox(viewBox: string | null | undefined): Box | null;

export declare function cameraState(viewBox: string | null | undefined, zoom?: number): CameraState;

/** Exact equality on pan, zoom, viewport centre and world focal. */
export declare function sameCamera(a: CameraState, b: CameraState, epsilon?: number): boolean;

export declare function worldToScreen(
  viewBox: string | null | undefined,
  viewport: Viewport,
  point: { x: number; y: number },
): ScreenPoint | null;

/** Which camera quantities differ. Empty when the two cameras agree. */
export declare function cameraDiff(before: CameraState, after: CameraState): CameraDiff;