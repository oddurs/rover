/**
 * Mosaic panoramas, the way the rover makes them.
 *
 * A rover cannot take a wide picture. It takes a lot of narrow ones and slews
 * between them, and the panoramas everybody has seen are stitched afterwards
 * from dozens of frames. This does the same: step the mast, let the view
 * settle, capture the instrument frame, step again.
 *
 * The capture reads out of a render target rather than off the canvas, because
 * reading the drawing buffer after a frame has been presented is undefined
 * without `preserveDrawingBuffer`, which would cost something on every frame
 * for the sake of one that happens rarely.
 */

import { mast } from "./mounts";
import type { View } from "./cameras";

/** Frames to hold at each stop, so the terrain LOD settles before the shutter. */
const SETTLE_FRAMES = 4;
/** Ceiling on tiles, or the narrow optics would sweep for a very long time. */
const MAX_TILES = 16;
/** Each tile is scaled to this on the strip. */
const TILE_PX = 460;

export interface PanoramaState {
  active: boolean;
  /** Total stops in this sweep. */
  tiles: number;
  /** Stop we are currently on. */
  index: number;
  settle: number;
  startPan: number;
  step: number;
  /** Horizontal degrees the finished strip covers. */
  sweepDeg: number;
  instrument: string;
  canvas: HTMLCanvasElement | null;
  result: HTMLCanvasElement | null;
  tileW: number;
  tileH: number;
}

export const pano: PanoramaState = {
  active: false,
  tiles: 0,
  index: 0,
  settle: 0,
  startPan: 0,
  step: 0,
  sweepDeg: 0,
  instrument: "",
  canvas: null,
  result: null,
  tileW: TILE_PX,
  tileH: TILE_PX,
};

/** Horizontal field of view of a frame, radians. */
export function horizontalFov(view: View): number {
  const halfV = (view.fov * Math.PI) / 360;
  const aspect = view.aspect === 0 ? 16 / 9 : view.aspect;
  return 2 * Math.atan(Math.tan(halfV) * aspect);
}

export function beginPanorama(view: View) {
  if (pano.active) return;

  const hFov = horizontalFov(view);
  // Overlap the tiles slightly; a stitch with hard seams looks like a stitch.
  const step = hFov * 0.82;
  const full = Math.PI * 2;
  const tiles = Math.min(MAX_TILES, Math.max(3, Math.ceil(full / step)));
  const sweep = Math.min(full, tiles * step);

  const aspect = view.aspect === 0 ? 16 / 9 : view.aspect;
  pano.tileH = TILE_PX;
  pano.tileW = Math.round(TILE_PX * aspect);

  const canvas = document.createElement("canvas");
  canvas.width = pano.tileW * tiles;
  canvas.height = pano.tileH;

  pano.active = true;
  pano.tiles = tiles;
  pano.index = 0;
  pano.settle = 0;
  pano.startPan = mast.pan;
  pano.step = step;
  pano.sweepDeg = (sweep * 180) / Math.PI;
  pano.instrument = view.label;
  pano.canvas = canvas;
  pano.result = null;

  // Start at the left-hand edge of the sweep, centred on where it was aimed.
  mast.pan = pano.startPan + sweep / 2;
}

export function cancelPanorama() {
  if (!pano.active) return;
  mast.pan = pano.startPan;
  pano.active = false;
  pano.canvas = null;
}

/**
 * Advance the sweep. Returns true when this frame should be captured.
 * Called once per rendered frame while a panorama is running.
 */
export function panoramaTick(): boolean {
  if (!pano.active) return false;
  if (pano.settle < SETTLE_FRAMES) {
    pano.settle++;
    return false;
  }
  return true;
}

/** Record the captured tile and move the mast to the next stop. */
export function panoramaAdvance() {
  pano.index++;
  pano.settle = 0;
  if (pano.index >= pano.tiles) {
    pano.result = pano.canvas;
    pano.canvas = null;
    pano.active = false;
    mast.pan = pano.startPan;
    return;
  }
  mast.pan = pano.startPan + pano.sweepDeg * (Math.PI / 180) / 2 - pano.step * pano.index;
}

/** Where the current tile belongs on the strip. */
export function tileX(): number {
  return pano.index * pano.tileW;
}
