"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

import { sunAt } from "@/lib/mars";
import { mounts } from "@/lib/mounts";
import { skyAmbient, sunlightColor } from "@/lib/sky";
import { telemetry, useUi } from "@/lib/store";
import { shared } from "@/lib/uniforms";

/**
 * Half-width of the shadow frustum, metres. Wide enough that the boulder field
 * around the rover throws real shadows — at low sun those long shadows are
 * most of what makes the ground read as ground.
 */
const SHADOW_EXTENT = 26;
/** How far up the sun ray the shadow camera sits. */
const SHADOW_DISTANCE = 60;

/**
 * Drives the clock, the sun, and every lighting value in the scene.
 *
 * Kept in one place so the sky dome, the terrain's aerial perspective, and the
 * rover's own lights can never drift out of agreement about where the sun is.
 */
export function Sun() {
  const light = useRef<THREE.DirectionalLight>(null);
  const target = useRef<THREE.Object3D>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const ui = useUi.getState();

    if (!ui.timeFrozen) {
      // timeRate is sols per real-world minute.
      telemetry.localTime += ui.timeRate * (24 / 60) * dt;
      if (telemetry.localTime >= 24) {
        telemetry.localTime -= 24;
        telemetry.sol += 1;
      }
    }

    const sun = sunAt(telemetry.localTime, ui.ls);
    const [sx, sy, sz] = sun.direction;

    shared.uSunDir.value.set(sx, sy, sz);
    const sc = sunlightColor(sy);
    shared.uSunColor.value.setRGB(sc[0], sc[1], sc[2]);
    const amb = skyAmbient(sy);
    shared.uAmbient.value.setRGB(amb[0], amb[1], amb[2]);
    shared.uDaylight.value = sun.daylight;

    telemetry.sunElevation = sun.elevation;
    telemetry.sunAzimuth = sun.azimuth;

    // Open the exposure as the sun drops, the way an eye or a camera would.
    // Without this, the last hour before sunset just reads as muddy.
    const lowSun = THREE.MathUtils.clamp((14 - sun.elevation) / 30, 0, 1);
    const nightFade = THREE.MathUtils.clamp((sun.elevation + 10) / 12, 0.25, 1);
    state.gl.toneMappingExposure = (0.80 + 0.5 * lowSun) * nightFade;

    const root = mounts.root;
    if (root && light.current && target.current) {
      light.current.target = target.current;
      light.current.position.set(
        root.position.x + sx * SHADOW_DISTANCE,
        root.position.y + sy * SHADOW_DISTANCE,
        root.position.z + sz * SHADOW_DISTANCE
      );
      target.current.position.copy(root.position);
      light.current.color.setRGB(sc[0], sc[1], sc[2]);
      light.current.intensity = 3.1 * sun.daylight;
    }

    if (hemi.current) {
      // Shadows on Mars are filled by dust-scattered light, so they read warm
      // and reddish rather than the cold blue of an Earth sky.
      hemi.current.color.setRGB(amb[0] * 3.2, amb[1] * 2.6, amb[2] * 2.3);
      hemi.current.groundColor.setRGB(amb[0] * 2.4, amb[1] * 1.3, amb[2] * 0.8);
      hemi.current.intensity = 0.26 + 0.42 * sun.daylight;
    }
  });

  return (
    <>
      <object3D ref={target} />
      <directionalLight
        ref={light}
        castShadow
        intensity={3.1}
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-SHADOW_EXTENT}
        shadow-camera-right={SHADOW_EXTENT}
        shadow-camera-top={SHADOW_EXTENT}
        shadow-camera-bottom={-SHADOW_EXTENT}
        shadow-camera-near={1}
        shadow-camera-far={SHADOW_DISTANCE * 2.2}
        // The terrain is displaced in the vertex shader, so its shadow depth
        // needs a generous normal bias to stay off its own surface.
        // A 4096 map over a 52 m frustum is ~13 mm per texel, tight enough
        // that the normal bias can stay small — a large one visibly detaches
        // gravel from its own shadow.
        shadow-bias={-0.00018}
        shadow-normalBias={0.015}
      />
      <hemisphereLight ref={hemi} intensity={0.9} />
    </>
  );
}
