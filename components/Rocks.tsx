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
    cell: 4,
    perCell: 26,
    cells: 13,
    min: 0.05,
    max: 0.2,
    coverage: 0.95,
    flatten: 0.72,
    budget: 420,
    bedded: false,
    colour: "#6d5c50",
  },
  // Cobbles: the size that makes the ground read as broken rock.
  {
    name: "cobble",
    cell: 8,
    perCell: 10,
    cells: 17,
    min: 0.15,
    max: 0.72,
    coverage: 0.8,
    flatten: 0.62,
    budget: 220,
    bedded: true,
    colour: "#7a6759",
  },
  // Blocks: the ones you steer around.
  {
    name: "block",
    cell: 24,
    perCell: 3,
    cells: 15,
    min: 0.42,
    max: 2.6,
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
 * An angular fragment: a low icosahedron with its vertices kicked outward by a
 * hash and then squashed. Rendered flat-shaded, so every facet catches the sun
 * separately — which is what makes broken rock look broken.
 */
function buildClastGeometry(flatten: number, seed: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.5, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();

  // Weld first so shared corners move together and the shell stays closed.
  const moved = new Map<string, THREE.Vector3>();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let nv = moved.get(key);
    if (!nv) {
      const h1 = hash(Math.round(v.x * 1000), Math.round(v.y * 1000), seed);
      const h2 = hash(Math.round(v.z * 1000), Math.round(v.x * 1000), seed + 7);
      nv = v
        .clone()
        .multiplyScalar(0.62 + h1 * 0.76)
        .add(new THREE.Vector3((h2 - 0.5) * 0.34, (h1 - 0.5) * 0.24, (h2 - 0.5) * 0.34));
      nv.y *= flatten;
      moved.set(key, nv);
    }
    pos.setXYZ(i, nv.x, nv.y, nv.z);
  }

  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  geo.dispose();
  return flat;
}

function ScatterLayer({ tier }: { tier: Tier }) {
  const count = tier.cells * tier.cells * tier.perCell;
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(
    () => buildClastGeometry(tier.flatten, tier.name.length * 31),
    [tier]
  );
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: tier.colour,
        roughness: 0.96,
        metalness: 0.0,
      }),
    [tier]
  );

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const nrm = useMemo(() => new THREE.Vector3(), []);

  const state = useRef({ anchorI: NaN, anchorJ: NaN, cursor: count, baseI: 0, baseJ: 0 });

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const ci = Math.floor(telemetry.x / tier.cell);
    const cj = Math.floor(telemetry.z / tier.cell);
    const s = state.current;

    if (ci !== s.anchorI || cj !== s.anchorJ) {
      s.anchorI = ci;
      s.anchorJ = cj;
      s.baseI = ci - (tier.cells - 1) / 2;
      s.baseJ = cj - (tier.cells - 1) / 2;
      s.cursor = 0;
    }
    if (s.cursor >= count) return;

    // Spread the refresh across frames so crossing a cell boundary never
    // costs a visible hitch.
    const end = Math.min(count, s.cursor + tier.budget);
    for (let idx = s.cursor; idx < end; idx++) {
      const cellIdx = Math.floor(idx / tier.perCell);
      const k = idx % tier.perCell;
      const gi = s.baseI + (cellIdx % tier.cells);
      const gj = s.baseJ + Math.floor(cellIdx / tier.cells);

      const rx = (gi + hash(gi, gj, k * 4 + 1)) * tier.cell;
      const rz = (gj + hash(gi, gj, k * 4 + 2)) * tier.cell;

      // Clasts clump — bare patches and rubble fields, not a uniform sprinkle.
      const clump = hash(Math.floor(gi / 3), Math.floor(gj / 3), 77);
      if (hash(gi, gj, k * 4 + 3) > tier.coverage * (0.45 + clump * 0.85)) {
        dummy.position.set(0, -9999, 0);
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);
        continue;
      }

      // Weighted toward the small end, as real clast populations are — but
      // only quadratically. Cubing it made everything the minimum size.
      const t = hash(gi, gj, k * 4 + 5);
      const size = tier.min + (tier.max - tier.min) * t * t;

      const y = sampleHeight(rx, rz);

      const sy = size * (0.55 + hash(gi, gj, k * 4 + 7) * 0.55);
      // Sit them *into* the regolith. Note the height has to be measured after
      // flattening: the source shell is only 0.5 * flatten tall before the
      // instance scale, so burying by a fraction of the scale puts the whole
      // stone underground.
      const halfHeight = 0.5 * tier.flatten * sy;
      dummy.position.set(rx, y + halfHeight * 0.68, rz);
      dummy.scale.set(
        size * (0.8 + hash(gi, gj, k * 4 + 6) * 0.6),
        sy,
        size * (0.8 + hash(gi, gj, k * 4 + 8) * 0.6)
      );
      if (tier.bedded) {
        const n = sampleNormal(rx, rz, Math.max(0.4, size));
        nrm.set(n[0], n[1], n[2]);
        dummy.quaternion.setFromUnitVectors(up, nrm);
      } else {
        dummy.quaternion.identity();
      }
      dummy.rotateY(hash(gi, gj, k * 4 + 9) * Math.PI * 2);
      // A little topple, so they are not all perfectly bedded.
      dummy.rotateX((hash(gi, gj, k * 4 + 10) - 0.5) * 0.7);
      dummy.rotateZ((hash(gi, gj, k * 4 + 11) - 0.5) * 0.7);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix);
    }

    s.cursor = end;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, count]}
      castShadow
      receiveShadow
      frustumCulled={false}
    />
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
