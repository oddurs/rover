/**
 * Mars constants and solar geometry for Gale Crater.
 */

export const MARS = {
  /** Surface gravity, m/s^2. About 38% of Earth's. */
  gravity: 3.7207,
  /** Length of a mean solar day, seconds. 24 h 39 m 35 s. */
  solSeconds: 88775.244,
  /** Axial tilt, degrees. Close to Earth's 23.4, so Mars has real seasons. */
  obliquity: 25.19,
  /** Sols in a Mars year. */
  solsPerYear: 668.6,
  /** Mean surface pressure, pascals. Under 1% of Earth's. */
  pressurePa: 610,
  /** Volumetric mean radius, metres. */
  radius: 3389500,
  /** Curiosity's actual top speed, m/s. Roughly 4 cm/s. */
  roverTopSpeed: 0.042,
} as const;

export const GALE = {
  latitude: -4.5895,
  longitude: 137.4417,
  landingSite: "Bradbury Landing",
  /** Curiosity's landing, 2012-08-06 05:17 UTC — the start of Sol 0. */
  landingDate: "2012-08-06",
} as const;

const DEG = Math.PI / 180;

export interface SunState {
  /** Degrees above the horizon. Negative is below. */
  elevation: number;
  /** Degrees clockwise from north. */
  azimuth: number;
  /** Unit vector pointing from the origin toward the sun, world space. */
  direction: [number, number, number];
  /** 0 at night, 1 with the sun well up. Smooth through twilight. */
  daylight: number;
}

/**
 * Solar declination for a given solar longitude (Ls), the standard Mars
 * seasonal coordinate: Ls 0 is northern spring equinox, 90 northern summer.
 */
export function solarDeclination(lsDeg: number): number {
  return Math.asin(Math.sin(MARS.obliquity * DEG) * Math.sin(lsDeg * DEG)) / DEG;
}

/**
 * Sun position at Gale.
 *
 * @param localTime Local true solar time in hours, 0..24 (12 is local noon).
 * @param lsDeg     Solar longitude in degrees.
 */
export function sunAt(localTime: number, lsDeg: number): SunState {
  const lat = GALE.latitude * DEG;
  const dec = solarDeclination(lsDeg) * DEG;
  const hourAngle = (localTime - 12) * 15 * DEG;

  const sinEl =
    Math.sin(lat) * Math.sin(dec) +
    Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl)));

  const azimuth = Math.atan2(
    -Math.sin(hourAngle),
    Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(hourAngle)
  );

  const cosEl = Math.cos(elevation);
  const direction: [number, number, number] = [
    cosEl * Math.sin(azimuth),
    Math.sin(elevation),
    -cosEl * Math.cos(azimuth),
  ];

  // Mars twilight is long and dusty; fade over a wide band below the horizon.
  const elDeg = elevation / DEG;
  const daylight = Math.max(0, Math.min(1, (elDeg + 8) / 14));

  return {
    elevation: elDeg,
    azimuth: (azimuth / DEG + 360) % 360,
    direction,
    daylight,
  };
}

/** Format a sol fraction as local true solar time, HH:MM:SS. */
export function formatLTST(localTime: number): string {
  const t = ((localTime % 24) + 24) % 24;
  const h = Math.floor(t);
  const m = Math.floor((t - h) * 60);
  const s = Math.floor(((t - h) * 60 - m) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Compass point for a heading in degrees from north. */
export function compass(headingDeg: number): string {
  const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const i = Math.round((((headingDeg % 360) + 360) % 360) / 22.5) % 16;
  return points[i];
}
