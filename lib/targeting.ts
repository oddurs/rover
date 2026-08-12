import * as THREE from "three";

import { sampleHeight } from "./terrain";

/**
 * Point the mast at something.
 *
 * The terrain is displaced in the vertex shader, so three's raycaster — which
 * only ever sees the flat source mesh — would miss it entirely. This marches
 * the ray against the same height function the wheels use, then bisects the
 * span where it first goes underground.
 */

const MAX_RANGE = 4000;
const COARSE = 220;

export function raycastTerrain(
  origin: THREE.Vector3,
  dir: THREE.Vector3
): THREE.Vector3 | null {
  let prevT = 0;
  let prevGap = origin.y - sampleHeight(origin.x, origin.z);
  if (prevGap < 0) return null;

  // March with a step that grows, since distant ground needs less precision.
  for (let i = 1; i <= COARSE; i++) {
    const t = MAX_RANGE * (i / COARSE) ** 2;
    const x = origin.x + dir.x * t;
    const y = origin.y + dir.y * t;
    const z = origin.z + dir.z * t;
    const gap = y - sampleHeight(x, z);

    if (gap < 0) {
      // Bisect the bracket for a clean intersection.
      let lo = prevT;
      let hi = t;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        const mx = origin.x + dir.x * mid;
        const my = origin.y + dir.y * mid;
        const mz = origin.z + dir.z * mid;
        if (my - sampleHeight(mx, mz) < 0) hi = mid;
        else lo = mid;
      }
      const hit = (lo + hi) / 2;
      return new THREE.Vector3(
        origin.x + dir.x * hit,
        origin.y + dir.y * hit,
        origin.z + dir.z * hit
      );
    }
    prevT = t;
    prevGap = gap;
  }
  return null;
}

/**
 * Mast pan and tilt that would put a world point in the centre of the frame.
 * Angles are relative to the rover's heading, which is what the mast joints
 * actually move in.
 */
export function aimAt(
  target: THREE.Vector3,
  mastWorld: THREE.Vector3,
  yaw: number
): { pan: number; tilt: number } {
  const dx = target.x - mastWorld.x;
  const dy = target.y - mastWorld.y;
  const dz = target.z - mastWorld.z;

  // Into the rover frame: heading is -Z.
  const c = Math.cos(-yaw);
  const s = Math.sin(-yaw);
  const lx = dx * c + dz * s;
  const lz = -dx * s + dz * c;

  const pan = Math.atan2(-lx, -lz);
  const tilt = Math.atan2(dy, Math.hypot(lx, lz));
  return { pan, tilt };
}
