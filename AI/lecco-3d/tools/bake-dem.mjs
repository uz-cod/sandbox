// Bakes the Copernicus GLO-30 DEM (+ WBM water mask) into the compact heightfield
// embedded in the page:
//   src/generated/terrain.bin   deflate-raw( residual hi plane | residual lo plane | water | shore )
//   src/generated/terrain.json  metadata (grid, projection, height range, snapped peaks)
//
// Steps: crop a square around CROP in a local metric (equirectangular) frame, resample the
// DEM with Catmull-Rom, flatten lakes per connected component, quantise to uint16 and encode
// with a planar predictor (a + b - c) so deflate compresses the smooth terrain well.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readGeoTiff } from './tiff.mjs';
import { PEAKS, CROP } from '../src/peaks.js';
import { metresPerDegree } from './geo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data/raw');
const DEM_FILE = join(RAW, 'Copernicus_DSM_COG_10_N45_00_E009_00_DEM.tif');
const WBM_FILE = join(RAW, 'Copernicus_DSM_COG_10_N45_00_E009_00_WBM.tif');
const OUT_DIR = join(ROOT, 'src/generated');

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

  // --- restore summit pinnacles: 30 m cells average narrow limestone towers with the cols
  // between them (Resegone teeth lose 40-95 m while the cols are within ~20 m). Each OSM peak
  // with an elevation gets a steep cone (~51°) up to its surveyed height; cols stay untouched.
  const EXTRACT = join(ROOT, 'data/osm/extract.json');
  if (existsSync(EXTRACT)) {
    const SLOPE = 1.25;
    const osmPeaks = JSON.parse(readFileSync(EXTRACT, 'utf8')).peaks;
    let fixed = 0, maxFix = 0, maxName = '';
    for (const pk of osmPeaks) {
      if (!pk.ele) continue;
      const [px, pz] = toXZ(pk.lat / 1e6, pk.lon / 1e6);
      const ci = Math.round((px + HALF) / SP), cj = Math.round((pz + HALF) / SP);
      if (ci < 4 || cj < 4 || ci >= N - 4 || cj >= N - 4) continue;
      let m = -Infinity;
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) m = Math.max(m, H[(cj + dj) * N + ci + di]);
      const deficit = pk.ele - m;
      if (deficit < 6 || deficit > 160) continue;               // fine already, or suspicious data
      const R = Math.ceil(deficit / SLOPE / SP) + 1;
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
        const s = (cj + dj) * N + ci + di;
        H[s] = Math.max(H[s], pk.ele - Math.hypot(di, dj) * SP * SLOPE);
      }
      fixed++;
      if (deficit > maxFix) { maxFix = deficit; maxName = pk.name; }
    }
    log(`summits restored from OSM elevations: ${fixed} (largest: ${maxName} +${maxFix.toFixed(0)} m)`);
  }

  // --- built-up mask: density of town footways / steps and restaurants / hotels (OSM),
  // ~400 m kernel, kept to valley floors and lower slopes (stored in the water texture's B)
  const urban = new Uint8Array(N * N);
  let landPlanes = null;
  if (existsSync(EXTRACT)) {
    const ex = JSON.parse(readFileSync(EXTRACT, 'utf8'));
    const den = new Float32Array(N * N);
    const put = (lat, lon, w) => {
      const [x, z] = toXZ(lat, lon);
      const i = Math.round((x + HALF) / SP), j = Math.round((z + HALF) / SP);
      if (i >= 0 && j >= 0 && i < N && j < N) den[j * N + i] += w;
    };
    for (const w of ex.ways) {
      if (w.tags.highway !== 'footway' && w.tags.highway !== 'steps') continue;
      for (let k = 2; k < w.c.length; k += 2) put((w.c[k] + w.c[k - 2]) / 2e6, (w.c[k + 1] + w.c[k - 1]) / 2e6, 1);
    }
    for (const [la, lo] of ex.pois || []) put(la / 1e6, lo / 1e6, 4);
    // separable box blur twice (~ +-8 samples = 200 m each pass)
    const R = 8, tmp = new Float32Array(N * N);
    const blur = (src, dst, horiz) => {
      for (let a2 = 0; a2 < N; a2++) {
        let acc = 0;
        for (let k = -R; k <= R; k++) { const b2 = Math.min(N - 1, Math.max(0, k)); acc += horiz ? src[a2 * N + b2] : src[b2 * N + a2]; }
        for (let b2 = 0; b2 < N; b2++) {
          dst[horiz ? a2 * N + b2 : b2 * N + a2] = acc;
          const add = Math.min(N - 1, b2 + R + 1), rem = Math.max(0, b2 - R);
          acc += (horiz ? src[a2 * N + add] - src[a2 * N + rem] : src[add * N + a2] - src[rem * N + a2]);
        }
      }
    };
    blur(den, tmp, true); blur(tmp, den, false); blur(den, tmp, true); blur(tmp, den, false);
    for (let s = 0; s < N * N; s++) {
      const low = Math.min(1, Math.max(0, (650 - H[s]) / 120));
      urban[s] = Math.round(255 * Math.min(1, Math.max(0, (den[s] - 3) / 25)) * low);
    }
    // real landuse polygons (data/osm/extra.json): residential/commercial/retail -> built-up,
    // industrial/commercial/retail -> large sheds, parks/gardens/pitches/grass -> green
    const EXTRA = join(ROOT, 'data/osm/extra.json');
    if (existsSync(EXTRA)) {
      const ext = JSON.parse(readFileSync(EXTRA, 'utf8'));
      const M = 2 * N;                                   // 2x2 supersampling for coverage
      const fine = { res: new Uint8Array(M * M), ind: new Uint8Array(M * M), green: new Uint8Array(M * M) };
      const toG = (lat, lon) => { const [x, z] = toXZ(lat, lon); return [(x + HALF) / SP * 2, (z + HALF) / SP * 2]; };
      // join member ways into closed rings
      const rings = (ways) => {
        const pieces = ways.map((g) => g.map((p) => toG(p.lat, p.lon)));
        const out = [];
        const used = new Uint8Array(pieces.length);
        const same = (a2, b2) => Math.abs(a2[0] - b2[0]) < 1e-3 && Math.abs(a2[1] - b2[1]) < 1e-3;
        for (let i = 0; i < pieces.length; i++) {
          if (used[i]) continue;
          used[i] = 1;
          let r = pieces[i].slice();
          for (let grew = true; grew && !same(r[0], r[r.length - 1]);) {
            grew = false;
            for (let k = 0; k < pieces.length; k++) {
              if (used[k]) continue;
              const p = pieces[k];
              if (same(r[r.length - 1], p[0])) r = r.concat(p.slice(1));
              else if (same(r[r.length - 1], p[p.length - 1])) r = r.concat(p.slice(0, -1).reverse());
              else continue;
              used[k] = 1; grew = true;
            }
          }
          if (r.length >= 4) out.push(r);
        }
        return out;
      };
      // even-odd scanline fill of a set of rings (holes included)
      const fill = (rs, target) => {
        let y0 = Infinity, y1 = -Infinity;
        for (const r of rs) for (const p of r) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
        const ys = Math.max(0, Math.floor(y0)), ye = Math.min(M - 1, Math.ceil(y1));
        const xs = [];
        for (let y = ys; y <= ye; y++) {
          const cy = y + 0.5;
          xs.length = 0;
          for (const r of rs) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
            const a2 = r[i], b2 = r[j];
            if ((a2[1] > cy) !== (b2[1] > cy)) xs.push(a2[0] + ((cy - a2[1]) / (b2[1] - a2[1])) * (b2[0] - a2[0]));
          }
          xs.sort((p, q) => p - q);
          for (let k = 0; k + 1 < xs.length; k += 2) {
            const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(M - 1, Math.floor(xs[k + 1] - 0.5));
            for (let x = xa; x <= xb; x++) target[y * M + x] = 1;
          }
        }
      };
      let nPoly = 0;
      for (const e of ext.elements) {
        const t = e.tags || {};
        const cls = /^(residential)$/.test(t.landuse) ? 'res' : /^(industrial|commercial|retail)$/.test(t.landuse) ? 'ind'
          : /^(park|garden|pitch)$/.test(t.leisure) || t.landuse === 'grass' ? 'green' : null;
        if (!cls) continue;
        let rs = [];
        if (e.type === 'way' && e.geometry) rs = rings([e.geometry]);
        else if (e.type === 'relation' && e.members) rs = rings(e.members.filter((m) => m.geometry).map((m) => m.geometry));
        if (!rs.length) continue;
        fill(rs, fine[cls]); nPoly++;
        if (t.landuse === 'commercial' || t.landuse === 'retail') fill(rs, fine.res);
      }
      const industry = new Uint8Array(N * N), green = new Uint8Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const f = (a2) => (a2[(2 * j) * M + 2 * i] + a2[(2 * j) * M + 2 * i + 1] + a2[(2 * j + 1) * M + 2 * i] + a2[(2 * j + 1) * M + 2 * i + 1]) / 4;
        const s = j * N + i;
        const res = f(fine.res), ind = f(fine.ind), gr = f(fine.green);
        // polygons lead; the footway/restaurant density only fills unmapped villages (half strength)
        urban[s] = Math.round(255 * Math.min(1, Math.max(res + ind, (urban[s] / 255) * 0.5)) * (1 - gr * 0.9));
        industry[s] = Math.round(255 * ind);
        green[s] = Math.round(255 * gr);
      }
      landPlanes = { industry, green };
      log(`landuse polygons rasterised: ${nPoly}`);
    }
    let cov = 0; for (let s = 0; s < N * N; s++) if (urban[s] > 128) cov++;
    log(`built-up mask: ${((cov * SP * SP) / 1e6).toFixed(1)} km² (from ${(ex.pois || []).length} restaurants/hotels + town footways)`);
  }

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
  const payload = new Uint8Array(N * N * 7);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const s = j * N + i;
    const a = i > 0 ? Q[s - 1] : 0, b = j > 0 ? Q[s - N] : 0, c = i > 0 && j > 0 ? Q[s - N - 1] : 0;
    const r = (Q[s] - ((a + b - c) & 0xffff)) & 0xffff;
    payload[s] = r >> 8;
    payload[N * N + s] = r & 255;
  }
  payload.set(water, 2 * N * N);
  payload.set(shore, 3 * N * N);
  payload.set(urban, 4 * N * N);
  if (landPlanes) { payload.set(landPlanes.industry, 5 * N * N); payload.set(landPlanes.green, 6 * N * N); }
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
