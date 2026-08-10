import * as THREE from "three";

/**
 * Uniforms shared by reference across the sky and terrain materials, so the
 * atmosphere and the ground it fades into can never disagree.
 */
export const shared = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 0.88, 0.72) },
  uAmbient: { value: new THREE.Color(0.2, 0.155, 0.128) },
  uDaylight: { value: 1 },
  /** Rover position; the clipmap's LOD centre. */
  uFocus: { value: new THREE.Vector2() },

  uMola: { value: null as THREE.Texture | null },
  uMolaSize: { value: 1 },
  uElevMin: { value: 0 },
  uElevRange: { value: 1 },
  uMolaOriginPx: { value: new THREE.Vector2() },
  uMetresPerPx: { value: new THREE.Vector2() },
};

export function molaTexture(
  data: Float32Array,
  size: number,
  min: number,
  range: number
): THREE.DataTexture {
  // Store normalised so the float texture keeps its precision in 0..1.
  const norm = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) norm[i] = (data[i] - min) / range;

  const tex = new THREE.DataTexture(norm, size, size, THREE.RedFormat, THREE.FloatType);
  // Nearest, because linear filtering of float textures is an optional
  // extension; the shader does its own bilinear lookup instead.
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
