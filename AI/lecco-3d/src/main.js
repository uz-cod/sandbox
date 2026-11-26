// Entry point: load data, build the renderer, wire UI and run the frame loop.
import { loadTerrain, meta, groundHeight, toLatLon } from './terrain-data.js';
import { loadOsm, osmMeta } from './osm-data.js';
import { createRenderer } from './renderer.js';
import { camera, attachInput, placeCamera, updateCamera, follow, startFollow, stopFollow } from './camera.js';

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
};
const shotMode = params.has('shot');
if (params.get('hud') === '0') document.body.classList.add('nohud');

const peaks = meta.peaks.filter((p) => p.found);
let osm = null;
let activePeak = -1;

function fmtKm(m) { return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`; }

function showTrails(i) {
  const box = $('trails');
  box.innerHTML = '';
  const p = peaks[i];
  const opts = (p && osm?.routeOptions.get(p.id)) || [];
  $('trailsHead').textContent = opts.length ? `Sentieri dalla vetta (${opts.length})` : 'Nessun sentiero segnato dalla vetta';
  opts.forEach((o) => {
    const b = document.createElement('button');
    const label = o.ref ? o.ref : (o.name || 'sentiero');
    const title = o.name && o.ref ? o.name : '';
    b.title = title;
    b.innerHTML = `<span class="r">${label}</span><span class="n">verso ${o.toward} · ${fmtKm(o.length)}</span><span class="e">−${Math.round(o.h0 - o.h1)} m</span>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); beginFollow(o); b.blur(); });
    box.appendChild(b);
  });
}

function beginFollow(o, startDist = 0) {
  startFollow(osm.routePts, o, startDist);
  document.body.classList.add('following');
  const label = o.ref ? `Sentiero ${o.ref}` : 'Sentiero';
  $('fTitle').textContent = o.name ? `${label} · ${o.name}` : label;
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
  activePeak = i;
  showTrails(i);
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
  window.addEventListener('keydown', (e) => {
    const k = e.key >= '1' && e.key <= '9' ? Number(e.key) - 1 : -1;
    if (k >= 0 && k < peaks.length) gotoPeak(k);
    if (e.code === 'KeyH') document.body.classList.toggle('nohud');
    if (follow.active) {
      if (e.code === 'KeyF' || e.code === 'Escape') endFollow();
      if (e.code === 'Space') follow.auto = !follow.auto;
    }
  });
  $('credits').textContent = `${meta.attribution} · ${osmMeta.attribution}`;
}

async function main() {
  try {
    status.textContent = 'Decompressione del terreno…';
    const data = await loadTerrain();
    osm = await loadOsm();
    console.info(`OSM: ${osm.nSeg} trail segments, ${osm.nPads} pads, max ${osm.maxPerCell} items/cell, ${osm.mesh.length / 10} mesh vertices`);
    const renderer = await createRenderer(canvas, data, osm, opts);
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
      const fp = params.get('follow');           // "<option index>:<metres along>"
      if (fp) {
        const [oi, along] = fp.split(':').map(Number);
        const o = osm.routeOptions.get(peaks[idx].id)?.[oi];
        if (o) beginFollow(o, along || 0);
      }
    }
    status.remove();

    // HUD (updated a few times per second, not per frame)
    const hudAlt = $('alt'), hudAgl = $('agl'), hudPos = $('pos'), hudFps = $('fps'), hudSpd = $('spd');
    const fProg = $('fProg'), fState = $('fState');
    const updateFollowHud = () => {
      if (!follow.active) return;
      const o = follow.opt;
      fProg.textContent = `${fmtKm(follow.s)} / ${fmtKm(follow.total)} · quota ${Math.round(camera.y - follow.eye)} m · arrivo ${Math.round(o.h1)} m`;
      fState.textContent = follow.s >= follow.total ? 'arrivato' : follow.auto ? 'in cammino' : 'in pausa';
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
      toLatLon(camera.x, camera.z, ll);
      hudAlt.textContent = Math.round(camera.y); hudAgl.textContent = Math.round(camera.agl);
      hudPos.textContent = `${ll[0].toFixed(5)}N ${ll[1].toFixed(5)}E`;
      updateFollowHud();
      window.__ready = true;
      return;
    }
    requestAnimationFrame(tick);
  } catch (err) {
    console.error(err);
    status.classList.add('error');
    status.textContent = `Errore: ${err.message}`;
    window.__error = err.message;
  }
}

main();
