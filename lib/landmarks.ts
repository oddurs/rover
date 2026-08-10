import { getField, sampleMola } from "./terrain";

/**
 * Landmarks.
 *
 * Rather than hard-coding coordinates from memory and risking putting a real
 * place in the wrong spot, everything except the landing site is *found in the
 * elevation data*: the summit is wherever the data says the highest ground
 * inside the crater is. That keeps the labels honest and self-consistent with
 * the terrain you are actually driving on.
 */

export interface Landmark {
  name: string;
  /** World metres, +X east / +Z south from Bradbury Landing. */
  x: number;
  z: number;
  elevation: number;
  note: string;
}

interface Extreme {
  x: number;
  z: number;
  h: number;
}

/** Highest MOLA post within an annulus around the origin, optionally sectored. */
function highestWithin(
  minRadius: number,
  maxRadius: number,
  bearingFrom = 0,
  bearingTo = 360
): Extreme {
  const { meta, data } = getField();
  const n = meta.size;
  const best: Extreme = { x: 0, z: 0, h: -Infinity };

  for (let r = 0; r < n; r++) {
    const z = (r - meta.origin.pixelRow) * meta.metresPerPixelLat;
    for (let c = 0; c < n; c++) {
      const x = (c - meta.origin.pixelCol) * meta.metresPerPixelLon;
      const d = Math.hypot(x, z);
      if (d < minRadius || d > maxRadius) continue;

      if (bearingFrom !== 0 || bearingTo !== 360) {
        const b = (((Math.atan2(x, -z) * 180) / Math.PI) + 360) % 360;
        const inSector =
          bearingFrom <= bearingTo
            ? b >= bearingFrom && b <= bearingTo
            : b >= bearingFrom || b <= bearingTo;
        if (!inSector) continue;
      }

      const h = data[r * n + c];
      if (h > best.h) {
        best.x = x;
        best.z = z;
        best.h = h;
      }
    }
  }
  return best;
}

let cached: Landmark[] | null = null;

export function landmarks(): Landmark[] {
  if (cached) return cached;

  // Aeolis Mons fills the middle of a crater about 154 km across, so the
  // highest ground within ~45 km of the landing site is its summit.
  const summit = highestWithin(3000, 45000);
  // The rim, out past the mound, in the northern half.
  const northRim = highestWithin(55000, 95000, 300, 60);

  cached = [
    {
      name: "Bradbury Landing",
      x: 0,
      z: 0,
      elevation: sampleMola(0, 0),
      note: "Curiosity's touchdown point, 6 Aug 2012.",
    },
    {
      name: "Aeolis Mons",
      x: summit.x,
      z: summit.z,
      elevation: summit.h,
      note: "Mount Sharp. The central mound, layered sediment 5 km tall.",
    },
    {
      name: "Gale north rim",
      x: northRim.x,
      z: northRim.z,
      elevation: northRim.h,
      note: "The far wall of the impact basin.",
    },
  ];
  return cached;
}

export interface Bearing {
  distance: number;
  /** Degrees clockwise from north. */
  bearing: number;
}

export function bearingTo(lm: Landmark, x: number, z: number): Bearing {
  const dx = lm.x - x;
  const dz = lm.z - z;
  return {
    distance: Math.hypot(dx, dz),
    bearing: (((Math.atan2(dx, -dz) * 180) / Math.PI) + 360) % 360,
  };
}

/** World metres back to planetocentric lat/lon. */
export function toLatLon(x: number, z: number): { lat: number; lon: number } {
  const { meta } = getField();
  const degPerPx = 1 / 128;
  return {
    lat: meta.origin.lat - (z / meta.metresPerPixelLat) * degPerPx,
    lon: meta.origin.lon + (x / meta.metresPerPixelLon) * degPerPx,
  };
}
