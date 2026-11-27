// Entry point: load data, build the renderer, wire UI and run the frame loop.
import { loadTerrain, meta, groundHeight, toLatLon } from './terrain-data.js';
import { loadOsm, osmMeta, reversed } from './osm-data.js';
import { createRenderer } from './renderer.js';
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
      const up = document.createElement('button'); up.textContent = 'sali'; up.title = 'Cammina dalla partenza alla vetta';
      const down = document.createElement('button'); down.textContent = 'scendi'; down.title = 'Cammina dalla vetta alla partenza';
      up.addEventListener('click', (e) => { e.stopPropagation(); beginFollow(it); up.blur(); });
      down.addEventListener('click', (e) => { e.stopPropagation(); beginFollow(reversed(it)); down.blur(); });
      r.append(up, down);
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
    const go = document.createElement('button'); go.textContent = 'vai'; go.title = `Cammina da ${pl.short} verso ${it.dest}`;
    const back = document.createElement('button'); back.textContent = 'torna'; back.title = `Cammina da ${it.dest} a ${pl.short}`;
    go.addEventListener('click', (e) => { e.stopPropagation(); beginFollow({ ...it, hubName: pl.short }); go.blur(); });
    back.addEventListener('click', (e) => { e.stopPropagation(); beginFollow({ ...reversed(it), hubName: pl.short, back: true }); back.blur(); });
    r2.append(go, back);
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
      toLatLon(camera.x, camera.z, ll);
      hudAlt.textContent = Math.round(camera.y); hudAgl.textContent = Math.round(camera.agl);
      hudPos.textContent = `${ll[0].toFixed(5)}N ${ll[1].toFixed(5)}E`;
      updateFollowHud();
      window.__ready = true;
      return;
    }
    const lblTimer = () => updateLabels(renderer.viewProj, camera, canvas.clientWidth, canvas.clientHeight);
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
