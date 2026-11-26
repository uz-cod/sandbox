// Bakes data/osm/extract.json (see fetch-osm.mjs) into the compact data embedded in the page:
//   src/generated/osm.bin   deflate-raw: way counts | classes | flags | trail points | route points
//   src/generated/osm.json  quantisation, routes touching the summits, huts, crosses
// Data © OpenStreetMap contributors, ODbL 1.0.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readGeoTiff } from './tiff.mjs';
import { toXZ } from './geo.mjs';
import { PEAKS, CROP } from '../src/peaks.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXTRACT = join(ROOT, 'data/osm/extract.json');
const DEM_FILE = join(ROOT, 'data/raw/Copernicus_DSM_COG_10_N45_00_E009_00_DEM.tif');
const OUT_DIR = join(ROOT, 'src/generated');

const HALF = CROP.extent / 2;
const Q0 = -HALF - 2000, QS = (CROP.extent + 4000) / 65535;     // ~0.44 m quantisation
const CLASSES = ['path', 'footway', 'track', 'steps', 'bridleway', 'via_ferrata'];
const SAC = { hiking: 1, mountain_hiking: 2, demanding_mountain_hiking: 3, alpine_hiking: 4, demanding_alpine_hiking: 5, difficult_alpine_hiking: 6 };
const MIN_TRAIL_ELE = 330;       // drop urban footways in the valley (city detail is out of scope)
const MIN_HUT_ELE = 600;

const inCrop = (x, z, m = 0) => Math.abs(x) <= HALF + m && Math.abs(z) <= HALF + m;

// Douglas-Peucker on [x0,z0,x1,z1,...]
function simplify(pts, tol) {
  const n = pts.length / 2;
  if (n <= 2) return pts;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[2 * a], az = pts[2 * a + 1], bx = pts[2 * b], bz = pts[2 * b + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[2 * i] - ax, pz = pts[2 * i + 1] - az;
      const t = Math.max(0, Math.min(1, (px * dx + pz * dz) / L2));
      const d = Math.hypot(px - dx * t, pz - dz * t);
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

// Minimum-area oriented rectangle of a polygon (convex hull + edge directions).
function orientedRect(pts) {
  const p = [];
  for (let i = 0; i < pts.length; i += 2) p.push([pts[i], pts[i + 1]]);
  p.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  const hull = lo.slice(0, -1).concat(up.slice(0, -1));
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(ang), s = Math.sin(ang);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const q of hull) {
      const u = q[0] * c + q[1] * s, v = -q[0] * s + q[1] * c;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
      best = { area, cx: cu * c - cv * s, cz: cu * s + cv * c, hu: (maxU - minU) / 2, hv: (maxV - minV) / 2, ang };
    }
  }
  // long axis first
  if (best.hv > best.hu) { [best.hu, best.hv] = [best.hv, best.hu]; best.ang += Math.PI / 2; }
  return best;
}

