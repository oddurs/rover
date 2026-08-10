/**
 * Martian atmosphere.
 *
 * The colours here are the point of the whole thing. Mars' sky is dominated by
 * suspended dust roughly 1.5 microns across, which scatters *forward* far more
 * than it scatters back, and does so more strongly at short wavelengths. So the
 * daytime sky away from the sun is butterscotch — and at sunset, when you are
 * looking almost straight through the forward-scattering lobe, the glow around
 * the sun turns blue. That inversion of Earth's sky is real, and it is the one
 * thing a Mars renderer has to get right.
 *
 * Shared between the sky dome and the terrain's aerial perspective so distant
 * ground and the sky behind it always agree.
 */

export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;

const vec3 ZENITH_DAY   = vec3(0.255, 0.200, 0.162);
const vec3 HORIZON_DAY  = vec3(0.660, 0.470, 0.330);
const vec3 ZENITH_DUSK  = vec3(0.085, 0.075, 0.092);
const vec3 HORIZON_DUSK = vec3(0.400, 0.190, 0.115);
const vec3 HALO_DAY     = vec3(0.560, 0.450, 0.340);
// The blue sunset: forward-scattered light, short wavelengths surviving best.
// Grey-blue rather than saturated blue — the real thing is desaturated.
const vec3 HALO_DUSK    = vec3(0.330, 0.430, 0.610);

float duskFactor(float sunY) { return 1.0 - smoothstep(-0.09, 0.34, sunY); }
float nightFactor(float sunY) { return 1.0 - smoothstep(-0.24, -0.02, sunY); }

/** Cheap star field, only visible once the dust glow has faded. */
float stars(vec3 dir) {
  vec3 p = floor(dir * 340.0);
  float h = fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float s = smoothstep(0.9975, 1.0, h);
  float tw = 0.6 + 0.4 * fract(h * 91.7);
  return s * tw;
}

/**
 * The colour distant terrain fades into.
 *
 * Deliberately *not* skyColor(). The bright band hugging the horizon and the
 * solar disc are properties of the sky itself; painting them onto a hillside
 * twenty kilometres away makes far ground come out brighter than the sky above
 * it, which reads as fake immediately — distant relief should always sit at or
 * just below the tone of the sky behind it. This is the base gradient plus a
 * soft forward-scattering lobe, and nothing else.
 */
vec3 hazeColor(vec3 dir) {
  vec3 d = normalize(dir);
  float dusk = duskFactor(uSunDir.y);
  float night = nightFactor(uSunDir.y);

  vec3 zen = mix(ZENITH_DAY, ZENITH_DUSK, dusk);
  vec3 hor = mix(HORIZON_DAY, HORIZON_DUSK, dusk);
  float h = pow(1.0 - clamp(d.y, 0.0, 1.0), 3.0);
  vec3 col = mix(zen, hor, h);

  float lobe = pow(max(dot(d, uSunDir), 0.0), 6.0);
  col += mix(HALO_DAY, HALO_DUSK, dusk) * lobe * (0.15 + 0.65 * dusk);

  col *= mix(1.0, 0.045, night);
  return col * 0.86;
}

vec3 skyColor(vec3 dir) {
  vec3 d = normalize(dir);
  float dusk = duskFactor(uSunDir.y);
  float night = nightFactor(uSunDir.y);

  vec3 zen = mix(ZENITH_DAY, ZENITH_DUSK, dusk);
  vec3 hor = mix(HORIZON_DAY, HORIZON_DUSK, dusk);

  float h = pow(1.0 - clamp(d.y, 0.0, 1.0), 3.0);
  vec3 col = mix(zen, hor, h);

  // A distinct brighter band in the last few degrees above the horizon: the
  // line of sight there runs through far more suspended dust than it does
  // overhead, so the scattered light piles up. It is what stops a Mars sky
  // reading as a plain vertical gradient.
  float band = exp(-max(d.y, 0.0) * 22.0);
  col = mix(col, hor * mix(1.20, 1.06, dusk), band * 0.55);

  float cosA = dot(d, uSunDir);
  // Wide forward-scattering lobe plus the disc itself. The lobe is enormous
  // compared with Earth's — that broad glow *is* the dust.
  float lobe = pow(max(cosA, 0.0), 6.0);
  float disc = pow(max(cosA, 0.0), 2600.0);
  vec3 halo = mix(HALO_DAY, HALO_DUSK, dusk);
  col += halo * lobe * (0.22 + 0.95 * dusk) + mix(vec3(1.0, 0.95, 0.86), halo * 1.6, dusk) * disc * 2.2;

  col *= mix(1.0, 0.045, night);
  col += vec3(0.85, 0.88, 1.0) * stars(d) * night * 0.55;
  return col;
}
`;

/** Direct sunlight colour, reddened as it cuts through more dust. */
export function sunlightColor(sunY: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (sunY + 0.05) / 0.4));
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return [lerp(0.95, 1.0), lerp(0.42, 0.87), lerp(0.22, 0.72)];
}

/** Rough sky-dome irradiance, for the ambient term. */
export function skyAmbient(sunY: number): [number, number, number] {
  const day = Math.max(0, Math.min(1, (sunY + 0.12) / 0.35));
  return [0.20 * day + 0.012, 0.155 * day + 0.012, 0.128 * day + 0.016];
}
