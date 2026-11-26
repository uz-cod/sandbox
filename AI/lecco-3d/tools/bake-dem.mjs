// Bakes the Copernicus GLO-30 DEM (+ WBM water mask) into the compact heightfield
// embedded in the page:
//   src/generated/terrain.bin   deflate-raw( residual hi plane | residual lo plane | water | shore )
//   src/generated/terrain.json  metadata (grid, projection, height range, snapped peaks)
//
// Steps: crop a square around CROP in a local metric (equirectangular) frame, resample the
// DEM with Catmull-Rom, flatten lakes per connected component, quantise to uint16 and encode
// with a planar predictor (a + b - c) so deflate compresses the smooth terrain well.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readGeoTiff } from './tiff.mjs';
import { PEAKS, CROP } from '../src/peaks.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data/raw');
const DEM_FILE = join(RAW, 'Copernicus_DSM_COG_10_N45_00_E009_00_DEM.tif');
const WBM_FILE = join(RAW, 'Copernicus_DSM_COG_10_N45_00_E009_00_WBM.tif');
const OUT_DIR = join(ROOT, 'src/generated');

// Metres per degree at the crop latitude (WGS84 series expansion).
function metresPerDegree(latDeg) {
  const p = (latDeg * Math.PI) / 180;
  return {
    lat: 111132.954 - 559.822 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p),
    lon: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p),
  };
}