export function bakeOsm({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const ex = JSON.parse(readFileSync(EXTRACT, 'utf8'));
  const dem = readGeoTiff(DEM_FILE);
  const demAt = (x, z) => {
    const lat = CROP.lat - z / (toXZ(CROP.lat + 1, CROP.lon)[1] * -1), lon = CROP.lon + x / toXZ(CROP.lat, CROP.lon + 1)[0];
    const px = Math.round((lon - dem.lon0) / dem.dLon), py = Math.round((dem.lat0 - lat) / dem.dLat);
    return dem.data[Math.min(dem.height - 1, Math.max(0, py)) * dem.width + Math.min(dem.width - 1, Math.max(0, px))];
  };
  const project = (c) => { const o = []; for (let i = 0; i < c.length; i += 2) o.push(...toXZ(c[i] / 1e6, c[i + 1] / 1e6)); return o; };

  // --- trails
  const routeWayIds = new Set(ex.routes.flatMap((r) => r.ways));
  const wayGeom = new Map();
  const ways = [];
  let rawPts = 0;
  for (const w of ex.ways) {
    const cls = CLASSES.indexOf(w.tags.highway);
    const pts = project(w.c);
    wayGeom.set(w.id, pts);
    let inside = false, maxEle = -1e9;
    for (let i = 0; i < pts.length; i += 2) {
      if (inCrop(pts[i], pts[i + 1])) { inside = true; maxEle = Math.max(maxEle, demAt(pts[i], pts[i + 1])); }
    }
    const onRoute = routeWayIds.has(w.id);
    if (!inside || (!onRoute && maxEle < MIN_TRAIL_ELE)) continue;
    rawPts += pts.length / 2;
    const s = simplify(pts, 1.0);
    const sac = SAC[w.tags.sac_scale] || 0;
    const badVis = /bad|horrible|no/.test(w.tags.trail_visibility || '') ? 1 : 0;
    ways.push({ cls, flags: sac | (onRoute ? 8 : 0) | (badVis << 4), pts: s });
  }
  const trailPts = ways.reduce((s, w) => s + w.pts.length / 2, 0);

  // --- routes touching the summits: chain member ways into continuous polylines
  const summits = PEAKS.map((p) => ({ id: p.id, xz: toXZ(p.lat, p.lon) }));
  const routes = [];
  const routePts = [];
  for (const r of ex.routes) {
    const pieces = r.ways.map((id) => wayGeom.get(id)).filter(Boolean).map((p) => p.slice());
    if (!pieces.length) continue;
    const first = pieces[0];
    const f0 = [first[0], first[1]], f1 = [first[first.length - 2], first[first.length - 1]];
    const used = new Uint8Array(pieces.length);
    const chains = [];
    const near = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz) < 3;
    for (let s0 = 0; s0 < pieces.length; s0++) {
      if (used[s0]) continue;
      used[s0] = 1;
      let chain = pieces[s0];
      for (let grew = true; grew;) {
        grew = false;
        for (let k = 0; k < pieces.length; k++) {
          if (used[k]) continue;
          const p = pieces[k], n = p.length;
          const ex0 = chain[chain.length - 2], ez0 = chain[chain.length - 1], sx0 = chain[0], sz0 = chain[1];
          const rev = (a) => { const o = []; for (let i = a.length - 2; i >= 0; i -= 2) o.push(a[i], a[i + 1]); return o; };
          if (near(ex0, ez0, p[0], p[1])) chain = chain.concat(p.slice(2));
          else if (near(ex0, ez0, p[n - 2], p[n - 1])) chain = chain.concat(rev(p).slice(2));
          else if (near(sx0, sz0, p[n - 2], p[n - 1])) chain = p.slice(0, -2).concat(chain);
          else if (near(sx0, sz0, p[0], p[1])) chain = rev(p).slice(0, -2).concat(chain);
          else continue;
          used[k] = 1; grew = true;
        }
      }
      chains.push(chain);
    }
    for (const chain of chains) {
      const dEnd = (x, z) => Math.min(Math.hypot(x - f0[0], z - f0[1]), Math.hypot(x - f1[0], z - f1[1]));
      const fromAtStart = dEnd(chain[0], chain[1]) <= dEnd(chain[chain.length - 2], chain[chain.length - 1]);
      const s = simplify(chain, 0.5);
      let len = 0;
      for (let i = 2; i < s.length; i += 2) len += Math.hypot(s[i] - s[i - 2], s[i + 1] - s[i - 1]);
      if (len < 300) continue;
      const touches = [];
      for (const sm of summits) {
        let best = 1e9, bi = 0;
        for (let i = 0; i < s.length; i += 2) {
          const d = Math.hypot(s[i] - sm.xz[0], s[i + 1] - sm.xz[1]);
          if (d < best) { best = d; bi = i / 2; }
        }
        if (best < 400) touches.push({ peak: sm.id, index: bi, dist: Math.round(best) });
      }
      if (!touches.length) continue;
      routes.push({ id: r.id, ref: r.ref, name: r.name, osmc: r.osmc, operator: r.operator, offset: routePts.length / 2, count: s.length / 2, length: Math.round(len), touches,
        from: r.from, to: r.to, cai: r.cai, durF: r.durF, durB: r.durB, fromAtStart, wayIds: r.ways });
      routePts.push(...s);
    }
  }

  // --- huts / bivouacs (real ones only: alpine_hut, wilderness_hut, shelter huts) >= 600 m
  const huts = [];
  for (const h of ex.huts) {
    const [cx0, cz0] = toXZ(h.lat / 1e6, h.lon / 1e6);
    if (!inCrop(cx0, cz0)) continue;
    const ele = demAt(cx0, cz0);
    if (ele < MIN_HUT_ELE) continue;
    const isShelter = h.kind === 'shelter' || h.kind === 'wilderness_hut' || /^bivacco/i.test(h.name);
    const isHut = h.kind === 'alpine_hut' || /^(rifugio|capanna)/i.test(h.name);
    if (!isShelter && !isHut) continue;
    let rect;
    if (h.poly && h.poly.length >= 8) rect = orientedRect(project(h.poly));
    else {
      // no footprint: typical size, long side along the contour
      const g = [demAt(cx0 + 15, cz0) - demAt(cx0 - 15, cz0), demAt(cx0, cz0 + 15) - demAt(cx0, cz0 - 15)];
      const size = isHut ? [7, 4.5] : h.shelter === 'weather_shelter' ? [2, 1.5] : [2.5, 1.8];
      rect = { cx: cx0, cz: cz0, hu: size[0], hv: size[1], ang: Math.atan2(g[0], -g[1]) };
    }
    const area = 4 * rect.hu * rect.hv;
    const small = isShelter && area < 40;
    huts.push({
      id: h.id, name: h.name, type: small ? 'bivouac' : 'hut',
      x: +rect.cx.toFixed(2), z: +rect.cz.toFixed(2), hu: +Math.max(rect.hu, 1).toFixed(2), hv: +Math.max(rect.hv, 0.8).toFixed(2), ang: +rect.ang.toFixed(4),
      levels: h.levels || (small ? 1 : area > 120 ? 2 : 1), roof: h.roof || '', fromPoly: !!h.poly,
    });
  }

  // --- huts along each route (within 40 m of the polyline): shown as stops in the trail list
  for (const r of routes) {
    r.stops = [];
    for (const h of huts) {
      let best = 1e9, bi = 0;
      for (let i = 0; i < r.count; i++) {
        const k = 2 * (r.offset + i);
        const d = Math.hypot(routePts[k] - h.x, routePts[k + 1] - h.z) - Math.max(h.hu, h.hv);
        if (d < best) { best = d; bi = i; }
      }
      if (best < 40) r.stops.push({ name: h.name || (h.type === 'bivouac' ? 'Bivacco' : 'Rifugio'), index: bi });
    }
  }

  // --- itineraries to each summit: from the far end of every route (trailhead) up to the summit
  const sacOf = new Map(ex.ways.map((w) => [w.id, SAC[w.tags.sac_scale] || 0]));
  const demBil = (x, z) => {
    const lat = CROP.lat - z / -toXZ(CROP.lat + 1, CROP.lon)[1], lon = CROP.lon + x / toXZ(CROP.lat, CROP.lon + 1)[0];
    const px = (lon - dem.lon0) / dem.dLon, py = (dem.lat0 - lat) / dem.dLat;
    const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy, W = dem.width, D = dem.data;
    const s = iy * W + ix;
    return (D[s] * (1 - fx) + D[s + 1] * fx) * (1 - fy) + (D[s + W] * (1 - fx) + D[s + W + 1] * fx) * fy;
  };
  const parseDur = (d) => {
    const m = /^(\d{1,2})[:.h](\d{1,2})/.exec(d || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  };
  const normCai = (c) => (/^(EEA|EE|E|T)/.exec((c || '').toUpperCase().replace(/[^A-Z]/g, '')) || [''])[0];
  const named = [...huts.map((h) => ({ name: h.name, x: h.x, z: h.z })), ...ex.peaks.map((p) => { const [x, z] = toXZ(p.lat / 1e6, p.lon / 1e6); return { name: p.name, x, z }; })].filter((n) => n.name);
  const itineraries = [];
  routes.forEach((r, ri) => {
    const maxSac = Math.max(0, ...r.wayIds.map((id) => sacOf.get(id) || 0));
    const diff = normCai(r.cai) || ['', 'T', 'E', 'EE', 'EEA', 'EEA', 'EEA'][maxSac] || '';
    for (const t of r.touches) {
      if (t.dist > 250) continue;
      for (const end of [0, r.count - 1]) {
        const step = end < t.index ? 1 : -1;
        let len = 0, dplus = 0, lastH = demBil(routePts[2 * (r.offset + end)], routePts[2 * (r.offset + end) + 1]), acc = 0;
        for (let i = end; i !== t.index; i += step) {
          const a = 2 * (r.offset + i), b2 = 2 * (r.offset + i + step);
          const seg = Math.hypot(routePts[b2] - routePts[a], routePts[b2 + 1] - routePts[a + 1]);
          len += seg; acc += seg;
          if (acc >= 25 || i + step === t.index) {           // sample every ~25 m against DEM noise
            const h = demBil(routePts[b2], routePts[b2 + 1]);
            if (h > lastH) dplus += h - lastH;
            lastH = h; acc = 0;
          }
        }
        const sx = routePts[2 * (r.offset + end)], sz = routePts[2 * (r.offset + end) + 1];
        const h0 = demBil(sx, sz), h1 = demBil(routePts[2 * (r.offset + t.index)], routePts[2 * (r.offset + t.index) + 1]);
        if (len < 300 || h1 - h0 < 120 || !inCrop(sx, sz, -150)) continue;   // trailhead must be inside the scene
        const fromEnd = (end === 0) === r.fromAtStart;
        const est = (() => { const h = len / 4000, v = dplus / 400; return Math.round((Math.max(h, v) + Math.min(h, v) / 2) * 60); })();
        const fullDur = Math.max(parseDur(r.durF), parseDur(r.durB));
        const fragment = fullDur > est * 3 + 30;           // only a piece of a much longer route lies in the scene
        if (fragment) continue;                            // the cut end of a route piece is not a real trailhead
        let name = (fragment ? '' : (fromEnd ? r.from : r.to)) || '';
        if (!name) {
          let best = 400, bn = '';
          for (const nm of named) { const d = Math.hypot(nm.x - sx, nm.z - sz); if (d < best) { best = d; bn = nm.name; } }
          name = bn || `quota ${Math.round(h0)} m`;
        }
        const connector = /^(innesto|incrocio|bivio|sentiero\s|percorso\s)/i.test(name);
        // time: OSM duration in the ascent direction, else CAI-style estimate (4 km/h, 400 m/h)
        let minutes = fragment ? 0 : parseDur(fromEnd ? r.durF : r.durB);
        const timeSrc = minutes ? 'osm' : 'stima';
        if (!minutes || minutes < est * 0.4 || minutes > est * 3) minutes = est;
        itineraries.push({ route: ri, peak: t.peak, ref: r.ref, name: r.name, start: r.offset + end, end: r.offset + t.index,
          trailhead: name, connector, diff, length: Math.round(len), dplus: Math.round(dplus), minutes, timeSrc, x: sx, z: sz, ele: Math.round(h0) });
      }
    }
  });
  // trailheads: same peak, same name (or within 80 m) -> one marker
  const trailheads = [];
  for (const it of itineraries) {
    let th = trailheads.find((t) => t.peak === it.peak && ((t.name === it.trailhead && Math.hypot(t.x - it.x, t.z - it.z) < 400) || Math.hypot(t.x - it.x, t.z - it.z) < 80));
    if (!th) { th = { id: trailheads.length, peak: it.peak, name: it.trailhead, x: +it.x.toFixed(1), z: +it.z.toFixed(1), ele: it.ele, connector: it.connector }; trailheads.push(th); }
    th.connector = th.connector && it.connector;
    it.th = th.id;
    delete it.x; delete it.z;
  }
  for (const r of routes) delete r.wayIds;

  // --- crosses >= 600 m
  const crosses = [];
  for (const c of ex.crosses) {
    const [x, z] = toXZ(c.lat / 1e6, c.lon / 1e6);
    if (!inCrop(x, z) || demAt(x, z) < MIN_HUT_ELE) continue;
    crosses.push({ id: c.id, name: c.name, summit: c.summit, material: c.material, structure: c.structure, x: +x.toFixed(2), z: +z.toFixed(2) });
  }

  // --- binary payload: way counts (u16) | classes (u8) | flags (u8) | points: delta-coded u16 x plane, z plane
  const nW = ways.length, nT = trailPts, nR = routePts.length / 2;
  const buf = new ArrayBuffer(nW * 4 + (nT + nR) * 4);
  const counts = new Uint16Array(buf, 0, nW);
  const cls = new Uint8Array(buf, nW * 2, nW);
  const flags = new Uint8Array(buf, nW * 3, nW);
  const px = new Uint16Array(buf, nW * 4, nT + nR);
  const pz = new Uint16Array(buf, nW * 4 + (nT + nR) * 2, nT + nR);
  const q = (v) => Math.max(0, Math.min(65535, Math.round((v - Q0) / QS)));
  let k = 0, prevX = 0, prevZ = 0;
  const put = (x, z) => { const qx = q(x), qz = q(z); px[k] = (qx - prevX) & 0xffff; pz[k] = (qz - prevZ) & 0xffff; prevX = qx; prevZ = qz; k++; };
  ways.forEach((w, i) => { counts[i] = w.pts.length / 2; cls[i] = w.cls; flags[i] = w.flags; for (let j = 0; j < w.pts.length; j += 2) put(w.pts[j], w.pts[j + 1]); });
  for (let j = 0; j < routePts.length; j += 2) put(routePts[j], routePts[j + 1]);
  const bin = deflateRawSync(new Uint8Array(buf), { level: 9 });

  const meta = {
    quant: { origin: Q0, scale: QS }, ways: nW, trailPoints: nT, routePoints: nR, classes: CLASSES,
    routes, huts, crosses, itineraries, trailheads, timestamp: ex.timestamp,
    attribution: 'Sentieri, rifugi e croci © OpenStreetMap contributors (ODbL)',
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'osm.bin'), bin);
  writeFileSync(join(OUT_DIR, 'osm.json'), JSON.stringify(meta));
  const byPeak = {};
  for (const r of routes) for (const t of r.touches) (byPeak[t.peak] ||= []).push(r.ref || r.name);
  log(`trails: ${nW} ways, ${rawPts} -> ${nT} points; routes at summits: ${routes.length} (${nR} points)`);
  for (const p of PEAKS) log(`  ${p.name.padEnd(24)} ${(byPeak[p.id] || []).join(', ') || '-'}`);
  for (const p of PEAKS) {
    const its = itineraries.filter((i) => i.peak === p.id);
    log(`  ↑ ${p.name.padEnd(22)} ${its.length} itinerari, partenze: ${[...new Set(its.filter((i) => !i.connector).map((i) => i.trailhead))].join(' · ') || '-'}`);
  }
  log(`huts/bivouacs >= ${MIN_HUT_ELE} m: ${huts.length} (${huts.filter((h) => h.type === 'bivouac').length} bivouacs, ${huts.filter((h) => h.fromPoly).length} with footprint); crosses: ${crosses.length}`);
  log(`osm.bin ${(bin.length / 1024).toFixed(0)} KB`);
  return meta;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) bakeOsm();
