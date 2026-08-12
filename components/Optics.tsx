"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import { getView } from "@/lib/cameras";
import { getFilter } from "@/lib/filters";
import { GRADE_GLSL, grade, lut } from "@/lib/grading";
import { pano, panoramaAdvance, panoramaTick, tileX } from "@/lib/panorama";
import { capture as grab } from "@/lib/capture";
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
uniform sampler2D uSceneR;
uniform float uStereo;
uniform vec3  uFilterW;
uniform float uFilterOn;
uniform float uFilterGain;
uniform float uND;
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

${GRADE_GLSL}

/**
 * Red/cyan anaglyph.
 *
 * The instruments this is offered on are stereo pairs with real baselines, and
 * the two widest — Navcam and Hazcam — have no colour filter array at all, so
 * their frames are grey and the composite carries no retinal rivalry. For the
 * colour Mastcams the left eye contributes luminance to red and the right eye
 * keeps green and blue, which is the usual compromise.
 */
/** The detector's response: filter band first, then colour or greyscale. */
vec3 respond(vec3 c, float mono) {
  c *= uND;
  if (uFilterOn > 0.5) {
    // A science band comes back as one number per pixel, not three.
    return vec3(dot(c, uFilterW) * uFilterGain);
  }
  if (mono > 0.5) return vec3(dot(c, vec3(0.2126, 0.7152, 0.0722)));
  return c;
}

