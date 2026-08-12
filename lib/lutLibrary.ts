/**
 * A library of film looks, baked into 3D LUTs at runtime.
 *
 * These are generated rather than shipped as .cube files. A look is just a
 * function from colour to colour, and baking one into a cube costs a few
 * milliseconds — which means the library can express the things a rack of
 * sliders cannot: per-channel tone curves, hue that shifts with luminance,
 * channel crosstalk, and the response of a black-and-white stock behind a
 * coloured filter.
 *
 * All of it operates in display space, because that is where a LUT is applied.
 */

type RGB = [number, number, number];

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Saturation about the luminance axis. */
function sat(c: RGB, s: number): RGB {
  const l = lum(c[0], c[1], c[2]);
  return [lerp(l, c[0], s), lerp(l, c[1], s), lerp(l, c[2], s)];
}

/** Symmetric filmic S-curve. Higher k is a harder shoulder and deeper toe. */
function scurve(x: number, k: number): number {
  const t = Math.tanh(k * 0.5);
  return clamp01(0.5 + (0.5 * Math.tanh(k * (x - 0.5))) / t);
}

/** Independent toe and shoulder, for stocks that are not symmetric. */
function toeShoulder(x: number, toe: number, shoulder: number): number {
  const t = x < 0.5 ? Math.pow(x * 2, toe) / 2 : 1 - Math.pow((1 - x) * 2, shoulder) / 2;
  return clamp01(t);
}

/**
 * Push shadows one way and highlights the other.
 *
 * Additive and zero-mean, like the shader's. Multiplying by a tint moves each
 * channel's brightness as well as its hue, which reads as a colour cast rather
 * than a grade.
 */
function splitTone(c: RGB, shadow: RGB, high: RGB, amount: number): RGB {
  const l = lum(c[0], c[1], c[2]);
  const zm = (t: RGB): RGB => {
    const m = (t[0] + t[1] + t[2]) / 3;
    return [t[0] - m, t[1] - m, t[2] - m];
  };
  const sh = zm(shadow);
  const hi = zm(high);
  const wS = 1 - clamp01(l / 0.5);
  const wH = clamp01((l - 0.3) / 0.7);
  const k = amount * (l + 0.05) * 1.6;
  return [
    clamp01(c[0] + (sh[0] * wS + hi[0] * wH) * k),
    clamp01(c[1] + (sh[1] * wS + hi[1] * wH) * k),
    clamp01(c[2] + (sh[2] * wS + hi[2] * wH) * k),
  ];
}

export interface Look {
  id: string;
  label: string;
  note: string;
  fn: (c: RGB) => RGB;
}

