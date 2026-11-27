// Entry point: load data, build the renderer, wire UI and run the frame loop.
import { loadTerrain, meta, groundHeight, groundHeightCubic, toLatLon } from './terrain-data.js';
import { loadOsm, osmMeta, reversed } from './osm-data.js';
import { createRenderer } from './renderer.js';
import { perspectiveReverseZ, viewFromYawPitch, multiply } from './math.js';
import { camera, attachInput, placeCamera, updateCamera, follow, startFollow, stopFollow, auto, startPanorama, startOrbit, stopAuto } from './camera.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const canvas = $('gpu');
const status = $('status');

const opts = {
  precomputeSize: Number(params.get('pre')) || 2048,
  sunAzimuth: Number(params.get('sunaz') ?? 235),
  sunElevation: Number(params.get('sunel') ?? 32),
  exposure: Number(params.get('exp') ?? 0.85),
  snowLine: Number(params.get('snow') ?? 2200),
  relief: Number(params.get('relief') ?? 1),
  debug: Number(params.get('dbg') ?? 0),
  debugLevels: params.has('levels') ? Number(params.get('levels')) : undefined,
  renderScale: Number(params.get('scale')) || Math.min(window.devicePixelRatio || 1, 1.5),
  onProgress: (msg) => { status.textContent = msg; },
  offscreen: params.has('shot'),
  trees: params.get('trees') !== '0',
  // a different sky every load: random cloud field and a coverage between 'a few' and 'half'
  clouds: params.has('clouds') ? Number(params.get('clouds')) : 0.25 + Math.random() * 0.3,
  cloudSeed: params.has('seed') ? [Number(params.get('seed')) * 7919, Number(params.get('seed')) * 3571] : [Math.random() * 50000, Math.random() * 50000],
};
const shotMode = params.has('shot');
if (params.get('hud') === '0') document.body.classList.add('nohud');

const peaks = meta.peaks.filter((p) => p.found);
let osm = null;
let renderer = null;
let activePeak = -1;

function fmtKm(m) { return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`; }

const DIFF_LABEL = { T: 'turistico', E: 'escursionistico', EE: 'per escursionisti esperti', EEA: 'esperti con attrezzatura' };
function fmtTime(min) { return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`; }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Panel: trailheads of the selected summit, each with its itineraries to the top.
function showTrails(i) {
  const box = $('trails');
  box.innerHTML = '';
  const p = peaks[i];
  const ths = (p && osm?.byPeak.get(p.id)) || [];
  const n = ths.reduce((s, t) => s + t.its.length, 0);
  $('trailsHead').innerHTML = n
    ? `Partenze per la vetta <span class="dim">· ${n} itinerari</span> <button id="overview" title="Vista d'insieme (V)">vista d'insieme</button>`
    : 'Nessun itinerario segnato verso la vetta';
  $('overview')?.addEventListener('click', (e) => { e.stopPropagation(); overview(i); });
  for (const t of ths) {
    const row = document.createElement('div');
    row.className = 'th' + (t.connector ? ' junction' : '');
    const head = document.createElement('button');
    head.className = 'thName';
    head.title = 'Vola al punto di partenza';
    head.innerHTML = `<span class="pin"></span><span>${esc(t.name)}</span><span class="e">${Math.round(t.y)} m</span>`;
    head.addEventListener('click', (e) => { e.stopPropagation(); flyToTrailhead(t, p); head.blur(); });
    row.appendChild(head);
    for (const it of t.its) {
      const r = document.createElement('div');
      r.className = 'it';
      r.title = [it.name, it.fullFrom ? `itinerario completo da ${it.fullFrom} (il tratto iniziale su strada non è nei dati)` : '', DIFF_LABEL[it.diff] ? `difficoltà ${it.diff}: ${DIFF_LABEL[it.diff]}` : 'difficoltà non indicata',
        it.timeSrc === 'osm' ? 'tempo da OSM' : 'tempo stimato (4 km/h, 400 m/h)', ...it.stops.map((s) => `${s.name} a ${fmtKm(s.along)}`)].filter(Boolean).join('\n');
      r.innerHTML = `<span class="r">${esc(it.ref || '–')}</span><span class="d d${esc(it.diff || 'x')}">${esc(it.diff || '?')}</span>`
        + `<span class="n">${fmtKm(it.length)} · +${it.dplus} m · ${fmtTime(it.minutes)}${it.timeSrc === 'osm' ? '' : '*'}</span>`;
      r.addEventListener('click', (e) => { e.stopPropagation(); selectItinerary(it, r, t.name, p.name); });
      row.appendChild(r);
    }
    box.appendChild(row);
  }
  buildLabels(ths);
}

