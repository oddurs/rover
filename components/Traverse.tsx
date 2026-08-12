"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { asset } from "@/lib/assets";
import { telemetry, useUi } from "@/lib/store";
import { sampleHeight } from "@/lib/terrain";

/**
 * Curiosity's actual route across Gale.
 *
 * 1,371 localised positions from sol 3 to sol 4977 — 37.99 km of driving,
 * ending 14 km from the landing site and a kilometre up the side of Mount
 * Sharp. Every point is somewhere the rover really stopped.
 *
 * Drawn as a ribbon rather than a line, because a GL line is one pixel wide on
 * most hardware regardless of what you ask for. The heights are recomputed
 * against the same band-limited height field and the same planetary curvature
 * the terrain shader uses, or the far end of the route would float thirty
 * metres above the ground it is supposed to be lying on.
 */

const MARS_RADIUS = 3389500;
const WIDTH = 1.0;
/** Points refreshed per frame; the whole route cycles every few frames. */
const CHUNK = 420;

interface Waypoint {
  x: number;
  z: number;
  sol: number;
  d: number;
}

export function Traverse() {
  const show = useUi((s) => s.showTraverse);
  const [pts, setPts] = useState<Waypoint[] | null>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const cursor = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetch(asset("/terrain/msl-traverse.json"))
      .then((r) => r.json())
      .then((d: { points: Waypoint[] }) => {
        if (!cancelled) setPts(d.points);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const geometry = useMemo(() => {
    if (!pts) return null;
    const n = pts.length;
    const pos = new Float32Array(n * 2 * 3);
    const idx: number[] = [];

    for (let i = 0; i < n; i++) {
      // Ribbon runs perpendicular to the local direction of travel.
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(n - 1, i + 1)];
      let dx = next.x - prev.x;
      let dz = next.z - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const nx = -dz * (WIDTH / 2);
      const nz = dx * (WIDTH / 2);

      // Seed the height straight away. The per-frame refresh only touches a
      // slice of the route, so anything left unset would spend its first few
      // frames at y = 0 — four and a half kilometres above the ground.
      const dist = Math.hypot(pts[i].x, pts[i].z);
      const y = sampleHeight(pts[i].x, pts[i].z, dist) - (dist * dist) / (2 * MARS_RADIUS) + 0.25;

      pos[i * 6 + 0] = pts[i].x + nx;
      pos[i * 6 + 1] = y;
      pos[i * 6 + 2] = pts[i].z + nz;
      pos[i * 6 + 3] = pts[i].x - nx;
      pos[i * 6 + 4] = y;
      pos[i * 6 + 5] = pts[i].z - nz;

      if (i < n - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    return g;
  }, [pts]);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#ffa838",
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    []
  );

  useFrame(() => {
    const g = geometry;
    if (!g || !pts || !show) return;
    const attr = g.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;

    // Lay the ribbon on the surface the shader is actually drawing: same
    // distance-banded detail, same curvature drop away from the rover.
    const n = pts.length;
    const start = cursor.current;
    const end = Math.min(n, start + CHUNK);
    for (let i = start; i < end; i++) {
      const p = pts[i];
      const dx = p.x - telemetry.x;
      const dz = p.z - telemetry.z;
      const dist = Math.hypot(dx, dz);
      const drop = (dist * dist) / (2 * MARS_RADIUS);
      const y = sampleHeight(p.x, p.z, dist) - drop + 0.25;
      arr[i * 6 + 1] = y;
      arr[i * 6 + 4] = y;
    }
    cursor.current = end >= n ? 0 : end;
    attr.needsUpdate = true;
  });

  if (!geometry || !show) return null;
  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} />;
}
