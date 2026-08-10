"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";

import { CLIPMAP, buildClipmapLevel, cellSize } from "@/lib/clipmap";
import { SKY_GLSL } from "@/lib/sky";
import { GLSL_TERRAIN } from "@/lib/terrain";
import { shared } from "@/lib/uniforms";

/**
 * Terrain surface.
 *
 * Built on MeshStandardMaterial rather than a bare ShaderMaterial, with the
 * height field injected into the vertex stage. That costs a little control and
 * buys a lot: the ground receives real shadow maps, so rocks and the rover lay
 * genuine shadows across it — which at low sun is most of what sells the place.
 */

const VERT_HEAD = /* glsl */ `
${GLSL_TERRAIN}

uniform vec2  uCenter;
uniform float uCell;
uniform float uSkirtDepth;
uniform vec2  uFocus;

attribute float aSkirt;

varying vec3  vTerrainWorld;
varying float vTerrainDist;
varying vec3  vTerrainNormal;

const float MARS_RADIUS = 3389500.0;

/**
 * Ground height including the curvature of the planet.
 *
 * Mars is small — a third of Earth's radius — and the terrain is modelled on a
 * flat plane, so without this the ground simply keeps going and the horizon
 * never arrives. Dropping the surface away as the square of the distance from
 * the viewer puts the horizon at its true ~3.7 km for a two-metre eye height,
 * hides the far crater floor the way the planet actually hides it, and makes
 * distant relief rise *out* of the horizon rather than sit on top of it. At
 * 84 km — the north rim — that drop is over a kilometre.
 *
 * Measured from the rover rather than the camera: the two are never far apart,
 * and keying off the LOD centre keeps the surface stable as the camera orbits.
 */
float surfaceY(vec2 p, float lod) {
  vec2 r = p - uFocus;
  return sampleHeight(p, lod) - dot(r, r) / (2.0 * MARS_RADIUS);
}
`;

/**
 * Runs in place of <beginnormal_vertex>, which is the first hook that fires —
 * both the displaced position and its normal have to exist before three's
 * normal and shadow chunks run.
 */
const VERT_NORMAL = /* glsl */ `
  vec2 tp = uCenter + position.xz * uCell;
  float tLod = length(tp - uFocus);

  float te  = max(uCell, 0.5);
  float th  = surfaceY(tp, tLod);
  float thx = surfaceY(tp + vec2(te, 0.0), tLod);
  float thz = surfaceY(tp + vec2(0.0, te), tLod);

  // Heightfield normal: (-dh/dx, 1, -dh/dz), scaled by the sample spacing.
  vec3 objectNormal = normalize(vec3(th - thx, te, th - thz));
  vTerrainNormal = objectNormal;

  vec3 tPos = vec3(tp.x, th - aSkirt * uSkirtDepth, tp.y);
  vTerrainWorld = tPos;
  vTerrainDist = distance(tPos, cameraPosition);
`;

const FRAG_HEAD = /* glsl */ `
${SKY_GLSL}

varying vec3  vTerrainWorld;
varying float vTerrainDist;
varying vec3  vTerrainNormal;

// Standalone hash noise for surface colour, independent of the height field so
// tinting doesn't simply trace the terrain's own octaves.
float cnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec4 h;
  h.x = fract(sin(dot(i + vec2(0.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  h.y = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  h.z = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  h.w = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(h.x, h.y, f.x), mix(h.z, h.w, f.x), f.y) * 2.0 - 1.0;
}

// Measured off Curiosity's own Mastcam frames of Gale (PIA25175): linear
// reflectance at the 25th/50th/75th luminance percentiles of the ground.
// That product is white balanced, so it approximates *albedo* — the Martian
// illuminant is supplied separately by the sun colour, which is the physically
// right way round. The real surface is a mildly warm grey-brown, far less
// saturated than it is usually drawn: R/G is only 1.2 in sRGB.
const vec3 DUST    = vec3(0.200, 0.132, 0.106);
const vec3 BRIGHT  = vec3(0.360, 0.268, 0.222);
const vec3 BEDROCK = vec3(0.105, 0.070, 0.055);
const vec3 BASALT  = vec3(0.048, 0.040, 0.036);
`;

/** Replaces <map_fragment>: the surface colour. */
const FRAG_COLOR = /* glsl */ `
  vec3 tN = normalize(vTerrainNormal);
  float slope = 1.0 - abs(tN.y);

  float broad    = cnoise(vTerrainWorld.xz * 0.0016) * 0.5 + 0.5;
  float duneMask = cnoise(vTerrainWorld.xz * 0.011) * 0.5 + 0.5;
  float grit     = cnoise(vTerrainWorld.xz * 0.9) * 0.5 + 0.5;

  vec3 albedo = mix(DUST, BRIGHT, broad);
  albedo = mix(albedo, BEDROCK, smoothstep(0.10, 0.38, slope));
  albedo = mix(albedo, BASALT,
               smoothstep(0.72, 0.94, duneMask) * (1.0 - smoothstep(0.05, 0.2, slope)));
  albedo *= 0.86 + 0.28 * grit;
  // Clast-scale speckle: individual stones too small to instance still want
  // to show up as tonal variation rather than flat ground.
  float speckle = cnoise(vTerrainWorld.xz * 14.0) * 0.5 + 0.5;
  albedo *= 1.0 + (speckle - 0.5) * 0.42 * smoothstep(45.0, 6.0, vTerrainDist);

  diffuseColor.rgb *= albedo;
`;