// ------------------------------------------------------------------ trail hubs (Erna, ...)
let activePlace = -1;
function selectPlace(k) {
  const pl = osm.places[k];
  endFollow();
  activePeak = -1; activePlace = k;
  clearItinerary();
  document.querySelectorAll('#peaks button').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('#places button').forEach((b, j) => b.classList.toggle('active', j === k));
  renderer.setSelection(osm.peakBit(pl.id));
  // view from above, frame the hub and its nearer destinations
  let r = 700;
  for (const it of pl.its) r = Math.max(r, Math.min(3500, Math.hypot(it.ex - pl.x, it.ez - pl.z) * 0.8));
  const ang = (230 * Math.PI) / 180, dist = r * 1.2;
  const x = pl.x + Math.sin(ang) * dist, z = pl.z - Math.cos(ang) * dist;
  const y = pl.y + r * 0.9;
  placeCamera(x, y, z, Math.atan2(pl.x - x, -(pl.z - z)), Math.atan2(pl.y - y, dist));
  panoramaHint(() => startOrbit(pl.x, pl.z));
  const box = $('trails');
  box.innerHTML = '';
  $('trailsHead').innerHTML = `Sentieri da ${esc(pl.name)} <span class="dim">· ${pl.its.length}</span>`;
  const head = document.createElement('div');
  head.className = 'th';
  for (const it of pl.its) {
    const r2 = document.createElement('div');
    r2.className = 'it hub';
    const via = it.via.map((id) => peaks.find((p) => p.id === id)?.name).filter(Boolean);
    r2.title = [it.name, via.length ? `passa da ${via.join(', ')}` : '', 'tempo stimato (4 km/h, +400 m/h, −800 m/h)', ...it.stops.map((s) => `${s.name} a ${fmtKm(s.along)}`)].filter(Boolean).join('\n');
    r2.innerHTML = `<span class="r">${esc(it.ref || '–')}</span><span class="d d${esc(it.diff || 'x')}">${esc(it.diff || '?')}</span>`
      + `<span class="n"><b>→ ${esc(it.dest)}</b>${via.length ? ` <span class="dim">via ${esc(via.join(', '))}</span>` : ''}<br>${fmtKm(it.length)} · +${it.dplus} −${it.dminus} m · ${fmtTime(it.minutes)}*</span>`;
    r2.addEventListener('click', (e) => { e.stopPropagation(); selectItinerary(it, r2, pl.short, it.dest); });
    head.appendChild(r2);
  }
  box.appendChild(head);
  // labels: hub + destinations
  const layer = $('labels');
  layer.innerHTML = '';
  const mk = (name, x, y, z, dim) => {
    const el = document.createElement('div');
    el.className = 'lbl' + (dim ? ' dim' : '');
    el.innerHTML = `${esc(name)} <span>${Math.round(y)} m</span>`;
    layer.appendChild(el);
    return { t: { x, y, z }, el };
  };
  labels = [mk(pl.name, pl.x, pl.y, pl.z, false), ...pl.its.map((it) => mk(it.dest, it.ex, it.h1, it.ez, true))];
}

