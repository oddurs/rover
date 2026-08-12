/**
 * Prove the LUT pipeline is neutral.
 *
 * Bakes an identity cube, lays it out exactly as the uploader does, then
 * reproduces the shader's lookup in JS. If the tiling, the slice blend or the
 * half-texel offsets are wrong, an identity LUT will not come back as identity
 * — which is the one case where the answer is known.
 */
const SIZE = 33;

// Bake identity, red fastest.
const data = [];
for (let b = 0; b < SIZE; b++)
  for (let g = 0; g < SIZE; g++)
    for (let r = 0; r < SIZE; r++)
      data.push(r / (SIZE - 1), g / (SIZE - 1), b / (SIZE - 1));

// Lay out as the uploader does.
const W = SIZE * SIZE, H = SIZE;
const tex = new Float32Array(W * H * 3);
for (let b = 0; b < SIZE; b++)
  for (let g = 0; g < SIZE; g++)
    for (let r = 0; r < SIZE; r++) {
      const src = ((b * SIZE + g) * SIZE + r) * 3;
      const x = b * SIZE + r;
      const dst = (g * W + x) * 3;
      tex[dst] = data[src]; tex[dst+1] = data[src+1]; tex[dst+2] = data[src+2];
    }

// Bilinear fetch, matching GL's LinearFilter on a texture of W x H.
function sample(u, v) {
  const x = u * W - 0.5, y = v * H - 0.5;
  const x0 = Math.max(0, Math.min(W - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(H - 1, Math.floor(y)));
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const fx = x - Math.floor(x), fy = y - Math.floor(y);
  const at = (xx, yy, c) => tex[(yy * W + xx) * 3 + c];
  const out = [];
  for (let c = 0; c < 3; c++) {
    const a = at(x0, y0, c) + (at(x1, y0, c) - at(x0, y0, c)) * fx;
    const bb = at(x0, y1, c) + (at(x1, y1, c) - at(x0, y1, c)) * fx;
    out.push(a + (bb - a) * fy);
  }
  return out;
}

// The shader's lookup.
function lutSlice(slice, c, n) {
  const u = (slice * n + c[0] * (n - 1) + 0.5) / (n * n);
  const v = (c[1] * (n - 1) + 0.5) / n;
  return sample(u, v);
}
function applyLut(c, n) {
  const bz = c[2] * (n - 1);
  const z0 = Math.floor(bz), z1 = Math.min(z0 + 1, n - 1), f = bz - z0;
  const a = lutSlice(z0, c, n), b = lutSlice(z1, c, n);
  return [0,1,2].map(i => a[i] + (b[i] - a[i]) * f);
}

let worst = 0, worstAt = null;
for (let i = 0; i <= 12; i++)
  for (let j = 0; j <= 12; j++)
    for (let k = 0; k <= 12; k++) {
      const c = [i/12, j/12, k/12];
      const o = applyLut(c, SIZE);
      for (let ch = 0; ch < 3; ch++) {
        const e = Math.abs(o[ch] - c[ch]);
        if (e > worst) { worst = e; worstAt = c; }
      }
    }
console.log(`identity round-trip, worst error: ${worst.toExponential(2)} at ${worstAt}`);
console.log(worst < 1e-4 ? "PASS - lookup is neutral" : "FAIL - lookup distorts colour");
