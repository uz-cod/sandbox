// OpenStreetMap layer: decodes the baked trails/routes/huts/crosses (tools/bake-osm.mjs) and
// builds, once at startup, everything the GPU needs:
//  - segment buffer (trail centrelines) + per-segment attributes
//  - "pads" (building/cross footprints that flatten the terrain), stored after the segments
//  - a uniform cell grid over the crop listing segments/pads per cell (fragment/vertex lookup)
//  - a static triangle mesh for huts, bivouacs and crosses
// Data © OpenStreetMap contributors, ODbL 1.0.
import osmMeta from './generated/osm.json';
import osmBlob from './generated/osm.bin';
import { meta, groundHeightCubic } from './terrain-data.js';

export { osmMeta };

export const GRID_CELL = 40;          // m
const PAD_FLAG = 0x80000000;
// half widths (m) by class: path, footway, track, steps, bridleway, via_ferrata (not painted)
const HALF_WIDTH = [0.45, 0.7, 1.35, 0.7, 0.75, 0];
const BORDER = 1.6;                   // worn-grass band beyond the trail edge (m)
const HL_MARGIN = 40;                 // highlighted itineraries are drawn a few pixels wide, even far away
export const HL_FLAG = 1 << 8;
export const DIFFS = ['', 'T', 'E', 'EE', 'EEA'];
export const DIFF_COLORS = [[0.75, 0.75, 0.75], [0.30, 0.80, 0.40], [1.0, 0.72, 0.15], [0.95, 0.27, 0.20], [0.70, 0.40, 1.0]];
import { PEAKS, PLACES } from './peaks.js';