// ------------------------------------------------------------------ itinerary: framing + elevation profile
let selRow = null, profile = null;
function sampleItinerary(it) {
  const P = osm.routePts, dir = it.end > it.start ? 1 : -1;
  const out = [];
  let s = 0, next = 0;
  for (let i = it.start; ; i += dir) {
    const x = P[2 * i], z = P[2 * i + 1];
    if (i !== it.start) s += Math.hypot(x - P[2 * (i - dir)], z - P[2 * (i - dir) + 1]);
    if (s >= next || i === it.end) { out.push({ s, x, z, h: groundHeightCubic(x, z) }); next = s + 15; }
    if (i === it.end) break;
  }
  return out;
}
function clearItinerary() {
  selRow?.classList.remove('sel'); selRow = null; profile = null;
  renderer?.setItinerary(0, 0); renderer?.setCursor(1e9, 1e9);
  $('profile').hidden = true;
}
function selectItinerary(it, row, fromName, toName) {
  endFollow(); stopAuto();
  selRow?.classList.remove('sel'); selRow = row; row.classList.add('sel');
  const pts = sampleItinerary(it);
  profile = { it, pts, fromName, toName };
  renderer.setItinerary(it.segA, it.segB);
  renderer.setCursor(1e9, 1e9);
  drawProfile();
  frameItinerary(pts);
}
// Look at the whole route from the side of its main axis (southern side preferred), then refine
// with the real projection until start and end fit the free screen area (left panel, profile).
const fp = { P: new Float32Array(16), V: new Float32Array(16), VP: new Float32Array(16) };
function frameItinerary(pts) {
  let cx = 0, cz = 0, ch = 0;
  for (const p of pts) { cx += p.x; cz += p.z; ch += p.h; }
  cx /= pts.length; cz /= pts.length; ch /= pts.length;
  let sxx = 0, szz = 0, sxz = 0;
  for (const p of pts) { const dx = p.x - cx, dz = p.z - cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  const a = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  let vx = -Math.sin(a), vz = Math.cos(a);
  if (vz < 0) { vx = -vx; vz = -vz; }
  const W = canvas.clientWidth, H = canvas.clientHeight, aspect = W / H;
  const tanV = Math.tan(Math.PI / 6), tanH = tanV * aspect;
  // free area in NDC: right of the panel, above the profile window (both may be hidden on phones)
  const ui = $('ui').getBoundingClientRect(), pr = $('profile').getBoundingClientRect();
  const fx0 = W > 700 ? -1 + 2 * (ui.right + 20) / W : -0.92, fx1 = 0.94;
  const fy0 = W > 700 ? -1 + 2 * (H - pr.top + 20) / H : -0.6, fy1 = 0.86;
  const el = (34 * Math.PI) / 180;
  let ext = 0;
  for (const p of pts) ext = Math.max(ext, Math.hypot(p.x - cx, p.z - cz));
  let dist = Math.max(450, ext * 2.2), yawOff = 0, pitchOff = 0;
  let x = 0, y = 0, z = 0, yaw = 0, pitch = 0;
  perspectiveReverseZ(fp.P, Math.PI / 3, aspect, 0.5);
  for (let iter = 0; iter < 6; iter++) {
    x = cx + vx * dist * Math.cos(el); z = cz + vz * dist * Math.cos(el);
    y = Math.max(ch + dist * Math.sin(el), groundHeight(x, z) + 150);
    yaw = Math.atan2(cx - x, -(cz - z)) + yawOff;
    pitch = Math.atan2(ch - y, Math.hypot(cx - x, cz - z)) + pitchOff;
    viewFromYawPitch(fp.V, yaw, pitch); multiply(fp.VP, fp.P, fp.V);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const M = fp.VP;
    for (let k = 0; k < pts.length; k += 2) {
      const X = pts[k].x - x, Y = pts[k].h - y, Z = pts[k].z - z;
      const w = M[3] * X + M[7] * Y + M[11] * Z + M[15];
      if (w <= 1) { x0 = -9; x1 = 9; y0 = -9; y1 = 9; break; }
      const nx = (M[0] * X + M[4] * Y + M[8] * Z + M[12]) / w, ny = (M[1] * X + M[5] * Y + M[9] * Z + M[13]) / w;
      x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
    }
    const s = Math.max((x1 - x0) / (fx1 - fx0), (y1 - y0) / (fy1 - fy0));
    dist = Math.max(400, dist * Math.min(3, Math.max(0.4, s * 1.08)));
    yawOff += Math.atan(((x0 + x1) / 2 - (fx0 + fx1) / 2) * tanH) * 0.9;
    pitchOff += Math.atan(((y0 + y1) / 2 - (fy0 + fy1) / 2) * tanV) * 0.9;
  }
  placeCamera(x, y, z, yaw, pitch);
}
function drawProfile() {
  const box = $('profile'), svg = $('profSvg');
  const { it, pts, fromName, toName } = profile;
  box.hidden = false;
  const W = svg.clientWidth || 400, H = svg.clientHeight || 150, ml = 40, mr = 10, mt = 14, mb = 22;
  const L = pts[pts.length - 1].s;
  let hMin = Infinity, hMax = -Infinity;
  for (const p of pts) { hMin = Math.min(hMin, p.h); hMax = Math.max(hMax, p.h); }
  const pad = Math.max(30, (hMax - hMin) * 0.12);
  const lo = Math.floor((hMin - pad) / 100) * 100, hi = Math.ceil((hMax + pad) / 100) * 100;
  const X = (s) => ml + (s / L) * (W - ml - mr), Y = (h) => mt + (1 - (h - lo) / (hi - lo)) * (H - mt - mb);
  const step = (hi - lo) > 900 ? 500 : (hi - lo) > 400 ? 200 : 100;
  let g = '';
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) g += `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="${ml - 5}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
  const kmStep = L > 6000 ? 2000 : L > 2500 ? 1000 : 500;
  for (let s = kmStep; s < L; s += kmStep) g += `<text x="${X(s)}" y="${H - 6}" text-anchor="middle">${(s / 1000).toFixed(s % 1000 ? 1 : 0)} km</text>`;
  const line = pts.map((p) => `${X(p.s).toFixed(1)},${Y(p.h).toFixed(1)}`).join(' ');
  const col = ({ T: '#4dcc66', E: '#ffb826', EE: '#f24533', EEA: '#b366ff' })[it.diff] || '#bfbfbf';
  const stops = (it.stops || []).map((st, k) => {
    const sx = X(st.along), right = sx > W * 0.6;
    return `<line x1="${sx}" x2="${sx}" y1="${mt}" y2="${H - mb}" class="st"/><text x="${sx + (right ? -3 : 3)}" y="${mt + 9 + (k % 2) * 11}" text-anchor="${right ? 'end' : 'start'}" class="stt">${esc(st.name)}</text>`;
  }).join('');
  svg.innerHTML = `${g}<polygon points="${ml},${H - mb} ${line} ${W - mr},${H - mb}" fill="${col}" fill-opacity=".22"/>`
    + `<polyline points="${line}" fill="none" stroke="${col}" stroke-width="2"/>${stops}`
    + `<circle cx="${X(0)}" cy="${Y(pts[0].h)}" r="3.5" class="pt"/><circle cx="${X(L)}" cy="${Y(pts[pts.length - 1].h)}" r="3.5" class="pt"/>`
    + `<g id="profCur" style="display:none"><line y1="${mt}" y2="${H - mb}" class="cur"/><circle r="4" class="curp"/><text class="curt" y="${mt + 9}"></text></g>`;
  let up = 0, dn = 0;
  for (let k = 1; k < pts.length; k++) { const d = pts[k].h - pts[k - 1].h; if (d > 0) up += d; else dn -= d; }
  $('profTitle').innerHTML = `<span class="r">${esc(it.ref || '–')}</span><span class="d d${esc(it.diff || 'x')}">${esc(it.diff || '?')}</span> ${esc(fromName)} → ${esc(toName)}`;
  $('profStats').textContent = `${fmtKm(L)} · +${Math.round(up)} m −${Math.round(dn)} m · ${Math.round(pts[0].h)} → ${Math.round(pts[pts.length - 1].h)} m · max ${Math.round(hMax)} m · ${fmtTime(it.minutes)}${it.timeSrc === 'osm' ? '' : ' (stima)'}`;
  svg.onmousemove = (e) => {
    const r = svg.getBoundingClientRect();
    const s = Math.min(L, Math.max(0, ((e.clientX - r.left - ml) / (W - ml - mr)) * L));
    let k = 0; while (k < pts.length - 1 && pts[k + 1].s < s) k++;
    const p = pts[k];
    const c = $('profCur'); c.style.display = '';
    c.querySelector('line').setAttribute('x1', X(p.s)); c.querySelector('line').setAttribute('x2', X(p.s));
    c.querySelector('circle').setAttribute('cx', X(p.s)); c.querySelector('circle').setAttribute('cy', Y(p.h));
    const t = c.querySelector('text'); t.textContent = `${fmtKm(p.s)} · ${Math.round(p.h)} m`;
    t.setAttribute('x', X(p.s) + (X(p.s) > W * 0.7 ? -6 : 6)); t.setAttribute('text-anchor', X(p.s) > W * 0.7 ? 'end' : 'start');
    renderer.setCursor(p.x, p.z);
  };
  svg.onmouseleave = () => { $('profCur').style.display = 'none'; renderer.setCursor(1e9, 1e9); };
}

// ------------------------------------------------------------------ light: time of day and seasons
// Solar position for Lecco (45.88 N, 9.40 E) on a representative day of each season.
const LAT = (45.88 * Math.PI) / 180;
const SEASONS = {
  primavera: { label: 'Primavera', decl: 12, autumn: 0, winter: 0, dry: 0, treeSnow: 0, snow: 2000, dst: 1 },
  estate: { label: 'Estate', decl: 20.5, autumn: 0, winter: 0, dry: 0.6, treeSnow: 0, snow: 2750, dst: 1 },
  autunno: { label: 'Autunno', decl: -11, autumn: 1, winter: 0, dry: 0.35, treeSnow: 0, snow: 2300, dst: 1 },
  inverno: { label: 'Inverno', decl: -20, autumn: 0, winter: 1, dry: 0.15, treeSnow: 0.85, snow: 1150, dst: 0 },
};
const light = { season: params.get('season') || 'primavera', t: params.has('tod') ? Number(params.get('tod')) : 0.68 };
function sunFor(season, t) {
  const d = (SEASONS[season].decl * Math.PI) / 180;
  const H0 = Math.acos(-Math.tan(LAT) * Math.tan(d)) * 0.94;            // a little after sunrise .. before sunset
  const H = -H0 + t * 2 * H0;
  const el = Math.asin(Math.sin(LAT) * Math.sin(d) + Math.cos(LAT) * Math.cos(d) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LAT) - Math.tan(d) * Math.cos(LAT)) + Math.PI;
  const clock = 12 + (H * 180) / Math.PI / 15 + (15 - 9.40) / 15 + SEASONS[season].dst;   // CET / CEST
  return { az: (az * 180) / Math.PI, el: (el * 180) / Math.PI, clock };
}
function applyLight() {
  const s = SEASONS[light.season];
  const sun = sunFor(light.season, light.t);
  renderer.setSun(sun.az, sun.el);
  renderer.setSeason(s);
  const hh = Math.floor(sun.clock), mm = Math.round((sun.clock - hh) * 60);
  $('todLabel').textContent = `${hh}:${String(mm % 60).padStart(2, '0')} · sole ${Math.max(1, Math.round(sun.el))}°`;
  document.querySelectorAll('#seasons button').forEach((b) => b.classList.toggle('on', b.dataset.s === light.season));
}
function buildLight() {
  const box = $('seasons');
  for (const [k, s] of Object.entries(SEASONS)) {
    const b = document.createElement('button');
    b.textContent = s.label; b.dataset.s = k;
    b.addEventListener('click', (e) => { e.stopPropagation(); light.season = k; applyLight(); b.blur(); });
    box.appendChild(b);
  }
  const r = $('tod');
  r.value = String(Math.round(light.t * 1000));
  let pending = false;
  r.addEventListener('input', () => {
    light.t = Number(r.value) / 1000;
    if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; applyLight(); }); }
  });
  r.addEventListener('keydown', (e) => e.stopPropagation());
  applyLight();
}

// ------------------------------------------------------------------ panorama: names of the visible summits
// Line-of-sight test against the terrain, priority order (start summits, crosses, height), no overlaps.
let peakLbls = [], showPeakNames = true;
function buildPeakLabels() {
  const layer = $('peakNames');
  peakLbls = (osmMeta.peakLabels || []).map(([x, z, ele, pri, name]) => {
    const el = document.createElement('div');
    el.className = 'pk';
    el.innerHTML = `<b>${esc(name)}</b> ${Math.round(ele)}`;
    el.style.display = 'none';
    layer.appendChild(el);
    return { x, z, y: groundHeight(x, z), el, shown: false };
  });
}
const placed = [];
function updatePeakLabels(vp, cam, w, h) {
  placed.length = 0;
  let count = 0;
  for (const p of peakLbls) {
    let vis = false;
    if (showPeakNames && count < 28) {
      const dx = p.x - cam.x, dz = p.z - cam.z, dy = p.y - cam.y, d = Math.hypot(dx, dz);
      if (d > 120 && d < 26000) {
        const top = p.y + 2;
        const X = dx, Y = top - cam.y, Z = dz;
        const cw = vp[3] * X + vp[7] * Y + vp[11] * Z + vp[15];
        if (cw > 1) {
          const sx = ((vp[0] * X + vp[4] * Y + vp[8] * Z + vp[12]) / cw * 0.5 + 0.5) * w;
          const sy = (0.5 - (vp[1] * X + vp[5] * Y + vp[9] * Z + vp[13]) / cw * 0.5) * h;
          if (sx > 20 && sx < w - 20 && sy > 30 && sy < h - 10) {
            // line of sight: terrain must stay below the eye-to-summit line
            let free = true;
            const steps = Math.min(60, Math.max(8, Math.round(d / 150)));
            for (let k = 1; k < steps - 1 && free; k++) {
              const t = k / steps;
              if (groundHeight(cam.x + dx * t, cam.z + dz * t) > cam.y + (top - cam.y) * t + 4) free = false;
            }
            if (free) {
              const bw = p.el.offsetWidth || 90;
              let clash = false;
              for (let q = 0; q < placed.length && !clash; q += 2) if (Math.abs(placed[q] - sx) < (bw + 70) * 0.5 && Math.abs(placed[q + 1] - sy) < 22) clash = true;
              if (!clash) {
                placed.push(sx, sy);
                p.el.style.transform = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px) translate(-50%, -100%)`;
                p.el.style.opacity = d > 15000 ? '0.7' : '1';
                vis = true; count++;
              }
            }
          }
        }
      }
    }
    if (vis !== p.shown) { p.el.style.display = vis ? '' : 'none'; p.shown = vis; }
  }
}