/**
 * Replaces <normal_fragment_maps>: fine relief the mesh is too coarse to
 * carry, added as a normal perturbation only. Fades out before it can alias.
 */
const FRAG_NORMAL = /* glsl */ `
  // Two bands of relief the mesh is far too coarse to carry: decimetre
  // lumpiness, then centimetre grit. Normal perturbation only, faded out
  // before either can alias.
  float fineFade = smoothstep(170.0, 22.0, vTerrainDist);
  if (fineFade > 0.0) {
    float e = 0.26;
    float a  = cnoise(vTerrainWorld.xz * 3.1);
    float ax = cnoise((vTerrainWorld.xz + vec2(e, 0.0)) * 3.1);
    float az = cnoise((vTerrainWorld.xz + vec2(0.0, e)) * 3.1);
    normal = normalize(normal + vec3((a - ax) / e, 0.0, (a - az) / e) * 0.055 * fineFade);
  }
  float gritFade = smoothstep(28.0, 5.0, vTerrainDist);
  if (gritFade > 0.0) {
    float e = 0.05;
    float b  = cnoise(vTerrainWorld.xz * 26.0);
    float bx = cnoise((vTerrainWorld.xz + vec2(e, 0.0)) * 26.0);
    float bz = cnoise((vTerrainWorld.xz + vec2(0.0, e)) * 26.0);
    normal = normalize(normal + vec3((b - bx) / e, 0.0, (b - bz) / e) * 0.0022 * gritFade);
  }
`;

/**
 * Aerial perspective, inserted before tone mapping.
 *
 * Mars' air is thin but very dusty, so distant relief washes out toward
 * whatever the sky is doing in that exact direction — which is why the same
 * ridge reads warm at midday and blue-grey when it is near the setting sun.
 */
const FRAG_HAZE = /* glsl */ `
  {
    vec3 viewDir = normalize(vTerrainWorld - cameraPosition);
    vec3 haze = hazeColor(vec3(viewDir.x, max(viewDir.y, -0.02), viewDir.z));
    float amt = 1.0 - exp(-vTerrainDist / 30000.0);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, haze, clamp(amt, 0.0, 1.0));
  }
`;

function Level({ level }: { level: number }) {
  const cell = cellSize(level);
  const geometry = useMemo(() => buildClipmapLevel(level > 0), [level]);

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.DoubleSide,
      // Levels now overlap by design, so bias the coarse ones away from the
      // camera and let the finer detail win wherever they share ground.
      polygonOffset: true,
      polygonOffsetFactor: level,
      polygonOffsetUnits: level * 2,
    });

    const own = {
      uCenter: { value: new THREE.Vector2() },
      uCell: { value: cell },
      // Deep enough to bridge the height difference between adjacent levels.
      // Only has to bridge the T-junction cracks now that the levels overlap.
      // The old depth reached kilometres on the outer rings, which is a lot of
      // curtain to have hanging about where a camera might find it.
      uSkirtDepth: { value: Math.min(40, Math.max(1.5, cell * 2.5)) },
    };
    // Stash for the frame loop.
    (m as unknown as { uCenter: { value: THREE.Vector2 } }).uCenter = own.uCenter;

    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared, own);

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${VERT_HEAD}`)
        .replace("#include <beginnormal_vertex>", VERT_NORMAL)
        .replace("#include <begin_vertex>", "vec3 transformed = tPos;");

      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${FRAG_HEAD}`)
        .replace("#include <map_fragment>", FRAG_COLOR)
        .replace("#include <normal_fragment_maps>", FRAG_NORMAL)
        .replace("#include <tonemapping_fragment>", `${FRAG_HAZE}\n#include <tonemapping_fragment>`);
    };
    // Each level compiles its own program; keep them from sharing a cache slot.
    m.customProgramCacheKey = () => `terrain-${level}`;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  useFrame(() => {
    // Snap each level to a multiple of two cells so its vertices land on the
    // same world positions every frame — otherwise the terrain swims.
    const snap = cell * 2;
    const c = (material as unknown as { uCenter: { value: THREE.Vector2 } }).uCenter.value;
    c.set(
      Math.round(shared.uFocus.value.x / snap) * snap,
      Math.round(shared.uFocus.value.y / snap) * snap
    );
  });

  return (
    <mesh geometry={geometry} material={material} receiveShadow frustumCulled={false} />
  );
}

export function Terrain() {
  const levels = useMemo(() => Array.from({ length: CLIPMAP.levels }, (_, i) => i), []);
  return (
    <>
      {levels.map((l) => (
        <Level key={l} level={l} />
      ))}
    </>
  );
}