export const LOOKS: Look[] = [
  {
    id: "print",
    label: "PRINT",
    note: "A release print: gentle S-curve, cool shadows, warm highlights.",
    fn: (c) => {
      const s: RGB = [scurve(c[0], 1.4), scurve(c[1], 1.4), scurve(c[2], 1.45)];
      return sat(splitTone(s, [0.34, 0.46, 0.7], [0.86, 0.74, 0.52], 0.55), 1.03);
    },
  },
  {
    id: "bleach",
    label: "BLEACH BYPASS",
    note: "Silver left in the print. Hard contrast, colour nearly gone, highlights that clip.",
    fn: (c) => {
      const hard: RGB = [scurve(c[0], 3.4), scurve(c[1], 3.4), scurve(c[2], 3.4)];
      const d = sat(hard, 0.3);
      return [clamp01(d[0] * 1.04), clamp01(d[1] * 1.02), clamp01(d[2] * 1.06)];
    },
  },
  {
    id: "tealorange",
    label: "TEAL / ORANGE",
    note: "The blockbuster grade. Skin and rock to orange, everything in shadow to teal.",
    fn: (c) => {
      const s: RGB = [scurve(c[0], 1.6), scurve(c[1], 1.5), scurve(c[2], 1.5)];
      return sat(splitTone(s, [0.22, 0.5, 0.78], [0.9, 0.68, 0.4], 0.85), 1.08);
    },
  },
  {
    id: "golden",
    label: "GOLDEN HOUR",
    note: "Late light: warm gain, a soft shoulder and shadows that never quite reach black.",
    fn: (c) => {
      const t: RGB = [
        toeShoulder(c[0], 0.82, 1.35),
        toeShoulder(c[1], 0.9, 1.4),
        toeShoulder(c[2], 1.05, 1.5),
      ];
      return sat(
        [clamp01(t[0] * 1.1 + 0.03), clamp01(t[1] * 1.0 + 0.018), clamp01(t[2] * 0.84 + 0.012)],
        1.04
      );
    },
  },
  {
    id: "cold",
    label: "COLD VACUUM",
    note: "Sunless and clinical. Crushed blacks, blue highlights, colour pulled well down.",
    fn: (c) => {
      const s: RGB = [scurve(c[0], 1.8), scurve(c[1], 1.75), scurve(c[2], 1.65)];
      const d = sat(s, 0.84);
      return [clamp01(d[0] * 0.93), clamp01(d[1] * 0.98), clamp01(d[2] * 1.08)];
    },
  },
  {
    id: "faded",
    label: "FADED ARCHIVE",
    note: "A print left in the sun. Lifted blacks, yellowed, most of the colour gone.",
    fn: (c) => {
      const d = sat(c, 0.74);
      return [
        clamp01(d[0] * 0.94 + 0.055),
        clamp01(d[1] * 0.93 + 0.048),
        clamp01(d[2] * 0.88 + 0.032),
      ];
    },
  },
  {
    id: "redfilter",
    label: "RED FILTER B&W",
    note: "Monochrome behind a red filter — the classic landscape trick. Dust goes bright, sky goes near black.",
    fn: (c) => {
      const v = scurve(clamp01(0.74 * c[0] + 0.22 * c[1] + 0.04 * c[2]), 2.3);
      return [v, v, v];
    },
  },
  {
    id: "twostrip",
    label: "TWO-STRIP",
    note: "Early two-colour process: only a red and a cyan record, so blues and greens collapse together.",
    fn: (c) => {
      const cy = (c[1] + c[2]) * 0.5;
      const s: RGB = [scurve(c[0], 1.9), scurve(cy, 1.9), scurve(cy, 1.85)];
      return [clamp01(s[0] * 1.08), clamp01(s[1] * 0.95), clamp01(s[2] * 0.88)];
    },
  },
  {
    id: "duotone",
    label: "DUOTONE RUST",
    note: "Luminance mapped onto a single ramp, deep aubergine through rust to ivory.",
    fn: (c) => {
      const l = scurve(lum(c[0], c[1], c[2]), 1.9);
      const dark: RGB = [0.1, 0.05, 0.09];
      const mid: RGB = [0.62, 0.28, 0.13];
      const light: RGB = [0.98, 0.93, 0.85];
      if (l < 0.5) {
        const t = l * 2;
        return [lerp(dark[0], mid[0], t), lerp(dark[1], mid[1], t), lerp(dark[2], mid[2], t)];
      }
      const t = (l - 0.5) * 2;
      return [lerp(mid[0], light[0], t), lerp(mid[1], light[1], t), lerp(mid[2], light[2], t)];
    },
  },
  {
    id: "nightvision",
    label: "STARLIGHT",
    note: "Intensified low light: green channel carries everything, noise floor lifted.",
    fn: (c) => {
      const v = Math.pow(clamp01(lum(c[0], c[1], c[2])), 0.72);
      return [clamp01(v * 0.34), clamp01(v * 1.08), clamp01(v * 0.42)];
    },
  },
  {
    id: "dustorm",
    label: "DUST STORM",
    note: "Global storm: everything sinks toward one flat orange, contrast strangled.",
    fn: (c) => {
      const l = lum(c[0], c[1], c[2]);
      const flat: RGB = [lerp(l, c[0], 0.35), lerp(l, c[1], 0.35), lerp(l, c[2], 0.35)];
      const t = 0.55;
      return [
        clamp01(lerp(flat[0], 0.52, t) + 0.06),
        clamp01(lerp(flat[1], 0.3, t) + 0.02),
        clamp01(lerp(flat[2], 0.15, t)),
      ];
    },
  },
  {
    id: "viking76",
    label: "VIKING 76",
    note: "The first colour pictures from the surface: over-warm, coarse, and slightly wrong in a way nobody could check.",
    fn: (c) => {
      const s: RGB = [
        toeShoulder(c[0], 0.78, 1.2),
        toeShoulder(c[1], 0.95, 1.3),
        toeShoulder(c[2], 1.2, 1.45),
      ];
      const d = sat(s, 0.8);
      return [clamp01(d[0] * 1.16 + 0.04), clamp01(d[1] * 0.96 + 0.03), clamp01(d[2] * 0.7 + 0.03)];
    },
  },
];

export const LOOK_BY_ID = new Map(LOOKS.map((l) => [l.id, l]));

/**
 * Bake a look into cube data, red varying fastest — the same ordering a .cube
 * file uses, so it can go through exactly the same install path.
 */
export function bakeLook(look: Look, size = 33): number[] {
  const out: number[] = new Array(size * size * size * 3);
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const c = look.fn([r / (size - 1), g / (size - 1), b / (size - 1)]);
        out[i++] = clamp01(c[0]);
        out[i++] = clamp01(c[1]);
        out[i++] = clamp01(c[2]);
      }
    }
  }
  return out;
}
