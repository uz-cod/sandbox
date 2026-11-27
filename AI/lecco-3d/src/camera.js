// Free-flying camera. Input handlers only write into preallocated state; update() reads it.
import { groundHeight, groundHeightCubic } from './terrain-data.js';

export const camera = {
  x: 0, y: 1500, z: 0,
  yaw: 0, pitch: 0,
  vx: 0, vy: 0, vz: 0,
  speedMul: 1,
  agl: 0,
};

const input = { f: 0, b: 0, l: 0, r: 0, u: 0, d: 0, fast: 0, slow: 0, tl: 0, tr: 0, tu: 0, td: 0, mdx: 0, mdy: 0 };
const MIN_AGL = 6;      // keeps the eye above the micro-relief displacement
const SENS = 0.0022;

function setKey(code, v) {
  switch (code) {
    case 'KeyW': input.f = v; return true;
    case 'KeyS': input.b = v; return true;
    case 'KeyA': input.l = v; return true;
    case 'KeyD': input.r = v; return true;
    case 'KeyE': case 'Space': input.u = v; return true;
    case 'KeyQ': case 'KeyC': input.d = v; return true;
    case 'ShiftLeft': case 'ShiftRight': input.fast = v; return true;
    case 'AltLeft': case 'AltRight': case 'ControlLeft': input.slow = v; return true;
    case 'ArrowLeft': input.tl = v; return true;
    case 'ArrowRight': input.tr = v; return true;
    case 'ArrowUp': input.tu = v; return true;
    case 'ArrowDown': input.td = v; return true;
  }
  return false;
}

export function attachInput(canvas) {
  const typing = (e) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
  window.addEventListener('keydown', (e) => { if (!typing(e) && setKey(e.code, 1)) e.preventDefault(); });
  window.addEventListener('keyup', (e) => { setKey(e.code, 0); });
  window.addEventListener('blur', () => { for (const k in input) input[k] = 0; });
  canvas.addEventListener('click', () => { if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.(); });
  let dragging = false;
  canvas.addEventListener('mousedown', () => { dragging = true; });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas || dragging) { input.mdx += e.movementX; input.mdy += e.movementY; }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.speedMul = Math.min(20, Math.max(0.05, camera.speedMul * Math.exp(-e.deltaY * 0.0015)));
  }, { passive: false });
}

// ------------------------------------------------------------------ panorama
// mode 1: turn on the spot (summits), mode 2: orbit around a point (hubs, huts, overviews).
// One slow full turn; any mouse or movement input stops it.
export const auto = { mode: 0, cx: 0, cz: 0, r: 0, ang: 0, left: 0 };
const TURN = Math.PI * 2, TURN_TIME = 60;
export function startPanorama() { auto.mode = 1; auto.left = TURN; }
export function startOrbit(cx, cz) {
  auto.mode = 2; auto.left = TURN; auto.cx = cx; auto.cz = cz;
  auto.r = Math.hypot(camera.x - cx, camera.z - cz) || 1;
  auto.ang = Math.atan2(camera.x - cx, -(camera.z - cz));
}
export function stopAuto() { auto.mode = 0; }
function updateAuto(dt) {
  const done = TURN - auto.left;
  // ease in and out over the first / last 15 degrees
  const ease = Math.min(1, 0.15 + done / 0.26, 0.15 + auto.left / 0.26);
  const step = Math.min(auto.left, (TURN / TURN_TIME) * ease * dt);
  auto.left -= step;
  if (auto.mode === 1) camera.yaw += step;
  else {
    auto.ang += step;
    camera.x = auto.cx + Math.sin(auto.ang) * auto.r;
    camera.z = auto.cz - Math.cos(auto.ang) * auto.r;
    camera.yaw = Math.atan2(auto.cx - camera.x, -(auto.cz - camera.z));
  }
  if (auto.left <= 0) auto.mode = 0;
}

export function placeCamera(x, y, z, yaw, pitch) {
  camera.x = x; camera.y = y; camera.z = z;
  camera.yaw = yaw; camera.pitch = pitch;
  camera.vx = camera.vy = camera.vz = 0;
}

// ------------------------------------------------------------------ trail following
// Walks the camera along a polyline (route chained by the OSM bake) at eye height.
export const follow = {
  active: false, pts: null, cum: null, n: 0, total: 0, s: 0, auto: true,
  kmh: 4, yawOff: 0, pitchOff: 0, idle: 0, eye: 1.7, opt: null,
};
const tmp = new Float64Array(2), tmp2 = new Float64Array(2);

export function startFollow(routePts, opt, startDist = 0) {
  const n = Math.abs(opt.end - opt.start) + 1;
  const dir = Math.sign(opt.end - opt.start) || 1;
  const pts = new Float32Array(n * 2), cum = new Float32Array(n);
  for (let k = 0, i = opt.start; k < n; k++, i += dir) {
    pts[2 * k] = routePts[2 * i]; pts[2 * k + 1] = routePts[2 * i + 1];
    if (k > 0) cum[k] = cum[k - 1] + Math.hypot(pts[2 * k] - pts[2 * k - 2], pts[2 * k + 1] - pts[2 * k - 1]);
  }
  Object.assign(follow, { active: true, pts, cum, n, total: cum[n - 1], s: Math.min(startDist, cum[n - 1]), auto: true, yawOff: 0, pitchOff: 0, idle: 0, opt });
  camera.vx = camera.vy = camera.vz = 0;
  samplePath(follow.s, tmp);
  samplePath(follow.s + 12, tmp2);
  camera.x = tmp[0]; camera.z = tmp[1];
  camera.y = groundHeightCubic(tmp[0], tmp[1]) + follow.eye;
  camera.yaw = Math.atan2(tmp2[0] - tmp[0], -(tmp2[1] - tmp[1]));
  camera.pitch = -0.12;
}
export function stopFollow() {
  if (!follow.active) return;
  follow.active = false;
  camera.y += 25;                     // lift off the trail into free flight
}

