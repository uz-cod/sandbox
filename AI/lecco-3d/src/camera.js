// Free-flying camera. Input handlers only write into preallocated state; update() reads it.
import { groundHeight } from './terrain-data.js';

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
  window.addEventListener('keydown', (e) => { if (setKey(e.code, 1)) e.preventDefault(); });
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

export function placeCamera(x, y, z, yaw, pitch) {
  camera.x = x; camera.y = y; camera.z = z;
  camera.yaw = yaw; camera.pitch = pitch;
  camera.vx = camera.vy = camera.vz = 0;
}

export function updateCamera(dt) {
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
