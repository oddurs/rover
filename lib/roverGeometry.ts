import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { GEO } from "./rover";

/**
 * Rover geometry, built procedurally.
 *
 * Nothing here is downloaded: NASA's published Curiosity meshes are
 * visualisation-grade (millions of triangles, no clean suspension rig), and
 * this app has to articulate the linkage every frame and stay small enough to
 * deploy. So the rover is authored from primitives, merged down to a handful
 * of draw calls.
 */

function tx(g: THREE.BufferGeometry, x: number, y: number, z: number) {
  g.translate(x, y, z);
  return g;
}

/**
 * One wheel: cleated drum, curved-spoke hub, spun about local X.
 *
 * Curiosity's wheels are 0.5 m across with 24 chevron grousers — the cleats
 * that do the actual gripping — on a thin aluminium skin, carried on flexible
 * titanium spokes that act as the springs.
 */
export function buildWheelGeometry(): THREE.BufferGeometry {
  const r = GEO.wheelRadius;
  const w = GEO.wheelWidth;
  const parts: THREE.BufferGeometry[] = [];

  // Skin. Open-ended so we can see the spokes through the sides.
  const skin = new THREE.CylinderGeometry(r, r, w, 32, 1, true);
  skin.rotateZ(Math.PI / 2);
  parts.push(skin);

  // Stiffening rings at both rims.
  for (const s of [-1, 1]) {
    const ring = new THREE.TorusGeometry(r * 0.995, 0.012, 6, 32);
    ring.rotateY(Math.PI / 2);
    parts.push(tx(ring, (s * w) / 2, 0, 0));
  }

  // 24 grousers.
  const GROUSERS = 24;
  for (let i = 0; i < GROUSERS; i++) {
    const a = (i / GROUSERS) * Math.PI * 2;
    const cleat = new THREE.BoxGeometry(w * 0.94, 0.03, 0.05);
    cleat.rotateX(a);
    cleat.translate(0, Math.cos(a) * (r + 0.012), Math.sin(a) * (r + 0.012));
    parts.push(cleat);
  }

  // Hub and flexible spokes.
  const hub = new THREE.CylinderGeometry(r * 0.28, r * 0.28, w * 0.5, 16);
  hub.rotateZ(Math.PI / 2);
  parts.push(hub);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spoke = new THREE.BoxGeometry(w * 0.12, r * 0.78, 0.018);
    spoke.translate(0, r * 0.53, 0);
    spoke.rotateX(a);
    parts.push(spoke);
  }

  return mergeGeometries(parts, false)!;
}

/** A strut between two points in the rover's local frame. */
export function strut(
  from: [number, number, number],
  to: [number, number, number],
  radius = 0.035
): THREE.BufferGeometry {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();

  const g = new THREE.CylinderGeometry(radius, radius, len, 10);
  // Cylinders are built along +Y; aim it along the strut.
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.clone().normalize()
  );
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/**
 * The radioisotope thermoelectric generator: a finned drum cantilevered off
 * the back deck. It is what makes the rover's silhouette unmistakable from
 * behind, and the reason Curiosity doesn't care about dust on solar panels.
 */
export function buildRtgGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const body = new THREE.CylinderGeometry(0.32, 0.32, 0.64, 20);
  body.rotateX(Math.PI / 2);
  parts.push(body);

  for (const s of [-1, 1]) {
    const cap = new THREE.CylinderGeometry(0.26, 0.32, 0.09, 20);
    cap.rotateX(Math.PI / 2);
    parts.push(tx(cap, 0, 0, s * 0.36));
  }

  // Eight radiating fins.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const fin = new THREE.BoxGeometry(0.012, 0.30, 0.60);
    fin.translate(0, 0.30, 0);
    fin.rotateZ(a);
    parts.push(fin);
  }

  return mergeGeometries(parts, false)!;
}

/** Mast head: Mastcam pair, Navcam pair, and the ChemCam turret on top. */
export function buildMastHeadGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const head = new THREE.BoxGeometry(0.52, 0.16, 0.14);
  parts.push(head);

  // Mastcam M-34 and M-100, outboard.
  for (const [x, r] of [
    [-0.17, 0.045],
    [0.17, 0.055],
  ] as const) {
    const lens = new THREE.CylinderGeometry(r, r, 0.1, 14);
    lens.rotateX(Math.PI / 2);
    parts.push(tx(lens, x, 0, -0.1));
  }

  // Navcam stereo pair, inboard.
  for (const x of [-0.06, 0.06]) {
    const lens = new THREE.CylinderGeometry(0.026, 0.026, 0.07, 12);
    lens.rotateX(Math.PI / 2);
    parts.push(tx(lens, x, 0.035, -0.09));
  }

  // ChemCam: the laser that vaporises rock at up to seven metres.
  const turret = new THREE.CylinderGeometry(0.085, 0.095, 0.14, 16);
  parts.push(tx(turret, 0, 0.15, 0));
  const aperture = new THREE.CylinderGeometry(0.055, 0.055, 0.06, 16);
  aperture.rotateX(Math.PI / 2);
  parts.push(tx(aperture, 0, 0.17, -0.08));

  return mergeGeometries(parts, false)!;
}

/** High-gain antenna: a flat hexagonal panel on a short gimbal. */
export function buildHgaGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const dish = new THREE.CylinderGeometry(0.15, 0.15, 0.022, 6);
  dish.rotateX(Math.PI / 2.6);
  parts.push(tx(dish, 0, 0.16, 0));
  parts.push(new THREE.CylinderGeometry(0.03, 0.04, 0.16, 10));
  return mergeGeometries(parts, false)!;
}