function samplePath(s, out) {
  const { cum, pts, n } = follow;
  if (s <= 0) { out[0] = pts[0]; out[1] = pts[1]; return; }
  if (s >= cum[n - 1]) { out[0] = pts[2 * n - 2]; out[1] = pts[2 * n - 1]; return; }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  const t = (s - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]);
  out[0] = pts[2 * lo] + (pts[2 * hi] - pts[2 * lo]) * t;
  out[1] = pts[2 * lo + 1] + (pts[2 * hi + 1] - pts[2 * lo + 1]) * t;
}

function wrapAngle(a) { return a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI; }

function updateFollow(dt) {
  const moved = input.mdx !== 0 || input.mdy !== 0;
  follow.yawOff += input.mdx * SENS + (input.tr - input.tl) * 1.4 * dt;
  follow.pitchOff -= input.mdy * SENS - (input.tu - input.td) * 1.0 * dt;
  follow.pitchOff = Math.max(-1.3, Math.min(1.3, follow.pitchOff));
  input.mdx = 0; input.mdy = 0;
  follow.idle = moved ? 0 : follow.idle + dt;
  if (follow.idle > 3) { const k = 1 - Math.exp(-dt * 1.5); follow.yawOff *= 1 - k; follow.pitchOff *= 1 - k; }

  const manual = input.f - input.b;
  const dir = manual !== 0 ? manual : follow.auto ? 1 : 0;
  const v = (follow.kmh / 3.6) * (input.fast ? 3 : 1) * (input.slow ? 0.4 : 1);
  const prevS = follow.s;
  follow.s = Math.max(0, Math.min(follow.total, follow.s + dir * v * dt));
  // auto-walk pauses on arrival at a hut along the route (Space to continue)
  if (follow.auto && manual === 0) {
    const st = follow.opt.stops;
    for (let i = 0; i < st.length; i++) if (prevS < st[i].along && follow.s >= st[i].along) { follow.s = st[i].along; follow.auto = false; }
  }
  samplePath(follow.s, tmp);
  const x = tmp[0], z = tmp[1];
  // heading from a look-ahead point, smoothed
  samplePath(follow.s + 14, tmp2);
  let hx = tmp2[0] - x, hz = tmp2[1] - z;
  if (hx * hx + hz * hz < 1) { samplePath(follow.s - 14, tmp2); hx = x - tmp2[0]; hz = z - tmp2[1]; }
  const pathYaw = Math.atan2(hx, -hz);
  const g = groundHeightCubic(x, z);
  const ahead = groundHeightCubic(tmp2[0], tmp2[1]);
  const pathPitch = Math.atan2(ahead - g, Math.max(1, Math.hypot(hx, hz))) * 0.6 - 0.08;
  const k = 1 - Math.exp(-dt * 3);
  camera.yaw += wrapAngle(pathYaw + follow.yawOff - camera.yaw) * k;
  camera.pitch += (pathPitch + follow.pitchOff - camera.pitch) * k;
  camera.x = x; camera.z = z;
  camera.y += (g + follow.eye - camera.y) * (1 - Math.exp(-dt * 10));
  if (camera.y < g + 1.2) camera.y = g + 1.2;
  camera.agl = camera.y - g;
}

export function updateCamera(dt) {
  if (follow.active) { auto.mode = 0; updateFollow(dt); return; }
  if (auto.mode) {
    if (input.mdx || input.mdy || input.f || input.b || input.l || input.r || input.u || input.d || input.tl || input.tr || input.tu || input.td) auto.mode = 0;
    else { updateAuto(dt); camera.agl = camera.y - groundHeight(camera.x, camera.z); return; }
  }
  camera.yaw += input.mdx * SENS + (input.tr - input.tl) * 1.4 * dt;
  camera.pitch -= input.mdy * SENS - (input.tu - input.td) * 1.0 * dt;
  input.mdx = 0; input.mdy = 0;
  const lim = 1.55;
  camera.pitch = Math.max(-lim, Math.min(lim, camera.pitch));

  const ground = groundHeight(camera.x, camera.z);
  camera.agl = camera.y - ground;
  // speed scales with height above ground: precise near slopes, fast when high
  let speed = Math.max(12, camera.agl * 0.7) * camera.speedMul;
  if (input.fast) speed *= 4;
  if (input.slow) speed *= 0.2;

  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw), cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  const fwd = input.f - input.b, side = input.r - input.l, up = input.u - input.d;
  const tx = (sy * cp * fwd + cy * side) * speed;
  const ty = (sp * fwd + up) * speed;
  const tz = (-cy * cp * fwd + sy * side) * speed;
  const k = 1 - Math.exp(-dt * 6);
  camera.vx += (tx - camera.vx) * k;
  camera.vy += (ty - camera.vy) * k;
  camera.vz += (tz - camera.vz) * k;
  camera.x += camera.vx * dt;
  camera.y += camera.vy * dt;
  camera.z += camera.vz * dt;

  const g2 = groundHeight(camera.x, camera.z);
  if (camera.y < g2 + MIN_AGL) { camera.y = g2 + MIN_AGL; if (camera.vy < 0) camera.vy = 0; }
  if (camera.y > 30000) camera.y = 30000;
  camera.agl = camera.y - g2;
}