export async function loadOsm() {
  const stream = new Blob([osmBlob]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  const nW = osmMeta.ways, nT = osmMeta.trailPoints, nR = osmMeta.routePoints;
  const counts = new Uint16Array(buf, 0, nW);
  const cls = new Uint8Array(buf, nW * 2, nW);
  const flags = new Uint8Array(buf, nW * 3, nW);
  const qx = new Uint16Array(buf, nW * 4, nT + nR);
  const qz = new Uint16Array(buf, nW * 4 + (nT + nR) * 2, nT + nR);
  const pts = new Float32Array((nT + nR) * 2);
  const { origin: Q0, scale: QS } = osmMeta.quant;
  let ax = 0, az = 0;
  for (let i = 0; i < nT + nR; i++) {
    ax = (ax + qx[i]) & 0xffff; az = (az + qz[i]) & 0xffff;
    pts[2 * i] = Q0 + ax * QS; pts[2 * i + 1] = Q0 + az * QS;
  }
  const routePts = pts.subarray(nT * 2);

  // ---------------------------------------------------------------- segments
  let nSeg = 0;
  for (let w = 0; w < nW; w++) if (HALF_WIDTH[cls[w]] > 0) nSeg += counts[w] - 1;
  const huts = osmMeta.huts, crosses = osmMeta.crosses;
  const its = osmMeta.itineraries;
  const pits = osmMeta.placeItineraries || [];
  // de-duplicate hub itineraries (same route ref and destination)
  for (let i = pits.length - 1; i > 0; i--) if (pits.slice(0, i).some((q) => q.place === pits[i].place && q.ref === pits[i].ref && q.dest === pits[i].dest)) pits.splice(i, 1);
  const nTrailSeg = nSeg;
  for (const it of [...its, ...pits]) nSeg += Math.abs(it.end - it.start);
  const nPads = huts.length + crosses.length;
  const segs = new Float32Array((nSeg + 2 * nPads) * 4);
  const attr = new Uint32Array(Math.max(1, nSeg));
  const half = new Float32Array(nSeg);
  let s = 0, p = 0;
  for (let w = 0; w < nW; w++) {
    const c = cls[w], f = flags[w], n = counts[w];
    let hw = HALF_WIDTH[c];
    if (hw > 0) {
      const sac = f & 7;
      if (c === 0 && sac >= 3) hw *= 0.7;              // demanding mountain trails are narrow
      if (f & 8) hw *= 1.25;                            // marked routes: more worn
      if (f & 16) hw *= 0.6;                            // poor visibility
      for (let i = 0; i < n - 1; i++) {
        const a = p + i, b = p + i + 1;
        segs.set([pts[2 * a], pts[2 * a + 1], pts[2 * b], pts[2 * b + 1]], s * 4);
        attr[s] = c | (sac << 4) | ((f & 8) << 4) | (Math.round(hw * 1000) << 16);
        half[s] = hw;
        s++;
      }
    }
    p += n;
  }
  // itinerary segments: flagged, carry difficulty and the bit of their summit
  // selection owner id (attr bits 16..23): summits 1..127, trail hubs 128..255; 0 = nothing selected.
  // Itinerary segments are duplicated per owner, so an id (not a bit mask) is enough.
  const peakBit = (id) => { const k = PEAKS.findIndex((pk) => pk.id === id); return k >= 0 ? 1 + k : 128 + PLACES.findIndex((pl) => pl.id === id); };
  for (const it of [...its, ...pits]) {
    const dir = it.end > it.start ? 1 : -1;
    const d = Math.max(0, DIFFS.indexOf(it.diff));
    it.segA = s;                                   // contiguous segment range: lets the shader emphasise one itinerary
    for (let i = it.start; i !== it.end; i += dir) {
      const a = i, b = i + dir;
      segs.set([routePts[2 * a], routePts[2 * a + 1], routePts[2 * b], routePts[2 * b + 1]], s * 4);
      attr[s] = HL_FLAG | (d << 9) | (peakBit(it.peak ?? it.place) << 16);
      half[s] = HL_MARGIN - BORDER - 0.5;
      s++;
    }
    it.segB = s;
  }

  // ---------------------------------------------------------------- pads (huts, crosses)
  const pads = [];
  for (const h of huts) {
    const base = groundHeightCubic(h.x, h.z);
    pads.push({ x: h.x, z: h.z, ang: h.ang, hu: h.hu, hv: h.hv, base, margin: h.type === 'hut' ? 4 : 2.5 });
    h.base = base;
  }
  for (const c of crosses) {
    const base = groundHeightCubic(c.x, c.z);
    pads.push({ x: c.x, z: c.z, ang: 0, hu: 0.6, hv: 0.6, base, margin: 1.5 });
    c.base = base;
  }
  pads.forEach((pd, k) => {
    const o = (nSeg + 2 * k) * 4;
    segs.set([pd.x, pd.z, Math.cos(pd.ang), Math.sin(pd.ang), pd.hu, pd.hv, pd.base, pd.margin], o);
  });

  // ---------------------------------------------------------------- grid (two-pass CSR)
  const gx0 = meta.origin[0], gz0 = meta.origin[1];
  const dim = Math.ceil(meta.extent / GRID_CELL);
  const cellCount = dim * dim;
  const cnt = new Uint32Array(cellCount);
  const forEachCell = (minx, minz, maxx, maxz, fn) => {
    const i0 = Math.max(0, Math.floor((minx - gx0) / GRID_CELL)), i1 = Math.min(dim - 1, Math.floor((maxx - gx0) / GRID_CELL));
    const j0 = Math.max(0, Math.floor((minz - gz0) / GRID_CELL)), j1 = Math.min(dim - 1, Math.floor((maxz - gz0) / GRID_CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * dim + i);
  };
  const segBox = (k, fn) => {
    const m = half[k] + BORDER + 0.5;
    const o = k * 4;
    forEachCell(Math.min(segs[o], segs[o + 2]) - m, Math.min(segs[o + 1], segs[o + 3]) - m, Math.max(segs[o], segs[o + 2]) + m, Math.max(segs[o + 1], segs[o + 3]) + m, fn);
  };
  const padBox = (pd, fn) => {
    const r = Math.hypot(pd.hu, pd.hv) + pd.margin + 0.5;
    forEachCell(pd.x - r, pd.z - r, pd.x + r, pd.z + r, fn);
  };
  for (let k = 0; k < nSeg; k++) segBox(k, (c) => cnt[c]++);
  for (const pd of pads) padBox(pd, (c) => cnt[c]++);
  let total = 0;
  for (let c = 0; c < cellCount; c++) total += cnt[c];
  const grid = new Uint32Array(cellCount + 1 + total);
  let off = cellCount + 1;
  for (let c = 0; c < cellCount; c++) { grid[c] = off; off += cnt[c]; }
  grid[cellCount] = off;
  const fill = new Uint32Array(cellCount);
  for (let k = 0; k < nSeg; k++) segBox(k, (c) => { grid[grid[c] + fill[c]++] = k; });
  pads.forEach((pd, k) => padBox(pd, (c) => { grid[grid[c] + fill[c]++] = PAD_FLAG | (nSeg + 2 * k); }));
  let maxPerCell = 0;
  for (let c = 0; c < cellCount; c++) maxPerCell = Math.max(maxPerCell, cnt[c]);

  // ---------------------------------------------------------------- building mesh
  const lines = [];
  const mesh = buildMesh(huts, crosses, osmMeta.bridges || [], osmMeta.aerial || [], lines);
  const lineData = new Float32Array(lines);

  // ---------------------------------------------------------------- itineraries / trailheads per summit
  const ths = osmMeta.trailheads.map((t) => ({ ...t, y: groundHeightCubic(t.x, t.z), its: [] }));
  for (const it of its) {
    it.stops = stopsFor(it, routePts);
    it.h0 = groundHeightCubic(routePts[2 * it.start], routePts[2 * it.start + 1]);
    it.h1 = groundHeightCubic(routePts[2 * it.end], routePts[2 * it.end + 1]);
    ths[it.th].its.push(it);
  }
  const byPeak = new Map();
  for (const t of ths) {
    t.its.sort((a, b) => (a.ref || 'zzz').localeCompare(b.ref || 'zzz', 'it', { numeric: true }));
    if (!byPeak.has(t.peak)) byPeak.set(t.peak, []);
    byPeak.get(t.peak).push(t);
  }
  for (const list of byPeak.values()) list.sort((a, b) => a.connector - b.connector || a.ele - b.ele);
  // trail hubs: their itineraries and destination points
  const places = PLACES.map((pl) => {
    const [x, z] = [(pl.lon - meta.crop.lon) * meta.metresPerDegree.lon, (meta.crop.lat - pl.lat) * meta.metresPerDegree.lat];
    return { ...pl, x, z, y: groundHeightCubic(x, z), its: [] };
  });
  for (const it of pits) {
    it.stops = stopsFor(it, routePts);
    it.h0 = groundHeightCubic(routePts[2 * it.start], routePts[2 * it.start + 1]);
    it.h1 = groundHeightCubic(it.ex, it.ez);
    places.find((p) => p.id === it.place).its.push(it);
  }
  for (const p of places) p.its.sort((a, b) => (a.ref || 'zzz').localeCompare(b.ref || 'zzz', 'it', { numeric: true }) || a.length - b.length);
  // pins: x, y, z, selection bit | r, g, b, kind (0 trailhead, 1 junction / destination)
  const pinList = [];
  for (const t of ths) pinList.push([t.x, t.y, t.z, peakBit(t.peak), ...(t.connector ? [0.7, 0.7, 0.7] : [1.0, 0.45, 0.1]), t.connector ? 1 : 0]);
  for (const p of places) {
    pinList.push([p.x, p.y, p.z, peakBit(p.id), 1.0, 0.45, 0.1, 0]);
    for (const it of p.its) pinList.push([it.ex, it.h1, it.ez, peakBit(p.id), 0.75, 0.75, 0.75, 1]);
  }
  const pins = new Float32Array(pinList.length * 8);
  pinList.forEach((v, k) => pins.set(v, k * 8));

  return {
    segs, attr, grid, gridInfo: [gx0, gz0, GRID_CELL, dim], nSeg, nTrailSeg, nPads, maxPerCell,
    mesh, lineData, routePts, trailheads: ths, byPeak, pins, peakBit, huts, places,
  };
}

// ------------------------------------------------------------------ routes
// huts passed between it.start and it.end, with distance from it.start
function stopsFor(it, routePts) {
  const r = osmMeta.routes[it.route];
  const dir = it.end > it.start ? 1 : -1;
  const out = [];
  for (const st of r.stops || []) {
    const si = r.offset + st.index;
    if ((si - it.start) * dir <= 0 || (it.end - si) * dir < 0) continue;
    let along = 0;
    for (let i = it.start; i !== si; i += dir) along += Math.hypot(routePts[2 * (i + dir)] - routePts[2 * i], routePts[2 * (i + dir) + 1] - routePts[2 * i + 1]);
    out.push({ name: st.name, along });
  }
  return out.sort((a, b) => a.along - b.along);
}

// Same itinerary walked the other way (summit -> trailhead).
export function reversed(it) {
  const total = it.length;
  return { ...it, start: it.end, end: it.start, h0: it.h1, h1: it.h0, stops: it.stops.map((s) => ({ name: s.name, along: total - s.along })).reverse() };
}

// ------------------------------------------------------------------ procedural buildings
// Vertex: position(3) normal(3) uv(2: along-wall metres, height above base) mat(2: id, wall length)
export const MAT = { STONE: 0, PLASTER: 1, ROOF: 2, BIVOUAC: 3, METAL: 4, BASE: 5, ROOF_METAL: 6, WOOD: 7, CONCRETE: 8, ASPHALT: 9, BALLAST: 10 };

function buildMesh(huts, crosses, bridges, aerial, lines) {
  const v = [];
  const push = (x, y, z, nx, ny, nz, u, h, mat, wl) => v.push(x, y, z, nx, ny, nz, u, h, mat, wl);
  const quad = (a, b, c, d, n, uv, mat, wl) => {
    // a,b,c,d counter-clockwise seen from outside; uv: [ua,ha, ub,hb, uc,hc, ud,hd]
    const P = [a, b, c, a, c, d], U = [0, 1, 2, 0, 2, 3];
    for (let i = 0; i < 6; i++) push(P[i][0], P[i][1], P[i][2], n[0], n[1], n[2], uv[U[i] * 2], uv[U[i] * 2 + 1], mat, wl);
  };
  const tri = (a, b, c, n, uv, mat, wl) => {
    push(a[0], a[1], a[2], n[0], n[1], n[2], uv[0], uv[1], mat, wl);
    push(b[0], b[1], b[2], n[0], n[1], n[2], uv[2], uv[3], mat, wl);
    push(c[0], c[1], c[2], n[0], n[1], n[2], uv[4], uv[5], mat, wl);
  };
  const frame = (cx, cz, ang) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    return {
      P: (u, y, w) => [cx + u * c - w * s, y, cz + u * s + w * c],
      N: (nu, ny, nw) => [nu * c - nw * s, ny, nu * s + nw * c],
    };
  };

  // box with walls (no bottom); uv.x along each wall, uv.y height above `ref`
  const box = (F, hu, hw, y0, y1, ref, matWall, matTop) => {
    const sides = [
      [[-hu, -hw], [hu, -hw], [0, 0, -1], 2 * hu],
      [[hu, -hw], [hu, hw], [1, 0, 0], 2 * hw],
      [[hu, hw], [-hu, hw], [0, 0, 1], 2 * hu],
      [[-hu, hw], [-hu, -hw], [-1, 0, 0], 2 * hw],
    ];
    for (const [a, b, n, L] of sides) {
      quad(F.P(a[0], y0, a[1]), F.P(b[0], y0, b[1]), F.P(b[0], y1, b[1]), F.P(a[0], y1, a[1]), F.N(...n), [0, y0 - ref, L, y0 - ref, L, y1 - ref, 0, y1 - ref], matWall, L);
    }
    if (matTop >= 0) quad(F.P(-hu, y1, -hw), F.P(-hu, y1, hw), F.P(hu, y1, hw), F.P(hu, y1, -hw), F.N(0, 1, 0), [0, 0, 0, 0, 0, 0, 0, 0], matTop, 0);
  };

  for (const h of huts) {
    const F = frame(h.x, h.z, h.ang);
    const bivouac = h.type === 'bivouac';
    const wallH = bivouac ? 2.2 : 2.9 * h.levels + 0.4;
    const pitch = bivouac ? 0.75 : 0.47;          // ~43° / ~25°
    const oh = bivouac ? 0.15 : 0.55;
    const base = h.base, y0 = base - 4, y1 = base + wallH;
    const hu = h.hu, hw = h.hv;
    const ridge = y1 + hw * Math.tan(pitch);
    const wallMat = bivouac ? MAT.BIVOUAC : MAT.STONE;
    box(F, hu, hw, y0, y1, base, wallMat, -1);
    // gables
    const gm = bivouac ? MAT.BIVOUAC : MAT.PLASTER;
    tri(F.P(hu, y1, -hw), F.P(hu, y1, hw), F.P(hu, ridge, 0), F.N(1, 0, 0), [0, wallH, 2 * hw, wallH, hw, ridge - base], gm, 2 * hw);
    tri(F.P(-hu, y1, hw), F.P(-hu, y1, -hw), F.P(-hu, ridge, 0), F.N(-1, 0, 0), [0, wallH, 2 * hw, wallH, hw, ridge - base], gm, 2 * hw);
    // roof slopes with overhang
    const ey = y1 - oh * Math.tan(pitch), ew = hw + oh, eu = hu + oh;
    const roofMat = bivouac ? MAT.ROOF_METAL : MAT.ROOF;
    const ny = Math.cos(pitch), nw = Math.sin(pitch);
    quad(F.P(-eu, ey, -ew), F.P(eu, ey, -ew), F.P(eu, ridge, 0), F.P(-eu, ridge, 0), F.N(0, ny, -nw), [0, 0, 2 * eu, 0, 2 * eu, ew, 0, ew], roofMat, 2 * eu);
    quad(F.P(eu, ey, ew), F.P(-eu, ey, ew), F.P(-eu, ridge, 0), F.P(eu, ridge, 0), F.N(0, ny, nw), [0, 0, 2 * eu, 0, 2 * eu, ew, 0, ew], roofMat, 2 * eu);
    if (!bivouac && hu > 3) {
      // chimney
      const C = frame(...F.P(hu * 0.45, 0, hw * 0.35).filter((_, i) => i !== 1), h.ang);
      box(C, 0.35, 0.35, ridge - 1.2, ridge + 0.9, base, MAT.STONE, MAT.ROOF);
    }
  }

  for (const c of crosses) {
    const H = c.summit ? 5.5 : 3.2;
    const ang = ((c.id % 360) * Math.PI) / 180;
    const F = frame(c.x, c.z, ang);
    const b = c.base;
    box(F, 0.5, 0.5, b - 1.0, b + 0.45, b, MAT.BASE, MAT.BASE);
    box(F, 0.11, 0.11, b + 0.45, b + 0.45 + H, b, MAT.METAL, MAT.METAL);
    const ay = b + 0.45 + H * 0.72;
    const A = frame(c.x, c.z, ang);
    box(A, H * 0.27, 0.1, ay - 0.1, ay + 0.1, b, MAT.METAL, MAT.METAL);
  }
  // ---------------------------------------------------------------- bridges
  for (const br of bridges) {
    const p = br.p, n = p.length / 2;
    if (n < 2) continue;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]));
    const L = cum[n - 1];
    const h0 = groundHeightCubic(p[0], p[1]), h1 = groundHeightCubic(p[2 * n - 2], p[2 * n - 1]);
    // spans over water or a gully get a gentle hump; never below ground + clearance
    let depth = 0;
    for (let i = 0; i < n; i++) depth = Math.max(depth, h0 + (h1 - h0) * (cum[i] / L) - groundHeightCubic(p[2 * i], p[2 * i + 1]));
    const lift = Math.min(6, Math.max(0, depth * 0.3));
    const deckAt = (s, x, z) => Math.max(h0 + (h1 - h0) * (s / L) + 0.6 + lift * Math.sin(Math.PI * s / L), groundHeightCubic(x, z) + 1.2);
    const hw = br.w / 2, th = br.k === 1 ? 0.5 : 1.3;
    const top = br.k === 2 ? MAT.BALLAST : br.k === 1 ? MAT.WOOD : MAT.ASPHALT;
    for (let i = 0; i < n - 1; i++) {
      const ax = p[2 * i], az = p[2 * i + 1], bx = p[2 * i + 2], bz = p[2 * i + 3];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
      const nx = (-dz / len) * hw, nz = (dx / len) * hw;
      const ya = deckAt(cum[i], ax, az), yb = deckAt(cum[i + 1], bx, bz);
      const A = (s, y) => [ax + nx * s, y, az + nz * s], B = (s, y) => [bx + nx * s, y, bz + nz * s];
      quad(A(-1, ya), A(1, ya), B(1, yb), B(-1, yb), [0, 1, 0], [0, 0, 0, br.w, len, br.w, len, 0], top, br.w);
      quad(A(1, ya - th), B(1, yb - th), B(1, yb), A(1, ya), [nx / hw, 0, nz / hw], [0, -th, len, -th, len, 0, 0, 0], MAT.CONCRETE, len);
      quad(B(-1, yb - th), A(-1, ya - th), A(-1, ya), B(-1, yb), [-nx / hw, 0, -nz / hw], [0, -th, len, -th, len, 0, 0, 0], MAT.CONCRETE, len);
      quad(A(-1, ya - th), B(-1, yb - th), B(1, yb - th), A(1, ya - th), [0, -1, 0], [0, 0, 0, 0, 0, 0, 0, 0], MAT.CONCRETE, len);
      for (const sgn of [-1, 1]) {                       // parapets
        const s0 = sgn * 0.97, s1 = sgn;
        quad(A(s0, ya + 1.0), A(s1, ya + 1.0), B(s1, yb + 1.0), B(s0, yb + 1.0), [0, 1, 0], [0, 0, 0, 0, 0, 0, 0, 0], MAT.CONCRETE, len);
        quad(A(s1, ya), B(s1, yb), B(s1, yb + 1.0), A(s1, ya + 1.0), [(sgn * nx) / hw, 0, (sgn * nz) / hw], [0, 0, len, 0, len, 1, 0, 1], MAT.CONCRETE, len);
        quad(B(s0, yb), A(s0, ya), A(s0, ya + 1.0), B(s0, yb + 1.0), [(-sgn * nx) / hw, 0, (-sgn * nz) / hw], [0, 0, len, 0, len, 1, 0, 1], MAT.CONCRETE, len);
      }
    }
    const spans = Math.max(1, Math.round(L / 35));          // piers every ~35 m, not at the abutments
    for (let k = 1; k < spans; k++) {
      const s = (k / spans) * L;
      let i = 0; while (i < n - 2 && cum[i + 1] < s) i++;
      const t = (s - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i]);
      const x = p[2 * i] + (p[2 * i + 2] - p[2 * i]) * t, z = p[2 * i + 1] + (p[2 * i + 3] - p[2 * i + 1]) * t;
      const y = deckAt(s, x, z) - th, g = groundHeightCubic(x, z);
      if (y - g < 2.5) continue;
      const F = frame(x, z, Math.atan2(p[2 * i + 3] - p[2 * i + 1], p[2 * i + 2] - p[2 * i]));
      box(F, 0.9, hw * 0.55, g - 4, y, g, MAT.CONCRETE, -1);
    }
  }

  // ---------------------------------------------------------------- aerialways: cables (lines), pylons, stations, cabins
  for (const a of aerial) {
    const p = a.p, n = p.length / 2;
    if (n < 2) continue;
    const big = a.k === 'cable_car', goods = a.k === 'goods';
    const hTop = (i) => groundHeightCubic(p[2 * i], p[2 * i + 1]) + (i === 0 || i === n - 1 ? (goods ? 4 : 7) : big ? 28 : goods ? 10 : 12);
    const dx0 = p[2 * n - 2] - p[0], dz0 = p[2 * n - 1] - p[1], l0 = Math.hypot(dx0, dz0) || 1;
    const ox = -dz0 / l0, oz = dx0 / l0;
    const offs = goods || a.k === 'drag_lift' || a.k === 'platter' ? [0] : big ? [-3, 3] : [-2.2, 2.2];
    for (let i = 0; i < n - 1; i++) {
      const ax = p[2 * i], az = p[2 * i + 1], bx = p[2 * i + 2], bz = p[2 * i + 3];
      const ya = hTop(i), yb = hTop(i + 1), span = Math.hypot(bx - ax, bz - az);
      const sag = span * (big ? 0.035 : 0.02);
      const P = (t, o) => [ax + (bx - ax) * t + ox * o, ya + (yb - ya) * t - 4 * sag * t * (1 - t), az + (bz - az) * t + oz * o];
      for (const o of offs) {
        const SUB = 14;
        for (let k = 0; k < SUB; k++) {
          const q0 = P(k / SUB, o), q1 = P((k + 1) / SUB, o);
          lines.push(q0[0], q0[1], q0[2], 0, q1[0], q1[1], q1[2], 0);
        }
      }
      if (big) {                                            // two cabins, one on each cable
        for (const [t, o] of [[0.32, -3], [0.68, 3]]) {
          const q = P(t, o);
          const F = frame(q[0], q[2], Math.atan2(bz - az, bx - ax));
          box(F, 1.6, 1.2, q[1] - 6.2, q[1] - 3.6, q[1] - 6.2, MAT.BIVOUAC, MAT.ROOF_METAL);
          box(F, 0.06, 0.06, q[1] - 3.6, q[1], q[1], MAT.METAL, -1);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const x = p[2 * i], z = p[2 * i + 1], g = groundHeightCubic(x, z), topY = hTop(i);
      const F = frame(x, z, Math.atan2(dz0, dx0));
      if (i === 0 || i === n - 1) {
        if (!goods) box(F, big ? 7 : 4, big ? 5 : 3.5, g - 3, topY + 1, g, MAT.STONE, MAT.ROOF_METAL);
      } else {
        box(F, big ? 0.9 : 0.35, big ? 0.9 : 0.35, g - 2, topY, g, MAT.METAL, -1);
        box(F, 0.25, Math.max(...offs.map(Math.abs)) + 0.6, topY - 0.3, topY, g, MAT.METAL, MAT.METAL);
      }
    }
  }
  return new Float32Array(v);
}
