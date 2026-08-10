/**
 * Gale Crater height field.
 *
 * Two layers, deliberately:
 *
 *  1. MOLA MEGDR at 463 m/post supplies the *real* landform — the crater rim,
 *     Aeolis Mons, the slope of the crater floor. Everything you see on the
 *     horizon is measured, not invented.
 *
 *  2. Procedural detail supplies the metre-to-hundred-metre band that no
 *     orbital altimeter resolves. Without it a 463 m dataset reads as putty
 *     under the wheels.
 *
 * The two are summed. `sampleHeight` (CPU, for wheel contact) and the GLSL in
 * GLSL_TERRAIN (GPU, for the rendered surface) compute the same function.
 *
 * World space: +X east, +Z south, +Y up, origin at Bradbury Landing.
 */

import { asset } from "./assets";
import { GLSL_NOISE, snoise } from "./noise";

export interface MolaMeta {
  source: string;
  size: number;
  elevationMin: number;
  elevationMax: number;
  metresPerPixelLat: number;
  metresPerPixelLon: number;
  bounds: { north: number; south: number; west: number; east: number };
  origin: {
    name: string;
    lat: number;
    lon: number;
    pixelRow: number;
    pixelCol: number;
    elevation: number;
  };
}

export interface MolaField {
  meta: MolaMeta;
  /** Elevation in metres relative to the areoid, row-major, size x size. */
  data: Float32Array;
}

let field: MolaField | null = null;

export async function loadMola(): Promise<MolaField> {
  if (field) return field;

  const [meta, buf] = await Promise.all([
    fetch(asset("/terrain/gale-mola.json")).then((r) => r.json() as Promise<MolaMeta>),
    fetch(asset("/terrain/gale-mola.bin")).then((r) => r.arrayBuffer()),
  ]);

  const quant = new Uint16Array(buf);
  const scale = (meta.elevationMax - meta.elevationMin) / 65535;
  const data = new Float32Array(quant.length);
  for (let i = 0; i < quant.length; i++) {
    data[i] = meta.elevationMin + quant[i] * scale;
  }

  field = { meta, data };
  return field;
}

export function getField(): MolaField {
  if (!field) throw new Error("MOLA field not loaded");
  return field;
}

// --- Detail layer parameters (mirrored in GLSL) ------------------------------

const OCTAVES = 7;
const BASE_WAVELENGTH = 640; // metres
const BASE_AMPLITUDE = 9.0; // metres
const LACUNARITY = 2.03; // non-integer, so octaves don't phase-align
const GAIN = 0.5;

/** Aeolian ripples: stretched perpendicular to the prevailing wind. */
const RIPPLE_WAVELENGTH = 4.0;
const RIPPLE_STRETCH = 6.0;
const RIPPLE_AMPLITUDE = 0.13;
const RIPPLE_DIR = 0.62; // radians, roughly NE-SW as at Gale

/**
 * Effective ground sample spacing at a given distance from the viewer.
 * The clipmap doubles its cell size roughly every time the distance doubles,
 * so deriving the filter width from distance (rather than from the LOD level)
 * keeps the height field continuous across level boundaries.
 */
function cellSizeAt(dist: number): number {
  return Math.max(0.5, dist / 64);
}

