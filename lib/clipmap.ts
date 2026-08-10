import * as THREE from "three";

/**
 * Geometry clipmap.
 *
 * Concentric rings of fixed grid geometry centred on the rover, each ring
 * twice the cell size of the one inside it. The geometry never changes — only
 * a `uCenter` uniform and a `uCell` scale — so roaming is free, with no mesh
 * rebuilds and nothing to stutter on.
 *
 * Level 0 is a full grid; every level above it is a donut whose hole is
 * exactly covered by the level inside.
 */

export const CLIPMAP = {
  /** Quads per side, per level. */
  n: 128,
  /** Cell size of level 0, metres. */
  baseCell: 0.5,
  // Reaches 131 km — far enough to include Gale's north rim, 84 km out, which
  // curvature then correctly cuts down to a low ridge on the skyline.
  levels: 13,
} as const;

/** Half-extent of a level in metres. */
export function levelExtent(level: number): number {
  return (CLIPMAP.n * cellSize(level)) / 2;
}

export function cellSize(level: number): number {
  return CLIPMAP.baseCell * 2 ** level;
}

/** Total radius covered by the clipmap, metres. */
export const CLIPMAP_RADIUS = levelExtent(CLIPMAP.levels - 1);

/**
 * Build one level.
 *
 * Positions are in *grid units* (-n/2 .. n/2); the vertex shader multiplies by
 * the level's cell size. `aSkirt` marks vertices belonging to the vertical
 * curtains hung off each boundary, which hide the hairline cracks where two
 * levels of different resolution meet.
 */
export function buildClipmapLevel(donut: boolean): THREE.BufferGeometry {
  const n = CLIPMAP.n;
  const half = n / 2;
  const idx = (i: number, j: number) => j * (n + 1) + i;

  const pos: number[] = [];
  const skirt: number[] = [];
  const index: number[] = [];

  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      pos.push(i - half, 0, j - half);
      skirt.push(0);
    }
  }

  // The hole is deliberately *smaller* than the level inside it.
  //
  // Every level snaps its centre to its own grid — a multiple of two of its
  // own cells — so a donut and the level it surrounds can be centred up to one
  // coarse cell apart. Sizing the hole to exactly match the inner level's
  // extent then opens a strip of missing ground on whichever side the drift
  // lands, and you see straight through it to the skirts. Pulling the hole in
  // by two cells guarantees the two always overlap instead.
  const HOLE_MARGIN = 2;
  const h0 = n / 4 + HOLE_MARGIN;
  const h1 = (3 * n) / 4 - HOLE_MARGIN;

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (donut && i >= h0 && i < h1 && j >= h0 && j < h1) continue;
      const a = idx(i, j);
      const b = idx(i + 1, j);
      const c = idx(i + 1, j + 1);
      const d = idx(i, j + 1);
      // Wound counter-clockwise seen from +Y.
      index.push(a, d, b, b, d, c);
    }
  }

  const addSkirt = (loop: number[]) => {
    const base = pos.length / 3;
    for (const v of loop) {
      pos.push(pos[v * 3], 0, pos[v * 3 + 2]);
      skirt.push(1);
    }
    for (let k = 0; k < loop.length; k++) {
      const k2 = (k + 1) % loop.length;
      index.push(loop[k], base + k, loop[k2], loop[k2], base + k, base + k2);
    }
  };

  /** Vertices around a square boundary, in order. */
  const ring = (lo: number, hi: number): number[] => {
    const loop: number[] = [];
    for (let i = lo; i < hi; i++) loop.push(idx(i, lo));
    for (let j = lo; j < hi; j++) loop.push(idx(hi, j));
    for (let i = hi; i > lo; i--) loop.push(idx(i, hi));
    for (let j = hi; j > lo; j--) loop.push(idx(lo, j));
    return loop;
  };

  addSkirt(ring(0, n));
  if (donut) addSkirt(ring(h0, h1));

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  // Placeholder normals. The real ones are computed per-vertex in the shader,
  // but the attribute has to exist or three falls back to flat shading — which
  // both facets the terrain and removes the vNormal varying.
  const up = new Float32Array(pos.length);
  for (let i = 1; i < up.length; i += 3) up[i] = 1;
  geo.setAttribute("normal", new THREE.BufferAttribute(up, 3));
  geo.setAttribute("aSkirt", new THREE.Float32BufferAttribute(skirt, 1));
  geo.setIndex(index);
  // Vertices are displaced on the GPU, so the CPU-side bounds mean nothing.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  return geo;
}
