"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { SKY_GLSL } from "@/lib/sky";
import { shared } from "@/lib/uniforms";

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
${SKY_GLSL}
varying vec3 vDir;
void main() {
  gl_FragColor = vec4(skyColor(vDir), 1.0);
}
`;

/**
 * Sky dome. Rides on the camera with depth testing off, so it is always
 * infinitely far away regardless of how the far plane is set.
 */
export function Sky() {
  const ref = useRef<THREE.Mesh>(null);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        uniforms: shared,
      }),
    []
  );

  useFrame(({ camera }) => {
    ref.current?.position.copy(camera.position);
  });

  return (
    <mesh ref={ref} material={material} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[10, 64, 40]} />
    </mesh>
  );
}