function octaveWeight(wavelength: number, cell: number): number {
  const t = (wavelength / cell - 3) / 5; // fade out between 3 and 8 cells
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/** Procedural detail in metres, band-limited to the given sample spacing. */
export function sampleDetail(x: number, z: number, dist = 0): number {
  const cell = cellSizeAt(dist);
  let h = 0;

  let wavelength = BASE_WAVELENGTH;
  let amp = BASE_AMPLITUDE;
  for (let k = 0; k < OCTAVES; k++) {
    const w = octaveWeight(wavelength, cell);
    if (w > 0) {
      // Offset each octave so they decorrelate.
      h += amp * w * snoise(x / wavelength + k * 17.3, z / wavelength - k * 9.1);
    }
    wavelength /= LACUNARITY;
    amp *= GAIN;
  }

  const rw = octaveWeight(RIPPLE_WAVELENGTH, cell);
  if (rw > 0) {
    const c = Math.cos(RIPPLE_DIR);
    const s = Math.sin(RIPPLE_DIR);
    const rx = (x * c - z * s) / RIPPLE_WAVELENGTH;
    const rz = (x * s + z * c) / (RIPPLE_WAVELENGTH * RIPPLE_STRETCH);
    h += RIPPLE_AMPLITUDE * rw * snoise(rx, rz);
  }

  return h;
}

/** Bilinear lookup into the MOLA grid. Metres relative to the areoid. */
export function sampleMola(x: number, z: number): number {
  const { meta, data } = getField();
  const n = meta.size;

  const fc = meta.origin.pixelCol + x / meta.metresPerPixelLon;
  const fr = meta.origin.pixelRow + z / meta.metresPerPixelLat;

  const c0 = Math.min(n - 2, Math.max(0, Math.floor(fc)));
  const r0 = Math.min(n - 2, Math.max(0, Math.floor(fr)));
  const tc = Math.min(1, Math.max(0, fc - c0));
  const tr = Math.min(1, Math.max(0, fr - r0));

  const h00 = data[r0 * n + c0];
  const h10 = data[r0 * n + c0 + 1];
  const h01 = data[(r0 + 1) * n + c0];
  const h11 = data[(r0 + 1) * n + c0 + 1];

  return (
    h00 * (1 - tc) * (1 - tr) +
    h10 * tc * (1 - tr) +
    h01 * (1 - tc) * tr +
    h11 * tc * tr
  );
}

/** Full terrain height in metres. `dist` is distance from the camera focus. */
export function sampleHeight(x: number, z: number, dist = 0): number {
  return sampleMola(x, z) + sampleDetail(x, z, dist);
}

/** Surface normal via central differences on the full height function. */
export function sampleNormal(x: number, z: number, eps = 0.5): [number, number, number] {
  const hl = sampleHeight(x - eps, z);
  const hr = sampleHeight(x + eps, z);
  const hd = sampleHeight(x, z - eps);
  const hu = sampleHeight(x, z + eps);

  const nx = hl - hr;
  const ny = 2 * eps;
  const nz = hd - hu;
  const len = Math.hypot(nx, ny, nz);
  return [nx / len, ny / len, nz / len];
}

// --- GPU side ----------------------------------------------------------------

/**
 * The GLSL twin of everything above. `uMola` is a nearest-sampled R32F texture
 * of the quantised grid; we do bilinear filtering by hand because linear
 * filtering of float textures is an optional WebGL2 extension.
 */
export const GLSL_TERRAIN = /* glsl */ `
${GLSL_NOISE}

uniform sampler2D uMola;
uniform float uMolaSize;
uniform float uElevMin;
uniform float uElevRange;
uniform vec2  uMolaOriginPx;   // (col, row) of world origin
uniform vec2  uMetresPerPx;    // (lon, lat)

const int   OCTAVES        = ${OCTAVES};
const float BASE_WAVELENGTH = ${BASE_WAVELENGTH.toFixed(1)};
const float BASE_AMPLITUDE  = ${BASE_AMPLITUDE.toFixed(3)};
const float LACUNARITY      = ${LACUNARITY.toFixed(4)};
const float GAIN            = ${GAIN.toFixed(3)};
const float RIPPLE_WAVELENGTH = ${RIPPLE_WAVELENGTH.toFixed(3)};
const float RIPPLE_STRETCH    = ${RIPPLE_STRETCH.toFixed(3)};
const float RIPPLE_AMPLITUDE  = ${RIPPLE_AMPLITUDE.toFixed(4)};
const float RIPPLE_DIR        = ${RIPPLE_DIR.toFixed(4)};

float molaTexel(vec2 px) {
  vec2 uv = (clamp(px, vec2(0.0), vec2(uMolaSize - 1.0)) + 0.5) / uMolaSize;
  return texture2D(uMola, uv).r;
}

float sampleMola(vec2 p) {
  vec2 fpx = uMolaOriginPx + p / uMetresPerPx;
  vec2 base = floor(fpx);
  vec2 t = clamp(fpx - base, 0.0, 1.0);
  float h00 = molaTexel(base);
  float h10 = molaTexel(base + vec2(1.0, 0.0));
  float h01 = molaTexel(base + vec2(0.0, 1.0));
  float h11 = molaTexel(base + vec2(1.0, 1.0));
  float h = mix(mix(h00, h10, t.x), mix(h01, h11, t.x), t.y);
  return uElevMin + h * uElevRange;
}

float cellSizeAt(float dist) { return max(0.5, dist / 64.0); }

float octaveWeight(float wavelength, float cell) {
  return smoothstep(3.0, 8.0, wavelength / cell);
}

float sampleDetail(vec2 p, float dist) {
  float cell = cellSizeAt(dist);
  float h = 0.0;
  float wavelength = BASE_WAVELENGTH;
  float amp = BASE_AMPLITUDE;
  for (int k = 0; k < OCTAVES; k++) {
    float w = octaveWeight(wavelength, cell);
    if (w > 0.0) {
      float fk = float(k);
      h += amp * w * snoise(vec2(p.x / wavelength + fk * 17.3,
                                 p.y / wavelength - fk * 9.1));
    }
    wavelength /= LACUNARITY;
    amp *= GAIN;
  }
  float rw = octaveWeight(RIPPLE_WAVELENGTH, cell);
  if (rw > 0.0) {
    float c = cos(RIPPLE_DIR);
    float s = sin(RIPPLE_DIR);
    vec2 r = vec2((p.x * c - p.y * s) / RIPPLE_WAVELENGTH,
                  (p.x * s + p.y * c) / (RIPPLE_WAVELENGTH * RIPPLE_STRETCH));
    h += RIPPLE_AMPLITUDE * rw * snoise(r);
  }
  return h;
}

float sampleHeight(vec2 p, float dist) {
  return sampleMola(p) + sampleDetail(p, dist);
}
`;
