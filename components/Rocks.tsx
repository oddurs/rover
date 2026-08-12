"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { telemetry } from "@/lib/store";
import { sampleHeight, sampleNormal } from "@/lib/terrain";

/**
 * Ground cover.
 *
 * Modelled on Curiosity's own Mastcam frames of Gale rather than invented. Two
 * things stand out in those images and neither was true of the first version of
 * this: the ground is a *continuous pavement* of clasts rather than a few
 * boulders on smooth sand, and the clasts are angular, platy fragments of
 * broken bedrock rather than rounded stones.
 *
 * So: three tiers, each denser and smaller than the last, and geometry that is
 * faceted and flattened rather than blobby. Placement is a deterministic hash
 * of the cell coordinate, so a given stone is always in the same spot — drive
 * away, come back, and the field is unchanged.
 */

interface Tier {
  name: string;
  /**
   * Distinct shapes cut for this tier. One is plenty for gravel — nobody
   * inspects a pebble — but the metre-scale blocks are what the eye lands on,
   * and a field of identical boulders reads as wallpaper.
   */
  variants: number;
  /**
   * Power-law exponent for the size-frequency distribution. Real clast
   * populations follow N(>D) proportional to D^-a, which is why a rock field
   * is overwhelmingly small stones with the occasional block in it.
   */
  alpha: number;
  /** Grid cell size, metres. */
  cell: number;
  /** Candidate stones per cell. */
  perCell: number;
  /** Cells across, odd, centred on the rover. */
  cells: number;
  /** Clast size range, metres. */
  min: number;
  max: number;
  /** Fraction of candidates that actually exist. */
  coverage: number;
  /** How flat the fragments lie. Lower is more slab-like. */
  flatten: number;
  /** Icosphere subdivision. Nobody inspects a pebble; a boulder gets looked at. */
  detail: number;
  /** Fracture planes clipped off the blank. More planes, more broken-looking. */
  facets: number;
  /** Instances refreshed per frame. */
  budget: number;
  /** Align to the local slope. Off for gravel — it costs four extra height
   *  samples per stone and nothing that small reads as bedded anyway. */
  bedded: boolean;
  colour: string;
}

const TIERS: Tier[] = [
  // Gravel: the pavement itself. Dense, small, near-field only.
  {
    name: "gravel",
    detail: 0,
    facets: 5,
    variants: 1,
    alpha: 2.4,
    cell: 4,
    perCell: 26,
    cells: 13,
    min: 0.05,
    max: 0.22,
    coverage: 0.95,
    flatten: 0.72,
    budget: 420,
    bedded: false,
    colour: "#6d5c50",
  },
  // Cobbles: the size that makes the ground read as broken rock.
  {
    name: "cobble",
    detail: 1,
    facets: 7,
    variants: 2,
    alpha: 2.2,
    cell: 8,
    perCell: 10,
    cells: 17,
    min: 0.18,
    max: 0.8,
    coverage: 0.8,
    flatten: 0.62,
    budget: 220,
    bedded: true,
    colour: "#7a6759",
  },
  // Blocks: the ones you steer around.
  {
    name: "block",
    detail: 2,
    facets: 10,
    variants: 3,
    alpha: 2.6,
    cell: 24,
    perCell: 3,
    cells: 15,
    min: 0.5,
    max: 4.0,
    coverage: 0.4,
    flatten: 0.7,
    budget: 110,
    bedded: true,
    colour: "#6a584c",
  },
];

/**
 * Integer hash, 0..1.
 *
 * Must use Math.imul. Plain `*` on 32-bit-sized values overflows float64's
 * 53-bit mantissa, and the bits lost are precisely the low ones the finaliser
 * then extracts — so the result stays correlated with its inputs. With the x
 * and z seeds drawn from adjacent values that put every stone in a cell on a
 * straight line, which showed up as parallel rows of gravel across the ground.
 * Measured correlation between the two seeds: -0.10 before, 0.004 after.
 */