// Camera views
function flyToTrailhead(t, p) {
  endFollow();
  const dx = p.x - t.x, dz = p.z - t.z, d = Math.hypot(dx, dz) || 1;
  const x = t.x - (dx / d) * 260, z = t.z - (dz / d) * 260;
  const y = Math.max(groundHeight(x, z), t.y) + 140;
  const yaw = Math.atan2(t.x + dx * 0.25 - x, -(t.z + dz * 0.25 - z));
  placeCamera(x, y, z, yaw, Math.atan2(t.y - y, Math.hypot(t.x - x, t.z - z)) * 0.7);
  startOrbit(t.x, t.z);
}
function overview(i) {
  endFollow();
  const p = peaks[i];
  const ths = osm.byPeak.get(p.id) || [];
  // frame the summit and all its trailheads from the south-west, high above
  let r = 800;
  for (const t of ths) r = Math.max(r, Math.min(5000, Math.hypot(t.x - p.x, t.z - p.z)));
  const ang = (225 * Math.PI) / 180, dist = r * 1.5;
  const x = p.x + Math.sin(ang) * dist, z = p.z - Math.cos(ang) * dist;
  const y = p.h + r * 1.1;
  placeCamera(x, y, z, Math.atan2(p.x - x, -(p.z - z)), Math.atan2(p.h - r * 0.25 - y, dist));
  startOrbit(p.x, p.z);
}

