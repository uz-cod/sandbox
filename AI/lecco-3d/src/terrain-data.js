// Decodes the embedded heightfield (see tools/bake-dem.mjs) and provides CPU-side height
// queries for the camera ground clamp (allocation-free).
import meta from './generated/terrain.json';
import blob from './generated/terrain.bin';

export { meta };

export async function loadTerrain() {
  const stream = new Blob([blob]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const payload = new Uint8Array(await new Response(stream).arrayBuffer());
  const N = meta.samples, NN = N * N;
  const heights = new Float32Array(NN);
  const water = new Uint8Array(NN * 2); // rg8: water fraction, shore distance
  const q = new Uint16Array(NN);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const s = j * N + i;
      const a = i > 0 ? q[s - 1] : 0, b = j > 0 ? q[s - N] : 0, c = i > 0 && j > 0 ? q[s - N - 1] : 0;
      const r = (payload[s] << 8) | payload[NN + s];
      const v = (r + ((a + b - c) & 0xffff)) & 0xffff;
      q[s] = v;
      heights[s] = meta.hMin + v * meta.hScale;
      water[s * 2] = payload[2 * NN + s];
      water[s * 2 + 1] = payload[3 * NN + s];
    }
  }
  terrain.heights = heights;
  return { heights, water };
}

export const terrain = { heights: null };

// Must match fallbackHeight() in shaders/common.wgsl.
function fallbackHeight(x, z) {
  const a = Math.sin(x * 0.00031 + 1.3) * Math.sin(z * 0.00037 + 0.7);
  const b = Math.sin(x * 0.00071 + z * 0.00053 + 2.1);
  const c = Math.sin(x * -0.00113 + z * 0.00131 + 0.4);
  return 420 + 260 * a + 120 * b + 60 * c;
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Bilinear terrain height (mirror + fallback beyond the crop, as in the shader).
export function groundHeight(x, z) {
  const H = terrain.heights;
  const N = meta.samples, maxg = N - 1;
  let gx = (x - meta.origin[0]) / meta.spacing, gz = (z - meta.origin[1]) / meta.spacing;
  const ox = Math.max(-gx, gx - maxg, 0), oz = Math.max(-gz, gz - maxg, 0);
  const d = Math.hypot(ox, oz) * meta.spacing;
  if (gx < 0) gx = -gx; if (gx > maxg) gx = 2 * maxg - gx;
  if (gz < 0) gz = -gz; if (gz > maxg) gz = 2 * maxg - gz;
  gx = Math.min(maxg - 1e-3, Math.max(0, gx)); gz = Math.min(maxg - 1e-3, Math.max(0, gz));
  const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
  const s = iz * N + ix;
  const h = (H[s] * (1 - fx) + H[s + 1] * fx) * (1 - fz) + (H[s + N] * (1 - fx) + H[s + N + 1] * fx) * fz;
  const t = smoothstep(300, 5000, d);
  return t > 0 ? h + (fallbackHeight(x, z) - h) * t : h;
}

// Catmull-Rom height, identical to heightAt() in common.wgsl inside the crop (used where
// the eye is close to the ground: trail following, building bases). Allocation-free.
function cr(t, p0, p1, p2, p3) {
  const t2 = t * t, t3 = t2 * t;
  return (-0.5 * t3 + t2 - 0.5 * t) * p0 + (1.5 * t3 - 2.5 * t2 + 1) * p1 + (-1.5 * t3 + 2 * t2 + 0.5 * t) * p2 + (0.5 * t3 - 0.5 * t2) * p3;
}
export function groundHeightCubic(x, z) {
  const H = terrain.heights, N = meta.samples, maxg = N - 1;
  const gx = (x - meta.origin[0]) / meta.spacing, gz = (z - meta.origin[1]) / meta.spacing;
  if (gx < 1 || gz < 1 || gx > maxg - 2 || gz > maxg - 2) return groundHeight(x, z);
  const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
  let s = (iz - 1) * N + ix - 1;
  const r0 = cr(fx, H[s], H[s + 1], H[s + 2], H[s + 3]); s += N;
  const r1 = cr(fx, H[s], H[s + 1], H[s + 2], H[s + 3]); s += N;
  const r2 = cr(fx, H[s], H[s + 1], H[s + 2], H[s + 3]); s += N;
  const r3 = cr(fx, H[s], H[s + 1], H[s + 2], H[s + 3]);
  return cr(fz, r0, r1, r2, r3);
}

export function toLatLon(x, z, out) {
  out[0] = meta.crop.lat - z / meta.metresPerDegree.lat;
  out[1] = meta.crop.lon + x / meta.metresPerDegree.lon;
  return out;
}
