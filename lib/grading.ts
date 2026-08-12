import * as THREE from "three";

/**
 * Colour grading.
 *
 * A separate stage at the end of the optics pass, so it sits on top of
 * everything — instrument response, stereo, aerial perspective — exactly the
 * way a grade sits on top of a shot. The controls are the ones a colourist
 * actually reaches for rather than an arbitrary pile of sliders: exposure,
 * contrast about a mid-grey pivot, saturation, a warm/cool axis, and split
 * toning that pulls shadows one way and highlights the other.
 *
 * A 3D LUT can be loaded on top. LUTs are display-referred, so it is applied
 * after the transfer function, which is where a .cube expects to live.
 */

export interface Grade {
  exposure: number;
  contrast: number;
  saturation: number;
  /** Warm/cool, -1..1. Positive is warmer. */
  temperature: number;
  /** Green/magenta, -1..1. */
  tint: number;
  /** Raises or crushes the black point. */
  lift: number;
  /** Colour pulled into the shadows and into the highlights. */
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  toning: number;
  /** Corner falloff across the whole frame. */
  vignette: number;
  grain: number;
  /** How much of the loaded LUT to apply. */
  lutMix: number;
}

export const NEUTRAL: Grade = {
  exposure: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  tint: 0,
  lift: 0,
  shadowTint: [0.16, 0.34, 0.62],
  highlightTint: [1.0, 0.72, 0.36],
  toning: 0,
  vignette: 0,
  grain: 0,
  // A look is a nudge, not a costume. Half strength by default.
  lutMix: 0.55,
};

export interface Preset {
  id: string;
  label: string;
  note: string;
  grade: Grade;
}

export const PRESETS: Preset[] = [
  {
    id: "raw",
    label: "RAW",
    note: "No grade. What the renderer produced.",
    grade: { ...NEUTRAL },
  },
  {
    id: "print",
    label: "PRINT",
    note: "A release print. Barely there: a little contrast, cool shadows, warm highlights.",
    grade: {
      ...NEUTRAL,
      contrast: 1.08,
      saturation: 1.04,
      temperature: 0.04,
      shadowTint: [0.3, 0.45, 0.72],
      highlightTint: [0.86, 0.72, 0.5],
      toning: 0.3,
      vignette: 0.1,
      grain: 0.008,
    },
  },
  {
    id: "cinema",
    label: "CINEMA",
    note: "The Mars-film look, kept honest. Warm, a touch of teal in the shadows, nothing shouted.",
    grade: {
      ...NEUTRAL,
      exposure: 0.06,
      contrast: 1.13,
      saturation: 1.06,
      temperature: 0.1,
      lift: 0.008,
      shadowTint: [0.24, 0.48, 0.74],
      highlightTint: [0.88, 0.7, 0.46],
      toning: 0.42,
      vignette: 0.16,
      grain: 0.012,
    },
  },
  {
    id: "documentary",
    label: "DOCUMENTARY",
    note: "Flat and honest. Closer to what the cameras send back than to a cinema.",
    grade: {
      ...NEUTRAL,
      contrast: 0.97,
      saturation: 0.96,
      vignette: 0.04,
    },
  },
  {
    id: "archive",
    label: "ARCHIVE",
    note: "A print that has sat in a drawer. Lifted blacks, a little yellow, colour drifting off.",
    grade: {
      ...NEUTRAL,
      exposure: 0.08,
      contrast: 0.94,
      saturation: 0.82,
      temperature: 0.16,
      lift: 0.028,
      shadowTint: [0.5, 0.46, 0.36],
      highlightTint: [0.8, 0.74, 0.56],
      toning: 0.24,
      vignette: 0.2,
      grain: 0.03,
    },
  },
  {
    id: "night",
    label: "NIGHT",
    note: "Opened up for the hour after sunset, and cooled off.",
    grade: {
      ...NEUTRAL,
      exposure: 0.38,
      contrast: 1.14,
      saturation: 0.88,
      temperature: -0.14,
      shadowTint: [0.32, 0.42, 0.72],
      highlightTint: [0.7, 0.78, 0.9],
      toning: 0.34,
      vignette: 0.24,
      grain: 0.024,
    },
  },
];

/** Live grade, read by the render pass every frame. */
export const grade: Grade = { ...PRESETS[0].grade };

export function applyPreset(p: Preset) {
  Object.assign(grade, p.grade);
}

/** The loaded LUT, if any. */
export const lut: { texture: THREE.DataTexture | null; size: number; name: string } = {
  texture: null,
  size: 0,
  name: "",
};