let hinted = false;
function panoramaHint(start) {
  start();
  if (!hinted) { toast('Panorama a 360° · muovi il mouse o premi un tasto per fermarlo (P per ripartire)'); hinted = true; }
}

// Floating labels over the pins (updated a few times per second, outside the render loop)
let labels = [];
function buildLabels(ths) {
  const layer = $('labels');
  layer.innerHTML = '';
  labels = ths.filter((t) => !t.connector).map((t) => {
    const el = document.createElement('div');
    el.className = 'lbl';
    el.innerHTML = `${esc(t.name)} <span>${Math.round(t.y)} m</span>`;
    layer.appendChild(el);
    return { t, el };
  });
}
function updateLabels(vp, cam, w, h) {
  for (const { t, el } of labels) {
    const dx = t.x - cam.x, dz = t.z - cam.z, dist = Math.hypot(dx, dz, t.y - cam.y);
    const H = Math.max(9, dist * 52 / h);
    const X = dx, Y = t.y + H - cam.y, Z = dz;
    const cw = vp[3] * X + vp[7] * Y + vp[11] * Z + vp[15];
    if (cw <= 0.1) { el.style.display = 'none'; continue; }
    const cx = (vp[0] * X + vp[4] * Y + vp[8] * Z + vp[12]) / cw, cy = (vp[1] * X + vp[5] * Y + vp[9] * Z + vp[13]) / cw;
    if (Math.abs(cx) > 1.1 || Math.abs(cy) > 1.1) { el.style.display = 'none'; continue; }
    el.style.display = '';
    el.style.transform = `translate(${((cx * 0.5 + 0.5) * w).toFixed(0)}px, ${((0.5 - cy * 0.5) * h).toFixed(0)}px) translate(-50%, -130%)`;
    el.style.opacity = dist > 12000 ? '0.55' : '1';
  }
}