vec3 anaglyph(vec3 l, vec3 r) {
  float lum = dot(l, vec3(0.2126, 0.7152, 0.0722));
  return vec3(lum, r.g, r.b);
}

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

    // Each eye gets the detector's own response *before* they are combined.
    // Applying the monochrome conversion afterwards simply flattens the
    // anaglyph back to grey, which is a good way to spend an afternoon.
    vec3 l = respond(texture2D(uScene, src).rgb, uMono);
    if (uStereo > 0.5) {
      col = anaglyph(l, respond(texture2D(uSceneR, src).rgb, uMono));
    } else {
      col = l;
    }
    vig = 1.0 - uVignette * r * r;
  }

  // External views only; instrument views handled their own response above.
  if (uMono > 0.5 && uExternal > 0.5) {
    col = vec3(dot(col, vec3(0.2126, 0.7152, 0.0722)));
  }

  col *= vig;

  // The grade sits on top of everything, the way a grade sits on top of a shot.
  col = gradeLinear(col);
  col = toSrgb(col);
  if (uLutMix > 0.0) col = mix(col, applyLut(col), uLutMix);

  // Frame-wide falloff, separate from the instrument's own vignette.
  if (uGVignette > 0.0) {
    vec2 q = vUv - 0.5;
    col *= 1.0 - uGVignette * clamp(dot(q, q) * 2.1, 0.0, 1.0);
  }

  // A whisper of sensor grain, so instrument frames don't read as CG-clean.
  float grainAmt = max(uGrain, uGGrain);
  if (grainAmt > 0.0) {
    float n = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
    col += (n - 0.5) * grainAmt;
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

/** Widest rectilinear render we will ask for, degrees. */
const MAX_RENDER_FOV = 168;

interface Rig {
  target: THREE.WebGLRenderTarget;
  targetR: THREE.WebGLRenderTarget;
  /** Composited output, kept readable for panorama capture. */
  capture: THREE.WebGLRenderTarget;
  pixels: Uint8Array;
  scratch: HTMLCanvasElement;
  material: THREE.ShaderMaterial;
  quadScene: THREE.Scene;
  quadCam: THREE.OrthographicCamera;
}

function createRig(): Rig {
  const opts = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    // Half-float keeps the pass in linear light with room to spare, so the
    // monochrome conversion and vignette happen before the sRGB encode.
    type: THREE.HalfFloatType,
    depthBuffer: true,
  } as const;
  const target = new THREE.WebGLRenderTarget(1, 1, opts);
  // Second eye. Only rendered into when a stereo instrument is selected.
  const targetR = new THREE.WebGLRenderTarget(1, 1, opts);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uScene: { value: null as THREE.Texture | null },
      uSceneR: { value: null as THREE.Texture | null },
      uStereo: { value: 0 },
      uFilterW: { value: new THREE.Vector3(1, 0, 0) },
      uFilterOn: { value: 0 },
      uFilterGain: { value: 1 },
      uND: { value: 1 },
      uGExposure: { value: 0 },
      uGContrast: { value: 1 },
      uGSaturation: { value: 1 },
      uGTemperature: { value: 0 },
      uGTint: { value: 0 },
      uGLift: { value: 0 },
      uGShadowTint: { value: new THREE.Vector3(0.16, 0.34, 0.62) },
      uGHighTint: { value: new THREE.Vector3(1.0, 0.72, 0.36) },
      uGToning: { value: 0 },
      uGVignette: { value: 0 },
      uGGrain: { value: 0 },
      uLut: { value: null as THREE.Texture | null },
      uLutSize: { value: 2 },
      uLutMix: { value: 0 },
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

  // Plain bytes: the quad has already encoded to sRGB, so this can be read
  // straight into an ImageData without any further conversion.
  const capture = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });

  return {
    target,
    targetR,
    capture,
    pixels: new Uint8Array(0),
    scratch: document.createElement("canvas"),
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
      rig.current?.targetR.dispose();
      rig.current?.capture.dispose();
      rig.current?.material.dispose();
      rig.current = null;
    };
  }, []);

  // Priority > 0 takes over the render loop; nothing else draws the frame.
  useFrame((state) => {
    if (!rig.current) rig.current = createRig();
    const rg = rig.current;
    const { target, targetR, capture, material, quadScene, quadCam } = rg;
    const { gl, scene, camera, size, viewport } = state;

    const view = getView(useUi.getState().view);
    const W = size.width;
    const H = size.height;

    const pw = Math.max(1, Math.floor(W * viewport.dpr));
    const ph = Math.max(1, Math.floor(H * viewport.dpr));
    if (target.width !== pw || target.height !== ph) {
      target.setSize(pw, ph);
      targetR.setSize(pw, ph);
      capture.setSize(pw, ph);
    }

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

    // Filters only exist on the Mastcams.
    const ui = useUi.getState();
    const filt = getFilter(ui.filter);
    const filtered = view.id.startsWith("mastcam") && filt.weights !== null;
    u.uFilterOn.value = filtered ? 1 : 0;
    u.uFilterGain.value = filt.gain;
    u.uND.value = view.id.startsWith("mastcam") ? filt.nd : 1;
    if (filt.weights) {
      (u.uFilterW.value as THREE.Vector3).set(...filt.weights);
    }

    // Stereo is only offered where the real instrument is a pair.
    const stereo = useUi.getState().stereo && view.baseline > 0 && view.mount !== "external";
    u.uStereo.value = stereo ? 1 : 0;

    if (stereo) {
      // Step the camera to each eye along its own right-hand axis, at half the
      // real baseline either side of the mount.
      const half = view.baseline / 2;
      camera.translateX(-half);
      gl.setRenderTarget(target);
      gl.render(scene, camera);
      camera.translateX(2 * half);
      gl.setRenderTarget(targetR);
      gl.render(scene, camera);
      camera.translateX(-half);
      gl.setRenderTarget(null);
      u.uSceneR.value = targetR.texture;
    } else {
      gl.setRenderTarget(target);
      gl.render(scene, camera);
      gl.setRenderTarget(null);
    }

    u.uScene.value = target.texture;

    // Grade, read straight off the live object so the panel is immediate.
    u.uGExposure.value = grade.exposure;
    u.uGContrast.value = grade.contrast;
    u.uGSaturation.value = grade.saturation;
    u.uGTemperature.value = grade.temperature;
    u.uGTint.value = grade.tint;
    u.uGLift.value = grade.lift;
    (u.uGShadowTint.value as THREE.Vector3).set(...grade.shadowTint);
    (u.uGHighTint.value as THREE.Vector3).set(...grade.highlightTint);
    u.uGToning.value = grade.toning;
    u.uGVignette.value = grade.vignette;
    u.uGGrain.value = grade.grain;
    u.uLut.value = lut.texture;
    u.uLutSize.value = Math.max(2, lut.size);
    u.uLutMix.value = lut.texture ? grade.lutMix : 0;

    // Panorama: composite once into a readable target, lift the instrument
    // frame out of it, then present the same pass to the screen.
    const wantFrame = grab.pending;
    if ((panoramaTick() && pano.canvas) || wantFrame) {
      const fw = Math.max(1, Math.round(frameW * viewport.dpr));
      const fh = Math.max(1, Math.round(frameH * viewport.dpr));
      const ox = Math.round((pw - fw) / 2);
      const oy = Math.round((ph - fh) / 2);

      gl.setRenderTarget(capture);
      gl.render(quadScene, quadCam);

      const need = fw * fh * 4;
      if (rg.pixels.length !== need) rg.pixels = new Uint8Array(need);
      gl.readRenderTargetPixels(capture, ox, oy, fw, fh, rg.pixels);
      gl.setRenderTarget(null);

      rg.scratch.width = fw;
      rg.scratch.height = fh;
      const sctx = rg.scratch.getContext("2d");
      if (sctx) {
        const img = sctx.createImageData(fw, fh);
        // readRenderTargetPixels hands back rows bottom-up.
        for (let y = 0; y < fh; y++) {
          const src = (fh - 1 - y) * fw * 4;
          img.data.set(rg.pixels.subarray(src, src + fw * 4), y * fw * 4);
        }
        sctx.putImageData(img, 0, 0);
        if (pano.active && pano.canvas) {
          const dctx = pano.canvas.getContext("2d");
          dctx?.drawImage(rg.scratch, 0, 0, fw, fh, tileX(), 0, pano.tileW, pano.tileH);
        }
        if (wantFrame) grab.deliver(rg.scratch, fw, fh);
      }
      if (pano.active) panoramaAdvance();
    }

    gl.render(quadScene, quadCam);
  }, 1);

  return null;
}