/**
 * Parse an Adobe .cube 3D LUT into a tiled 2D texture.
 *
 * A `sampler3D` would be the natural fit, but it does not exist in the GLSL
 * version this pass compiles as, so the cube is laid out as N slices side by
 * side — N*N wide by N tall — and the shader blends between two slices by hand.
 */
export function parseCube(text: string, name: string): boolean {
  let size = 0;
  const data: number[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("LUT_3D_SIZE")) {
      size = parseInt(line.split(/\s+/)[1], 10);
      continue;
    }
    if (/^[A-Z_]/i.test(line) && !/^[-\d.]/.test(line)) continue;
    const p = line.split(/\s+/).map(Number);
    if (p.length >= 3 && p.every((v) => Number.isFinite(v))) data.push(p[0], p[1], p[2]);
  }

  if (!size || data.length !== size * size * size * 3) return false;
  installLut(data, size, name);
  return true;
}

/**
 * Upload cube data as a tiled 2D texture: N slices side by side, N*N wide by
 * N tall, blue selecting the slice. Data runs red fastest, as a .cube does.
 */
export function installLut(data: number[], size: number, name: string) {
  const w = size * size;
  const h = size;
  const buf = new Uint8Array(w * h * 4);
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const src = ((b * size + g) * size + r) * 3;
        const x = b * size + r;
        const dst = (g * w + x) * 4;
        buf[dst] = Math.round(THREE.MathUtils.clamp(data[src], 0, 1) * 255);
        buf[dst + 1] = Math.round(THREE.MathUtils.clamp(data[src + 1], 0, 1) * 255);
        buf[dst + 2] = Math.round(THREE.MathUtils.clamp(data[src + 2], 0, 1) * 255);
        buf[dst + 3] = 255;
      }
    }
  }

  const tex = new THREE.DataTexture(buf, w, h, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  lut.texture?.dispose();
  lut.texture = tex;
  lut.size = size;
  lut.name = name;
}

export function clearLut() {
  lut.texture?.dispose();
  lut.texture = null;
  lut.size = 0;
  lut.name = "";
}

/** GLSL for the grade, injected into the optics pass. */
export const GRADE_GLSL = /* glsl */ `
uniform float uGExposure;
uniform float uGContrast;
uniform float uGSaturation;
uniform float uGTemperature;
uniform float uGTint;
uniform float uGLift;
uniform vec3  uGShadowTint;
uniform vec3  uGHighTint;
uniform float uGToning;
uniform float uGVignette;
uniform float uGGrain;
uniform sampler2D uLut;
uniform float uLutSize;
uniform float uLutMix;

vec3 lutSlice(float slice, vec3 c, float n) {
  float u = (slice * n + c.r * (n - 1.0) + 0.5) / (n * n);
  float v = (c.g * (n - 1.0) + 0.5) / n;
  return texture2D(uLut, vec2(u, v)).rgb;
}

vec3 applyLut(vec3 c) {
  float n = uLutSize;
  c = clamp(c, 0.0, 1.0);
  float bz = c.b * (n - 1.0);
  float z0 = floor(bz);
  float z1 = min(z0 + 1.0, n - 1.0);
  return mix(lutSlice(z0, c, n), lutSlice(z1, c, n), bz - z0);
}

/** Linear-light half of the grade, before the transfer function. */
vec3 gradeLinear(vec3 c) {
  c *= exp2(uGExposure);

  // Warm/cool and green/magenta, as simple channel gains.
  c.r *= 1.0 + uGTemperature * 0.28;
  c.b *= 1.0 - uGTemperature * 0.28;
  c.g *= 1.0 + uGTint * 0.18;

  // Contrast about mid grey, so exposure and contrast stay independent.
  c = max(vec3(0.0), (c - 0.18) * uGContrast + 0.18);

  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(lum), c, uGSaturation);

  // Split toning: shadows one way, highlights the other.
  //
  // Additive and zero-mean, not multiplicative. Multiplying by a tint changes
  // each channel's *brightness* as well as its hue — a shadow tint of
  // (0.18, 0.42, 0.66) drops red to a third while lifting blue, which is a
  // colour cast rather than a grade. Subtracting the tint's own mean first
  // leaves a pure hue push that costs no exposure, and scaling by luminance
  // keeps it off absolute black.
  if (uGToning > 0.0) {
    vec3 sh = uGShadowTint - dot(uGShadowTint, vec3(1.0 / 3.0));
    vec3 hi = uGHighTint - dot(uGHighTint, vec3(1.0 / 3.0));
    float wS = 1.0 - smoothstep(0.0, 0.5, lum);
    float wH = smoothstep(0.3, 1.0, lum);
    c += (sh * wS + hi * wH) * uGToning * 1.15 * (lum + 0.05);
  }

  return max(vec3(0.0), c + uGLift);
}
`;