// ------------------------------------------------------------------ hut search
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let hutIndex = [];
function buildHutSearch() {
  hutIndex = osm.huts.map((h) => ({ h, key: norm(h.name || '') })).filter((e) => e.key);
  const input = $('search'), list = $('results');
  let hits = [], sel = 0;
  const render = () => {
    list.innerHTML = '';
    hits.forEach((e, k) => {
      const b = document.createElement('button');
      b.className = k === sel ? 'sel' : '';
      b.innerHTML = `<span class="ico ${e.h.type}"></span><span>${esc(e.h.name)}</span><span class="e">${Math.round(e.h.base)} m</span>`;
      b.addEventListener('mousedown', (ev) => { ev.preventDefault(); choose(e.h); });
      list.appendChild(b);
    });
    list.style.display = hits.length ? '' : 'none';
  };
  const choose = (h) => { input.value = h.name; hits = []; render(); input.blur(); flyToHut(h); };
  input.addEventListener('input', () => {
    const q = norm(input.value).split(/\s+/).filter(Boolean);
    hits = q.length ? hutIndex.filter((e) => q.every((w) => e.key.includes(w)))
      .sort((a, b) => a.key.indexOf(q[0]) - b.key.indexOf(q[0]) || a.key.localeCompare(b.key)).slice(0, 8) : [];
    sel = 0; render();
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { sel = Math.min(hits.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && hits[sel]) choose(hits[sel].h);
    else if (e.key === 'Escape') { input.value = ''; hits = []; render(); input.blur(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { hits = []; render(); }, 150));
}
function flyToHut(h) {
  endFollow();
  // stand on the downhill side, a bit above, looking at the hut
  let bx = 0, bz = 0, best = Infinity;
  for (let a = 0; a < 8; a++) {
    const ang = (a * Math.PI) / 4, x = h.x + Math.sin(ang) * 70, z = h.z - Math.cos(ang) * 70;
    const g = groundHeight(x, z);
    if (g < best) { best = g; bx = x; bz = z; }
  }
  const y = Math.max(best, h.base) + 22;
  placeCamera(bx, y, bz, Math.atan2(h.x - bx, -(h.z - bz)), Math.atan2(h.base + 4 - y, Math.hypot(h.x - bx, h.z - bz)));
  toast(`${h.name} · ${Math.round(h.base)} m`);
  startOrbit(h.x, h.z);
}
let toastT = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2500);
}

// ------------------------------------------------------------------ walking speed
const SPEEDS = [2, 3, 4, 5, 7, 12];
function buildSpeed() {
  const box = $('speed');
  SPEEDS.forEach((v) => {
    const b = document.createElement('button');
    b.textContent = v;
    b.title = v >= 7 ? `${v} km/h (corsa)` : `${v} km/h`;
    b.addEventListener('click', (e) => { e.stopPropagation(); setSpeed(v); b.blur(); });
    box.appendChild(b);
  });
  setSpeed(follow.kmh);
}
function setSpeed(v) {
  follow.kmh = v;
  [...$('speed').children].forEach((b) => b.classList.toggle('on', Number(b.textContent) === v));
}
function stepSpeed(d) {
  const i = SPEEDS.indexOf(follow.kmh);
  setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 2 : i) + d))]);
}

function beginFollow(o, startDist = 0) {
  startFollow(osm.routePts, o, startDist);
  document.body.classList.add('following');
  const label = o.ref ? `Sentiero ${o.ref}` : 'Sentiero';
  let what;
  if (o.hubName) what = o.back ? `da ${o.dest} a ${o.hubName}` : `da ${o.hubName} a ${o.dest}`;
  else { const th = osm.trailheads[o.th]; what = o.h1 > o.h0 ? `da ${th.name} alla vetta` : `dalla vetta a ${th.name}`; }
  $('fTitle').textContent = `${label}${o.diff ? ` (${o.diff})` : ''} · ${what}`;
}
function endFollow() {
  stopFollow();
  document.body.classList.remove('following');
}

