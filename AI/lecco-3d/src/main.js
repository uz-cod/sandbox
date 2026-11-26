// Entry point: load data, build the renderer, wire UI and run the frame loop.
import { loadTerrain, meta, groundHeight, toLatLon } from './terrain-data.js';
import { createRenderer } from './renderer.js';
import { camera, attachInput, placeCamera, updateCamera } from './camera.js';

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
  placeCamera(x, y, z, Math.atan2(dx, -dz), pitch);
  document.querySelectorAll('#peaks button').forEach((b, k) => b.classList.toggle('active', k === i));
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
  });
  $('credits').textContent = meta.attribution;
}

async function main() {
  try {
    status.textContent = 'Decompressione del terreno…';
    const data = await loadTerrain();
    const renderer = await createRenderer(canvas, data, opts);
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
    }
    status.remove();

    // HUD (updated a few times per second, not per frame)
    const hudAlt = $('alt'), hudAgl = $('agl'), hudPos = $('pos'), hudFps = $('fps'), hudSpd = $('spd');
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
