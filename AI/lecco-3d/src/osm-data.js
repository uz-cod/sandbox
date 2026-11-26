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
  const mesh = buildMesh(huts, crosses);

  // ---------------------------------------------------------------- trail options per summit
  const routeOptions = buildRouteOptions(routePts);

  return {
    segs, attr, grid, gridInfo: [gx0, gz0, GRID_CELL, dim], nSeg, nPads, maxPerCell,
    mesh, routePts, routeOptions,
  };
}

// ------------------------------------------------------------------ routes
function bearingName(dx, dz) {
  const a = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return names[(Math.round(((a + 360) % 360) / 45)) % 8];
}

function buildRouteOptions(routePts) {
  const byPeak = new Map();
  for (const r of osmMeta.routes) {
    for (const t of r.touches) {
      for (const dir of [1, -1]) {
        const startI = r.offset + t.index;
        const endI = dir > 0 ? r.offset + r.count - 1 : r.offset;
        const steps = Math.abs(endI - startI);
        if (steps < 3) continue;
        let len = 0;
        for (let i = startI; i !== endI; i += dir) len += Math.hypot(routePts[2 * (i + dir)] - routePts[2 * i], routePts[2 * (i + dir) + 1] - routePts[2 * i + 1]);
        if (len < 250) continue;
        const sx = routePts[2 * startI], sz = routePts[2 * startI + 1], ex = routePts[2 * endI], ez = routePts[2 * endI + 1];
        const h0 = groundHeightCubic(sx, sz), h1 = groundHeightCubic(ex, ez);
        if (h0 - h1 < 80) continue;               // "from the summit down"
        // huts passed on the way down, with distance from the start
        const stops = [];
        for (const st of r.stops || []) {
          const si = r.offset + st.index;
          if ((si - startI) * dir <= 0) continue;
          let along = 0;
          for (let i = startI; i !== si; i += dir) along += Math.hypot(routePts[2 * (i + dir)] - routePts[2 * i], routePts[2 * (i + dir) + 1] - routePts[2 * i + 1]);
          stops.push({ name: st.name, along });
        }
        stops.sort((a, b) => a.along - b.along);
        const opt = {
          key: `${r.id}:${t.index}:${dir}`, ref: r.ref, name: r.name, osmc: r.osmc,
          start: startI, end: endI, dir, length: len, h0, h1, toward: bearingName(ex - sx, ez - sz), stops,
        };
        if (!byPeak.has(t.peak)) byPeak.set(t.peak, []);
        byPeak.get(t.peak).push(opt);
      }
    }
  }
  for (const list of byPeak.values()) {
    list.sort((a, b) => (a.ref || 'zzz').localeCompare(b.ref || 'zzz', 'it', { numeric: true }) || b.h0 - b.h1 - (a.h0 - a.h1));
    // drop near-duplicates (same ref, same end point within 50 m)
    for (let i = list.length - 1; i > 0; i--) {
      for (let j = 0; j < i; j++) {
        if (list[i].ref === list[j].ref && Math.abs(list[i].h1 - list[j].h1) < 15 && Math.abs(list[i].length - list[j].length) < 150) { list.splice(i, 1); break; }
      }
    }
  }
  return byPeak;
}

// ------------------------------------------------------------------ procedural buildings
// Vertex: position(3) normal(3) uv(2: along-wall metres, height above base) mat(2: id, wall length)
export const MAT = { STONE: 0, PLASTER: 1, ROOF: 2, BIVOUAC: 3, METAL: 4, BASE: 5, ROOF_METAL: 6, WOOD: 7 };

function buildMesh(huts, crosses) {
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
  return new Float32Array(v);
}