/** Wrap into [0, n). */
function wrap(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * Smoothly interpolated hash.
 *
 * Gating clumps on a per-cell hash tiles the ground in squares. Interpolating
 * between lattice points, at a couple of scales, gives patches with organic
 * edges — bare stretches and rubble fields rather than a checkerboard.
 */
function smoothHash(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  const top = a + (b - a) * sx;
  const bot = c + (d - c) * sx;
  return top + (bot - top) * sy;
}

function hash(i: number, j: number, k: number): number {
  let h =
    Math.imul(i | 0, 0x27d4eb2d) ^
    Math.imul(j | 0, 0x165667b1) ^
    Math.imul(k | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Draw a size from a truncated power law.
 *
 * The inverse CDF of a Pareto between min and max. Feeding it a uniform hash
 * gives a population dominated by the smallest clasts with a thin tail of large
 * ones, which is how broken rock actually distributes.
 */
function powerLawSize(u: number, min: number, max: number, alpha: number): number {
  const ratio = (min / max) ** alpha;
  return min / (1 - u * (1 - ratio)) ** (1 / alpha);
}

/** Value noise on the unit sphere, for coherent lumps rather than spikes. */
function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const at = (i: number, j: number, k: number) => hash(i * 73856093 + k * 83492791, j, seed);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c00 = lerp(at(xi, yi, zi), at(xi + 1, yi, zi), sx);
  const c10 = lerp(at(xi, yi + 1, zi), at(xi + 1, yi + 1, zi), sx);
  const c01 = lerp(at(xi, yi, zi + 1), at(xi + 1, yi, zi + 1), sx);
  const c11 = lerp(at(xi, yi + 1, zi + 1), at(xi + 1, yi + 1, zi + 1), sx);
  return lerp(lerp(c00, c10, sy), lerp(c01, c11, sy), sz) * 2 - 1;
}

/**
 * A broken fragment.
 *
 * Rock does not erode into lumps, it fractures along planes. So the blank is an
 * icosphere given a few scales of coherent displacement — which sets the
 * overall lumpiness — and then clipped against a handful of randomly oriented
 * half-spaces. Every clip flattens whatever crossed it, leaving planar faces
 * meeting at sharp edges, which is what a fractured block looks like.
 *
 * Rendered flat-shaded, so coplanar triangles share a normal and each face
 * catches the sun as one surface.
 */
function buildClastGeometry(
  flatten: number,
  seed: number,
  detail = 0,
  facets = 5
): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.5, detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();

  // Fracture planes: a direction and how deeply it bites in.
  const planes: { n: THREE.Vector3; d: number }[] = [];
  for (let i = 0; i < facets; i++) {
    const a = hash(seed, i, 3) * Math.PI * 2;
    const c = hash(seed, i, 7) * 2 - 1;
    const r = Math.sqrt(Math.max(0, 1 - c * c));
    planes.push({
      n: new THREE.Vector3(r * Math.cos(a), c, r * Math.sin(a)),
      d: 0.5 * (0.56 + hash(seed, i, 11) * 0.36),
    });
  }

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const len = v.length() || 1;
    const dx = v.x / len;
    const dy = v.y / len;
    const dz = v.z / len;

    // Coherent lumpiness across a few scales.
    const r =
      1 +
      0.26 * noise3(dx * 1.7 + seed, dy * 1.7, dz * 1.7, seed) +
      0.13 * noise3(dx * 3.9, dy * 3.9, dz * 3.9 + seed, seed + 11) +
      0.06 * noise3(dx * 8.3, dy * 8.3, dz * 8.3, seed + 29);
    v.set(dx, dy, dz).multiplyScalar(0.5 * Math.max(0.45, r));

    // Break it. Anything past a plane gets flattened onto it.
    for (const pl of planes) {
      const over = v.dot(pl.n) - pl.d;
      if (over > 0) v.addScaledVector(pl.n, -over);
    }

    v.y *= flatten;
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  geo.dispose();
  return flat;
}

function ScatterLayer({ tier }: { tier: Tier }) {
  const slots = tier.cells * tier.cells * tier.perCell;
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);

  const geometries = useMemo(
    () =>
      Array.from({ length: tier.variants }, (_, v) =>
        buildClastGeometry(
          tier.flatten,
          tier.name.length * 31 + v * 977,
          tier.detail,
          tier.facets
        )
      ),
    [tier]
  );

  // Which variant owns each slot, and where it sits in that variant's buffer.
  const layout = useMemo(() => {
    const variantOf = new Uint8Array(slots);
    const indexOf = new Uint32Array(slots);
    const counts = new Array<number>(tier.variants).fill(0);
    for (let i = 0; i < slots; i++) {
      const v =
        tier.variants === 1
          ? 0
          : Math.min(tier.variants - 1, Math.floor(hash(i, 7717, 31) * tier.variants));
      variantOf[i] = v;
      indexOf[i] = counts[v]++;
    }
    return { variantOf, indexOf, counts };
  }, [tier, slots]);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#ffffff",
        roughness: 0.96,
        metalness: 0.0,
      }),
    []
  );

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tint = useMemo(() => new THREE.Color(), []);
  const base = useMemo(() => new THREE.Color(tier.colour), [tier]);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const nrm = useMemo(() => new THREE.Vector3(), []);
  const cursor = useRef(0);

  useFrame(() => {
    const list = meshes.current;
    if (list.length < tier.variants || list.some((m) => !m)) return;

    const baseI = Math.floor(telemetry.x / tier.cell) - (tier.cells - 1) / 2;
    const baseJ = Math.floor(telemetry.z / tier.cell) - (tier.cells - 1) / 2;

    // Roll through the slots continuously. Whatever the rover does, every slot
    // is refreshed within a few frames and none of them is ever empty.
    for (let n = 0; n < tier.budget; n++) {
      const idx = cursor.current;
      cursor.current = (cursor.current + 1) % slots;

      const cellIdx = Math.floor(idx / tier.perCell);
      const k = idx % tier.perCell;
      // Wrap the slot's fixed lattice position into the live window.
      const gi = baseI + wrap((cellIdx % tier.cells) - baseI, tier.cells);
      const gj = baseJ + wrap(Math.floor(cellIdx / tier.cells) - baseJ, tier.cells);

      const mesh = list[layout.variantOf[idx]]!;
      const at = layout.indexOf[idx];

      // Clumping at two scales, smoothly interpolated, so the field breaks up
      // into bare ground and rubble instead of an even sprinkle.
      const clump =
        0.62 * smoothHash(gi / 4.5, gj / 4.5, 77) +
        0.38 * smoothHash(gi / 13, gj / 13, 91);

      if (hash(gi, gj, k * 4 + 3) > tier.coverage * (0.3 + clump * 1.15)) {
        dummy.position.set(0, -9999, 0);
        dummy.quaternion.identity();
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(at, dummy.matrix);
        continue;
      }

      const rx = (gi + hash(gi, gj, k * 4 + 1)) * tier.cell;
      const rz = (gj + hash(gi, gj, k * 4 + 2)) * tier.cell;
      const size = powerLawSize(hash(gi, gj, k * 4 + 5), tier.min, tier.max, tier.alpha);

      const y = sampleHeight(rx, rz);
      const sy = size * (0.55 + hash(gi, gj, k * 4 + 7) * 0.55);
      // Sit them *into* the regolith. The height has to be measured after
      // flattening: the source shell is only 0.5 * flatten tall before the
      // instance scale.
      const halfHeight = 0.5 * tier.flatten * sy;
      dummy.position.set(rx, y + halfHeight * 0.68, rz);
      dummy.scale.set(
        size * (0.8 + hash(gi, gj, k * 4 + 6) * 0.6),
        sy,
        size * (0.8 + hash(gi, gj, k * 4 + 8) * 0.6)
      );
      if (tier.bedded) {
        const nn = sampleNormal(rx, rz, Math.max(0.4, size));
        nrm.set(nn[0], nn[1], nn[2]);
        dummy.quaternion.setFromUnitVectors(up, nrm);
      } else {
        dummy.quaternion.identity();
      }
      dummy.rotateY(hash(gi, gj, k * 4 + 9) * Math.PI * 2);
      dummy.rotateX((hash(gi, gj, k * 4 + 10) - 0.5) * 0.7);
      dummy.rotateZ((hash(gi, gj, k * 4 + 11) - 0.5) * 0.7);
      dummy.updateMatrix();
      mesh.setMatrixAt(at, dummy.matrix);

      // Tone varies stone to stone: dustier ones lighter, fresh faces darker.
      const shade = 0.62 + hash(gi, gj, k * 4 + 13) * 0.72;
      const warm = 0.94 + hash(gi, gj, k * 4 + 14) * 0.16;
      tint.copy(base).multiplyScalar(shade);
      tint.setRGB(Math.min(1, tint.r * warm), tint.g, tint.b);
      mesh.setColorAt(at, tint);
    }

    for (const m of list) {
      m!.instanceMatrix.needsUpdate = true;
      if (m!.instanceColor) m!.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      {geometries.map((g, v) => (
        <instancedMesh
          key={v}
          ref={(el) => {
            meshes.current[v] = el;
          }}
          args={[g, material, Math.max(1, layout.counts[v])]}
          castShadow
          receiveShadow
          frustumCulled={false}
        />
      ))}
    </>
  );
}

export function Rocks() {
  return (
    <>
      {TIERS.map((t) => (
        <ScatterLayer key={t.name} tier={t} />
      ))}
    </>
  );
}