function gotoPeak(i) {
  const p = peaks[i];
  if (!p) return;
  const dx = p.lookX - p.x, dz = p.lookZ - p.z;
  const d = Math.hypot(dx, dz) || 1;
  const ux = dx / d, uz = dz / d;
  // stand on the summit (a few metres back, eye above the DSM canopy), facing the view target
  const back = 0, up = 32;
  const x = p.x - ux * back, z = p.z - uz * back;
  const y = Math.max(p.h + up, groundHeight(x, z) + 15);
  const th = groundHeight(p.lookX, p.lookZ);
  const pitch = Math.atan2(th - y, d + back) * 0.45;
  endFollow();
  placeCamera(x, y, z, Math.atan2(dx, -dz), pitch);
  document.querySelectorAll('#peaks button').forEach((b, k) => b.classList.toggle('active', k === i));
  document.querySelectorAll('#places button').forEach((b) => b.classList.remove('active'));
  activePeak = i; activePlace = -1;
  clearItinerary();
  renderer?.setSelection(osm ? osm.peakBit(p.id) : 0);
  showTrails(i);
  camera.pitch = Math.max(camera.pitch, -0.12);
  panoramaHint(startPanorama);
}

function buildUI() {
  const list = $('peaks');
  peaks.forEach((p, i) => {
    const b = document.createElement('button');
    const elev = p.elev != null ? `${p.elev} m` : `≈${Math.round(p.h)} m`;
    b.innerHTML = `<kbd>${i + 1}</kbd><span class="n">${p.name}</span><span class="e">${elev}</span>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); gotoPeak(i); b.blur(); });
    list.appendChild(b);
  });
  osm.places.forEach((pl, k) => {
    const b = document.createElement('button');
    b.innerHTML = `<kbd>◆</kbd><span class="n">${esc(pl.short)}</span><span class="e">${Math.round(pl.y)} m</span>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); selectPlace(k); b.blur(); });
    $('places').appendChild(b);
  });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === '/') { e.preventDefault(); $('search').focus(); return; }
    const k = e.key >= '1' && e.key <= '9' ? Number(e.key) - 1 : -1;
    if (k >= 0 && k < peaks.length) gotoPeak(k);
    if (e.code === 'KeyH') document.body.classList.toggle('nohud');
    if (e.code === 'KeyV' && activePeak >= 0) overview(activePeak);
    if (e.code === 'KeyL') { showPeakNames = !showPeakNames; toast(showPeakNames ? 'Nomi delle cime visibili' : 'Nomi delle cime nascosti'); }
    if (e.code === 'Escape' && profile && !follow.active) clearItinerary();
    if (e.code === 'KeyP' && !follow.active) { if (auto.mode) stopAuto(); else startPanorama(); }
    if (e.code === 'KeyN') {
      const steps = [0, 0.2, 0.35, 0.5, 0.65];
      const i = steps.findIndex((v) => v >= opts.clouds - 0.01);
      opts.clouds = steps[(i + 1) % steps.length];
      renderer.setClouds(opts.clouds);
      toast(opts.clouds ? `Nuvole: ${Math.round(opts.clouds * 100)}%` : 'Cielo sereno');
    }
    if (e.code === 'KeyB') { opts.trees = !opts.trees; renderer.setTrees(opts.trees); toast(opts.trees ? 'Boschi attivi' : 'Boschi nascosti'); }
    if (follow.active) {
      if (e.code === 'KeyF' || e.code === 'Escape') endFollow();
      if (e.code === 'Space') follow.auto = !follow.auto;
      if (e.key === '+' || e.code === 'NumpadAdd' || e.code === 'Equal') stepSpeed(1);
      if (e.key === '-' || e.code === 'NumpadSubtract' || e.code === 'Minus') stepSpeed(-1);
    }
  });
  $('credits').textContent = `${meta.attribution} · ${osmMeta.attribution}`;
  buildHutSearch();
  buildSpeed();
  $('profClose').addEventListener('click', (e) => { e.stopPropagation(); clearItinerary(); });
  buildPeakLabels();
}