function catmull(t, w) {
  const t2 = t * t, t3 = t2 * t;
  w[0] = -0.5 * t3 + t2 - 0.5 * t;
  w[1] = 1.5 * t3 - 2.5 * t2 + 1;
  w[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
  w[3] = 0.5 * t3 - 0.5 * t2;
}

export function bake({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const t0 = Date.now();
  const dem = readGeoTiff(DEM_FILE);
  const wbm = readGeoTiff(WBM_FILE);
  log(`DEM ${dem.width}x${dem.height}, origin ${dem.lat0.toFixed(5)}N ${dem.lon0.toFixed(5)}E, rasterType ${dem.rasterType}`);

  const N = CROP.samples, EXT = CROP.extent, SP = EXT / (N - 1), HALF = EXT / 2;
  const mpd = metresPerDegree(CROP.lat);
  const toLatLon = (x, z) => [CROP.lat - z / mpd.lat, CROP.lon + x / mpd.lon];
  const toXZ = (lat, lon) => [(lon - CROP.lon) * mpd.lon, (CROP.lat - lat) * mpd.lat];

  // --- resample heights (Catmull-Rom in DEM pixel space) ---
  const H = new Float32Array(N * N);
  const wx = new Float64Array(4), wy = new Float64Array(4);
  const demAt = (px, py) => {
    const ix = Math.floor(px), iy = Math.floor(py);
    catmull(px - ix, wx); catmull(py - iy, wy);
    let h = 0;
    for (let j = 0; j < 4; j++) {
      const yy = Math.min(dem.height - 1, Math.max(0, iy - 1 + j));
      let r = 0;
      for (let i = 0; i < 4; i++) {
        const xx = Math.min(dem.width - 1, Math.max(0, ix - 1 + i));
        r += wx[i] * dem.data[yy * dem.width + xx];
      }
      h += wy[j] * r;
    }
    return h;
  };
  const wbmAt = (lat, lon) => {
    const px = Math.round((lon - wbm.lon0) / wbm.dLon), py = Math.round((wbm.lat0 - lat) / wbm.dLat);
    if (px < 0 || py < 0 || px >= wbm.width || py >= wbm.height) return 0;
    return wbm.data[py * wbm.width + px];
  };

  const water = new Uint8Array(N * N); // water fraction 0..255
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * SP, z = -HALF + j * SP;
      const [lat, lon] = toLatLon(x, z);
      const px = (lon - dem.lon0) / dem.dLon, py = (dem.lat0 - lat) / dem.dLat;
      if (px < 1 || py < 1 || px > dem.width - 2 || py > dem.height - 2) throw new Error('crop exceeds DEM tile');
      H[j * N + i] = demAt(px, py);
      // 3x3 supersampled water fraction (WBM classes 1 ocean, 2 lake, 3 river)
      let wsum = 0;
      for (let sj = -1; sj <= 1; sj++) for (let si = -1; si <= 1; si++) {
        const [la, lo] = toLatLon(x + si * SP / 3, z + sj * SP / 3);
        if (wbmAt(la, lo) > 0) wsum++;
      }
      water[j * N + i] = Math.round((wsum / 9) * 255);
    }
  }

  // --- lakes: flatten each connected water component to its median height ---
  const comp = new Int32Array(N * N).fill(-1);
  const levels = [];
  const stack = new Int32Array(N * N);
  for (let s = 0; s < N * N; s++) {
    if (water[s] < 128 || comp[s] >= 0) continue;
    const id = levels.length;
    let sp = 0, cnt = 0;
    stack[sp++] = s; comp[s] = id;
    const hs = [];
    while (sp > 0) {
      const c = stack[--sp]; cnt++; hs.push(H[c]);
      const ci = c % N, cj = (c - ci) / N;
      const nb = [ci > 0 ? c - 1 : -1, ci < N - 1 ? c + 1 : -1, cj > 0 ? c - N : -1, cj < N - 1 ? c + N : -1];
      for (const q of nb) if (q >= 0 && comp[q] < 0 && water[q] >= 128) { comp[q] = id; stack[sp++] = q; }
    }
    hs.sort((a, b) => a - b);
    levels.push({ level: hs[hs.length >> 1], count: cnt });
  }
  for (let s = 0; s < N * N; s++) if (comp[s] >= 0) H[s] = levels[comp[s]].level;
  // keep the shore above the water surface (DSM noise would leave pits)
  for (let pass = 1; pass <= 3; pass++) {
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const s = j * N + i;
      if (comp[s] >= 0) continue;
      let lv = -Infinity;
      for (let dj = -pass; dj <= pass; dj++) for (let di = -pass; di <= pass; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        const c = comp[jj * N + ii];
        if (c >= 0) lv = Math.max(lv, levels[c].level);
      }
      if (lv > -Infinity) H[s] = Math.max(H[s], lv + 0.4 * pass);
    }
  }
  const big = levels.map((l, i) => ({ ...l, i })).filter((l) => l.count > 200).sort((a, b) => b.count - a.count);
  log(`water bodies: ${levels.length} (large: ${big.map((l) => `${l.level.toFixed(1)} m / ${((l.count * SP * SP) / 1e6).toFixed(1)} km²`).join(', ')})`);

  // --- distance from shore inside water (chamfer 3-4, in samples) ---
  const dist = new Float32Array(N * N);
  for (let s = 0; s < N * N; s++) dist[s] = water[s] >= 128 ? 1e9 : 0;
  const relax = (s, q, w) => { if (dist[q] + w < dist[s]) dist[s] = dist[q] + w; };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const s = j * N + i;
    if (i > 0) relax(s, s - 1, 1);
    if (j > 0) { relax(s, s - N, 1); if (i > 0) relax(s, s - N - 1, 1.414); if (i < N - 1) relax(s, s - N + 1, 1.414); }
  }
  for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) {
    const s = j * N + i;
    if (i < N - 1) relax(s, s + 1, 1);
    if (j < N - 1) { relax(s, s + N, 1); if (i < N - 1) relax(s, s + N + 1, 1.414); if (i > 0) relax(s, s + N - 1, 1.414); }
  }
  const shore = new Uint8Array(N * N);
  for (let s = 0; s < N * N; s++) shore[s] = Math.min(255, Math.round(Math.min(dist[s], 1e3) * 6));

  // --- peaks: snap to highest sample within radius ---
  const peaks = PEAKS.map((p) => {
    const [px, pz] = toXZ(p.lat, p.lon);
    const ci = Math.round((px + HALF) / SP), cj = Math.round((pz + HALF) / SP);
    const r = Math.ceil(p.radius / SP);
    let best = -Infinity, bi = ci, bj = cj;
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      if ((i - ci) ** 2 + (j - cj) ** 2 > r * r) continue;
      if (H[j * N + i] > best) { best = H[j * N + i]; bi = i; bj = j; }
    }
    const x = -HALF + bi * SP, z = -HALF + bj * SP;
    const [lx, lz] = toXZ(p.look.lat, p.look.lon);
    const found = ci >= 0 && cj >= 0 && ci < N && cj < N && (p.elev == null || Math.abs(best - p.elev) < 150);
    return { id: p.id, name: p.name, elev: p.elev, x, z, h: best, lookX: lx, lookZ: lz, found };
  });
  for (const p of peaks) log(`  ${p.found ? 'ok ' : 'NO '} ${p.name.padEnd(24)} DEM ${p.h.toFixed(0).padStart(5)} m  official ${p.elev ?? '?'}  at (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`);

  // --- quantise + planar predictor + byte planes ---
  let hMin = Infinity, hMax = -Infinity;
  for (const h of H) { if (h < hMin) hMin = h; if (h > hMax) hMax = h; }
  hMin = Math.floor(hMin) - 1; hMax = Math.ceil(hMax) + 1;
  const scale = (hMax - hMin) / 65535;
  const Q = new Uint16Array(N * N);
  for (let s = 0; s < N * N; s++) Q[s] = Math.round((H[s] - hMin) / scale);
  const payload = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const s = j * N + i;
    const a = i > 0 ? Q[s - 1] : 0, b = j > 0 ? Q[s - N] : 0, c = i > 0 && j > 0 ? Q[s - N - 1] : 0;
    const r = (Q[s] - ((a + b - c) & 0xffff)) & 0xffff;
    payload[s] = r >> 8;
    payload[N * N + s] = r & 255;
  }
  payload.set(water, 2 * N * N);
  payload.set(shore, 3 * N * N);
  const bin = deflateRawSync(payload, { level: 9, memLevel: 9 });

  const meta = {
    samples: N, extent: EXT, spacing: SP, origin: [-HALF, -HALF],
    crop: { lat: CROP.lat, lon: CROP.lon }, metresPerDegree: mpd,
    hMin, hMax, hScale: scale,
    peaks,
    attribution: 'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved',
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'terrain.bin'), bin);
  writeFileSync(join(OUT_DIR, 'terrain.json'), JSON.stringify(meta, null, 1));
  log(`heights ${hMin}..${hMax} m (step ${(scale * 100).toFixed(1)} cm), payload ${(payload.length / 1e6).toFixed(2)} MB -> ${(bin.length / 1e6).toFixed(2)} MB deflated, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return meta;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) bake();
