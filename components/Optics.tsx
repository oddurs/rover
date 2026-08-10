"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import { getView } from "@/lib/cameras";
import { useUi } from "@/lib/store";

/**
 * Instrument optics.
 *
 * The scene renders to a texture, then a single full-screen pass gives the
 * active camera the character of the real detector: the frame shape it
 * actually produces, monochrome response where the detector has no colour
 * filter array, and an equidistant fisheye projection for the Hazcams.
 *
 * The fisheye is a genuine remap rather than a lens-flare-style fake. The
 * scene is rendered rectilinear at whatever field of view puts the fisheye's
 * edge ray at the frame boundary, and this pass resamples it by angle: output
 * radius is proportional to the angle off-axis, which is what "equidistant"
 * means. A 124-degree fisheye needs a 124-degree rectilinear render to feed
 * it, so the corners of the source are stretched thin — the circular mask that
 * real Hazcam frames have anyway is what keeps that out of shot.
 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uScene;
uniform vec2  uFrameHalf;      // instrument frame half-extents, canvas NDC
uniform float uFrameAspect;    // frame width / height
uniform float uCanvasAspect;
uniform float uTanHalfCanvas;  // tan of the render camera's vertical half-FOV
uniform float uHalfFov;        // instrument half-FOV, radians
uniform float uMono;
uniform float uFisheye;
uniform float uCircular;
uniform float uExternal;
uniform float uVignette;
uniform float uGrain;

vec3 toSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

void main() {
  vec3 col;
  float vig = 1.0;

  if (uExternal > 0.5) {
    col = texture2D(uScene, vUv).rgb;
  } else {
    vec2 ndc = vUv * 2.0 - 1.0;
    vec2 f = ndc / uFrameHalf;                 // -1..1 across the frame
    if (max(abs(f.x), abs(f.y)) > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); // outside the detector
      return;
    }

    // Isotropic angular coordinates: 1.0 is the frame edge in both axes.
    vec2 fa = vec2(f.x * uFrameAspect, f.y);
    float r = length(fa);

    vec2 src;
    if (uFisheye > 0.5) {
      if (r > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      // Equidistant: angle off-axis is linear in radius.
      float theta = r * uHalfFov;
      vec2 dir = r > 1e-5 ? fa / r : vec2(0.0);
      vec2 t = dir * tan(theta);
      src = vec2(t.x / (uTanHalfCanvas * uCanvasAspect), t.y / uTanHalfCanvas) * 0.5 + 0.5;
    } else {
      if (uCircular > 0.5 && r > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      src = vUv;
    }

    col = texture2D(uScene, src).rgb;
    vig = 1.0 - uVignette * r * r;
  }

  // These detectors carry no colour filter array, so their frames are grey.
  if (uMono > 0.5) col = vec3(dot(col, vec3(0.2126, 0.7152, 0.0722)));

  col *= vig;
  col = toSrgb(col);

  // A whisper of sensor grain, so instrument frames don't read as CG-clean.
  if (uGrain > 0.0) {
    float n = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
    col += (n - 0.5) * uGrain;
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

/** Widest rectilinear render we will ask for, degrees. */
const MAX_RENDER_FOV = 168;

interface Rig {
  target: THREE.WebGLRenderTarget;
  material: THREE.ShaderMaterial;
  quadScene: THREE.Scene;
  quadCam: THREE.OrthographicCamera;
}

function createRig(): Rig {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    // Half-float keeps the pass in linear light with room to spare, so the
    // monochrome conversion and vignette happen before the sRGB encode.
    type: THREE.HalfFloatType,
    depthBuffer: true,
  });

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uScene: { value: null as THREE.Texture | null },
      uFrameHalf: { value: new THREE.Vector2(1, 1) },
      uFrameAspect: { value: 1 },
      uCanvasAspect: { value: 1 },
      uTanHalfCanvas: { value: 1 },
      uHalfFov: { value: 0.5 },
      uMono: { value: 0 },
      uFisheye: { value: 0 },
      uCircular: { value: 0 },
      uExternal: { value: 1 },
      uVignette: { value: 0 },
      uGrain: { value: 0 },
    },
  });

  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  quadScene.add(quad);

  return {
    target,
    material,
    quadScene,
    quadCam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
  };
}

export function Optics() {
  // Built on first frame rather than in a memo: these are mutated every frame,
  // which is what three expects and what hook return values are not for.
  const rig = useRef<Rig | null>(null);

  useEffect(() => {
    return () => {
      rig.current?.target.dispose();
      rig.current?.material.dispose();
      rig.current = null;
    };
  }, []);

  // Priority > 0 takes over the render loop; nothing else draws the frame.
  useFrame((state) => {
    if (!rig.current) rig.current = createRig();
    const { target, material, quadScene, quadCam } = rig.current;
    const { gl, scene, camera, size, viewport } = state;

    const view = getView(useUi.getState().view);
    const W = size.width;
    const H = size.height;

    const pw = Math.max(1, Math.floor(W * viewport.dpr));
    const ph = Math.max(1, Math.floor(H * viewport.dpr));
    if (target.width !== pw || target.height !== ph) target.setSize(pw, ph);

    // Fit the instrument's frame inside the window.
    const frameH = view.aspect === 0 ? H : Math.min(H, W / view.aspect);
    const frameW = view.aspect === 0 ? W : frameH * view.aspect;
    const fracH = frameH / H;

    // Choose the render field of view so the *frame* subtends the instrument's
    // field of view, whatever shape the browser window happens to be.
    const halfFov = THREE.MathUtils.degToRad(view.fov) / 2;
    const tanCanvas = Math.min(
      Math.tan(halfFov) / fracH,
      Math.tan(THREE.MathUtils.degToRad(MAX_RENDER_FOV) / 2)
    );
    const fovDeg = THREE.MathUtils.radToDeg(Math.atan(tanCanvas) * 2);

    if (camera instanceof THREE.PerspectiveCamera) {
      if (Math.abs(camera.fov - fovDeg) > 1e-4 || camera.aspect !== W / H) {
        camera.fov = fovDeg;
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
      }
    }

    const u = material.uniforms;
    (u.uFrameHalf.value as THREE.Vector2).set(frameW / W, fracH);
    u.uFrameAspect.value = view.aspect === 0 ? W / H : view.aspect;
    u.uCanvasAspect.value = W / H;
    u.uTanHalfCanvas.value = tanCanvas;
    u.uHalfFov.value = halfFov;
    u.uMono.value = view.mono ? 1 : 0;
    u.uFisheye.value = view.fisheye ? 1 : 0;
    u.uCircular.value = view.circular ? 1 : 0;
    u.uExternal.value = view.mount === "external" ? 1 : 0;
    u.uVignette.value = view.mount === "external" ? 0 : view.fisheye ? 0.5 : 0.26;
    u.uGrain.value = view.mount === "external" ? 0 : 0.016;

    gl.setRenderTarget(target);
    gl.render(scene, camera);
    gl.setRenderTarget(null);

    u.uScene.value = target.texture;
    gl.render(quadScene, quadCam);
  }, 1);

  return null;
}
