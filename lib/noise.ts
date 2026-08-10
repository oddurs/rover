/**
 * 2D simplex noise, mirrored between TypeScript and GLSL.
 *
 * The rover's wheels are placed by the CPU while the ground they sit on is
 * displaced by the GPU, so both sides have to agree on the height field. This
 * is the Ashima/Gustavson formulation: it uses only floor/fract/mod arithmetic
 * on values below 289, so it is deterministic across drivers and matches the
 * float64 version here to well under a millimetre.
 *
 * Keep GLSL_NOISE and snoise below in lockstep. If you edit one, edit both.
 */

const C_X = 0.211324865405187; // (3 - sqrt(3)) / 6
const C_Y = 0.366025403784439; // (sqrt(3) - 1) / 2
const C_Z = -0.577350269189626; // -1 + 2 * C_X
const C_W = 0.024390243902439; // 1 / 41

function mod289(x: number): number {
  return x - Math.floor(x * (1 / 289)) * 289;
}

function permute(x: number): number {
  return mod289((x * 34 + 1) * x);
}

export function snoise(vx: number, vy: number): number {
  // Skew the input space to determine which simplex cell we're in.
  const s = (vx + vy) * C_Y;
  const ix = Math.floor(vx + s);
  const iy = Math.floor(vy + s);

  const t = (ix + iy) * C_X;
  const x0x = vx - ix + t;
  const x0y = vy - iy + t;

  // Which of the two triangles in the cell?
  const i1x = x0x > x0y ? 1 : 0;
  const i1y = x0x > x0y ? 0 : 1;

  const x1x = x0x + C_X - i1x;
  const x1y = x0y + C_X - i1y;
  const x2x = x0x + C_Z;
  const x2y = x0y + C_Z;

  const mi = mod289(ix);
  const mj = mod289(iy);

  const p0 = permute(permute(mj) + mi);
  const p1 = permute(permute(mj + i1y) + mi + i1x);
  const p2 = permute(permute(mj + 1) + mi + 1);

  let m0 = 0.5 - (x0x * x0x + x0y * x0y);
  let m1 = 0.5 - (x1x * x1x + x1y * x1y);
  let m2 = 0.5 - (x2x * x2x + x2y * x2y);
  m0 = m0 < 0 ? 0 : m0 * m0 * m0 * m0;
  m1 = m1 < 0 ? 0 : m1 * m1 * m1 * m1;
  m2 = m2 < 0 ? 0 : m2 * m2 * m2 * m2;

  // Gradients: 41 points uniformly over a line, mapped onto a diamond.
  const g = (p: number, xx: number, xy: number) => {
    const x = 2 * (p * C_W - Math.floor(p * C_W)) - 1;
    const h = Math.abs(x) - 0.5;
    const ox = Math.floor(x + 0.5);
    const a0 = x - ox;
    // Normalise gradients implicitly by scaling m.
    const norm = 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    return { v: a0 * xx + h * xy, norm };
  };

  const g0 = g(p0, x0x, x0y);
  const g1 = g(p1, x1x, x1y);
  const g2 = g(p2, x2x, x2y);

  return (
    130 *
    (m0 * g0.norm * g0.v + m1 * g1.norm * g1.v + m2 * g2.norm * g2.v)
  );
}

/** The same function in GLSL. Injected into the terrain vertex shader. */
export const GLSL_NOISE = /* glsl */ `
vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permutev3(vec3 x) { return mod289v3(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289v2(i);
  vec3 p = permutev3(permutev3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
`;