async function main() {
  try {
    status.textContent = 'Decompressione del terreno…';
    const data = await loadTerrain();
    osm = await loadOsm();
    console.info(`OSM: ${osm.nSeg} trail segments, ${osm.nPads} pads, max ${osm.maxPerCell} items/cell, ${osm.mesh.length / 10} mesh vertices`);
    renderer = await createRenderer(canvas, data, osm, opts);
    console.info(`precompute ${renderer.precomputeMs.toFixed(0)} ms`, renderer.adapterInfo);

    const fit = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth * opts.renderScale));
      const h = Math.max(1, Math.round(canvas.clientHeight * opts.renderScale));
      if (w !== canvas.width || h !== canvas.height || !fit.done) { renderer.resize(w, h); fit.done = true; }
    };
    fit();
    window.addEventListener('resize', fit);

    buildUI();
    buildLight();
    attachInput(canvas);
    const start = params.get('peak');
    const camParam = params.get('cam');
    if (camParam) {
      const [x, y, z, yaw, pitch] = camParam.split(',').map(Number);
      placeCamera(x, y, z, (yaw * Math.PI) / 180, (pitch * Math.PI) / 180);
    } else {
      const idx = Math.max(0, peaks.findIndex((p) => p.id === start || String(peaks.indexOf(p) + 1) === start));
      gotoPeak(idx);
      const fp = params.get('follow');           // "<itinerary index>:<metres along>[:down]"
      if (fp) {
        const [oi, along, dn] = fp.split(':');
        const it = (osm.byPeak.get(peaks[idx].id) || []).flatMap((t) => t.its)[Number(oi)];
        if (it) beginFollow(dn ? reversed(it) : it, Number(along) || 0);
      }
      if (params.has('overview')) overview(idx);
      if (params.has('it')) {
        const k = Number(params.get('it'));
        const all = (osm.byPeak.get(peaks[idx].id) || []).flatMap((t) => t.its.map((it) => [it, t.name]));
        if (all[k]) setTimeout(() => {}, 0), selectItinerary(all[k][0], document.querySelectorAll('#trails .it')[k] || document.body, all[k][1], peaks[idx].name);
      }
      if (params.has('place')) selectPlace(Number(params.get('place')) || 0);
    }
    status.remove();

    // HUD (updated a few times per second, not per frame)
    const hudAlt = $('alt'), hudAgl = $('agl'), hudPos = $('pos'), hudFps = $('fps'), hudSpd = $('spd');
    const fProg = $('fProg'), fState = $('fState');
    const updateFollowHud = () => {
      if (!follow.active) return;
      const o = follow.opt;
      fProg.textContent = `${fmtKm(follow.s)} / ${fmtKm(follow.total)} · quota ${Math.round(camera.y - follow.eye)} m · arrivo ${Math.round(o.h1)} m`;
      const next = o.stops.find((s) => s.along > follow.s + 5);
      const here = o.stops.find((s) => Math.abs(s.along - follow.s) <= 25);
      fState.textContent = here ? `al ${here.name}` : follow.s >= follow.total ? 'arrivato'
        : `${follow.auto ? 'in cammino' : 'in pausa'}${next ? ` · ${next.name} tra ${fmtKm(next.along - follow.s)}` : ''}`;
    };
    const ll = new Float64Array(2);
    let frames = 0, hudT = 0, last = performance.now();
    const fixedTime = params.has('t') ? Number(params.get('t')) : -1;

    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      updateCamera(dt);
      renderer.render(camera, fixedTime >= 0 ? fixedTime : now / 1000);
      frames++;
      if (now - hudT > 400) {
        const sec = (now - hudT) / 1000;
        hudFps.textContent = (frames / sec).toFixed(0);
        frames = 0; hudT = now;
        toLatLon(camera.x, camera.z, ll);
        hudAlt.textContent = Math.round(camera.y);
        hudAgl.textContent = Math.round(camera.agl);
        hudSpd.textContent = `×${camera.speedMul.toFixed(2)}`;
        hudPos.textContent = `${ll[0].toFixed(5)}N ${ll[1].toFixed(5)}E`;
        updateFollowHud();
      }
      requestAnimationFrame(tick);
    };
    if (shotMode) {
      // single off-screen frame, shown in a 2D canvas so page screenshots include the HUD
      updateCamera(0);
      const img = await renderer.capture(camera, fixedTime >= 0 ? fixedTime : 10);
      const snap = document.createElement('canvas');
      snap.width = img.width; snap.height = img.height;
      snap.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
      snap.getContext('2d').putImageData(img, 0, 0);
      canvas.after(snap);
      updateLabels(renderer.viewProj, camera, canvas.clientWidth, canvas.clientHeight);
      updatePeakLabels(renderer.viewProj, camera, canvas.clientWidth, canvas.clientHeight);
      toLatLon(camera.x, camera.z, ll);
      hudAlt.textContent = Math.round(camera.y); hudAgl.textContent = Math.round(camera.agl);
      hudPos.textContent = `${ll[0].toFixed(5)}N ${ll[1].toFixed(5)}E`;
      updateFollowHud();
      window.__ready = true;
      return;
    }
    const lblTimer = () => {
      updateLabels(renderer.viewProj, camera, canvas.clientWidth, canvas.clientHeight);
      updatePeakLabels(renderer.viewProj, camera, canvas.clientWidth, canvas.clientHeight);
    };
    setInterval(lblTimer, 60);
    requestAnimationFrame(tick);
  } catch (err) {
    console.error(err);
    status.classList.add('error');
    status.textContent = `Errore: ${err.message}`;
    window.__error = err.message;
  }
}

main();
