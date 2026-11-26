// Terrain: nested geometry clipmap rings with CDLOD-style geomorphing, Catmull-Rom
// heightfield, procedural micro relief, slope/altitude materials, lake shading.

struct Level {
  origin: vec2f,     // world xz of grid vertex (0,0)
  spacing: f32,
  morphStart: f32,   // Chebyshev distance from camera where morphing starts / ends
  morphEnd: f32,
  _pad0: f32, _pad1: f32, _pad2: f32,
};

@group(0) @binding(2) var<storage, read> levels: array<Level>;
@group(0) @binding(3) var normalTex: texture_2d<f32>;   // (n.x, n.z, curvature, h) over ext
@group(0) @binding(4) var shadeTex: texture_2d<f32>;    // (sun vis, ao, sky view) over ext
@group(0) @binding(5) var waterTex: texture_2d<f32>;    // (water fraction, shore distance) over crop
@group(0) @binding(6) var linSamp: sampler;

const GRID: u32 = 128u;
const RELIEF_WL: f32 = 56.0;   // wavelength of the first micro-relief octave (m)

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) baseH: f32,
};

fn extUV(xz: vec2f) -> vec2f { return (xz - F.ext.xy) * F.ext.w; }
fn waterUV(xz: vec2f) -> vec2f { return ((xz - F.terr.xy) / F.terr.z + 0.5) / F.terr.w; }
fn insideUnit(uv: vec2f) -> bool { return all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)); }

fn waterAt(xz: vec2f) -> vec2f {
  let uv = waterUV(xz);
  if (!insideUnit(uv)) { return vec2f(0.0); }
  return textureSampleLevel(waterTex, linSamp, uv, 0.0).rg;
}

// Rockiness drives micro-relief amplitude (steep limestone vs. soft meadows).
fn rockiness(ny: f32, curv: f32) -> f32 {
  return smoothstep(0.80, 0.62, ny + min(curv, 0.0) * 0.04);
}
fn reliefAmp(rock: f32, water: f32) -> f32 {
  return mix(1.2, 7.0, rock) * (1.0 - smoothstep(0.05, 0.4, water));
}

@vertex
fn vsTerrain(@builtin(vertex_index) vid: u32, @builtin(instance_index) li: u32) -> VSOut {
  let L = levels[li];
  let gi = vec2f(f32(vid % (GRID + 1u)), f32(vid / (GRID + 1u)));
  var xz = L.origin + gi * L.spacing;
  let cam = F.camPos.xz;
  let cheb = max(abs(xz.x - cam.x), abs(xz.y - cam.y));
  let morph = clamp((cheb - L.morphStart) / (L.morphEnd - L.morphStart), 0.0, 1.0);
  // odd vertices slide onto their even neighbour -> exactly the next coarser grid
  let gm = gi - fract(gi * 0.5) * 2.0 * morph;
  xz = L.origin + gm * L.spacing;

  let h = heightAt(xz);
  var disp = 0.0;
  let uv = extUV(xz);
  if (insideUnit(uv)) {
    let ns = textureSampleLevel(normalTex, linSamp, uv, 0.0);
    let ny = sqrt(max(0.0, 1.0 - ns.x * ns.x - ns.y * ns.y));
    let d3 = distance(vec3f(xz.x, h, xz.y), F.camPos.xyz);
    disp = reliefD(xz, RELIEF_WL, 4, d3, 12.0).x * reliefAmp(rockiness(ny, ns.z), waterAt(xz).r) * F.misc.y;
  }
  let world = vec3f(xz.x, h + disp, xz.y);
  var o: VSOut;
  o.pos = F.viewProj * vec4f(world - F.camPos.xyz, 1.0);
  o.world = world;
  o.baseH = h;
  return o;
}

// ---------------------------------------------------------------- materials
struct Surf { albedo: vec3f, snow: f32, occl: f32, dbg: vec3f };

fn cliffNoise(p: vec3f, n: vec3f, s: f32) -> f32 {
  // project onto the cliff plane so vertical faces are not smeared
  let t = normalize(vec2f(-n.z, n.x) + vec2f(1e-4, 0.0));
  let uvCliff = vec2f(dot(p.xz, t), p.y);
  return mix(noise(p.xz / s), noise(uvCliff / s), smoothstep(0.85, 0.55, n.y));
}

// Zones are chosen on the smooth base normal `nb` (stable), detail on the lit normal `n`.
fn material(p: vec3f, nb: vec3f, n: vec3f, curv: f32, relief: f32, dist: f32) -> Surf {
  let h = p.y;
  let near = 1.0 - smoothstep(40.0, 260.0, dist);       // fine albedo detail range
  let mid = 1.0 - smoothstep(300.0, 2500.0, dist);
  let n1 = noise(p.xz / 230.0);
  let n2 = noise(p.xz / 61.0 + 17.0);
  let n3 = cliffNoise(p, nb, 9.0);
  let n4 = cliffNoise(p, nb, 2.3) * mid;
  let n5 = noise(p.xz / 0.7 + 3.0) * near;
  let northness = -nb.z;
  let slope = 1.0 - nb.y;

  // --- limestone / dolomite: pale grey, warm stains, strata bands
  let strata = sin(p.y * 0.55 + n2 * 3.0 + n3 * 1.5) * 0.5 + 0.5;
  var rock = mix(vec3f(0.17, 0.165, 0.155), vec3f(0.31, 0.30, 0.28), strata * 0.5 + n3 * 0.25 + 0.2);
  // vertical water / lichen streaks on cliffs
  let tc = normalize(vec2f(-nb.z, nb.x) + vec2f(1e-4, 0.0));
  let streak = noise(vec2f(dot(p.xz, tc) / 6.0, p.y / 90.0)) * 0.6 + noise(vec2f(dot(p.xz, tc) / 2.2, p.y / 30.0)) * 0.4 * mid;
  rock *= mix(1.0, 0.55 + 0.55 * smoothstep(-0.6, 0.6, streak), smoothstep(0.7, 0.45, nb.y));
  rock = mix(rock, vec3f(0.33, 0.28, 0.22), smoothstep(0.3, 0.8, n2) * 0.35);
  rock = mix(rock, vec3f(0.20, 0.21, 0.19), smoothstep(0.35, 0.8, -n3) * 0.4);   // lichen / wet streaks
  rock *= 0.82 + 0.2 * n4 + 0.12 * n5;

  // --- meadows: green / dry patches, multi-scale grain near the camera
  let dry = smoothstep(-0.1, 0.6, noise(p.xz / 14.0) * 0.6 + n2 * 0.4 + smoothstep(1300.0, 1900.0, h) * 0.4 - northness * 0.2);
  let lush = mix(vec3f(0.09, 0.125, 0.045), vec3f(0.125, 0.15, 0.06), n2 * 0.5 + 0.5);
  let dried = vec3f(0.15, 0.145, 0.075);
  var grass = mix(lush, dried, dry * 0.5);
  grass *= 0.8 + 0.22 * n4 + 0.25 * n5 + 0.15 * noise(p.xz / 3.1) * mid;

  // --- forest canopy (DSM already includes tree height): crowns with dark gaps
  let crowns = max(noise(p.xz / 4.6), noise(ROT * p.xz / 3.3 + 7.0));
  let gap = mix(0.75, smoothstep(-0.45, 0.45, crowns), mid);
  let forestTone = noise(p.xz / 23.0) * 0.5 + 0.5;
  var forest = mix(vec3f(0.020, 0.036, 0.015), vec3f(0.045, 0.060, 0.024), forestTone);
  forest = mix(forest, vec3f(0.040, 0.042, 0.022), smoothstep(0.2, 0.7, n1) * 0.5);   // conifer / beech mix
  forest *= mix(0.25, 1.2, gap);

  // --- weights
  let rockW = smoothstep(0.21, 0.36, slope + n1 * 0.05 + n3 * 0.05 - max(curv, 0.0) * 0.03 + max(-curv, 0.0) * 0.02);
  // limestone outcrops poking through meadows where the micro relief is high
  let outcrop = smoothstep(0.55, 0.85, relief * 0.35 + n3 * 0.35 + 0.35) * smoothstep(0.05, 0.16, slope) * smoothstep(700.0, 1100.0, h);
  let treeLine = 1500.0 + n1 * 150.0 - northness * 50.0;
  var forestW = 1.0 - smoothstep(treeLine - 90.0, treeLine + 60.0, h + n3 * 50.0);
  forestW *= smoothstep(0.03, 0.10, slope + n2 * 0.04) * smoothstep(-0.25, 0.2, n1 + n2 * 0.5 + 0.3);
  // snow (late spring): patchy, lingering in gullies and on north faces
  let snowLine = F.misc.x - northness * 250.0 + n1 * 120.0;
  var snowW = smoothstep(-0.15, 0.25, (h - snowLine) / 250.0 + curv * 0.12 + n2 * 0.35 + noise(p.xz / 17.0) * 0.2);
  snowW *= 1.0 - smoothstep(0.30, 0.50, slope - max(curv, 0.0) * 0.05);

  var c = mix(grass, forest, forestW);
  c = mix(c, rock, max(rockW, outcrop * (1.0 - forestW)));
  let snowCol = vec3f(0.72, 0.75, 0.80) * (0.92 + 0.08 * n5);
  c = mix(c, snowCol, snowW);
  // valley floors: fields / built-up patches (city detail out of scope for now)
  let lowW = (1.0 - smoothstep(260.0, 380.0, h)) * (1.0 - smoothstep(0.04, 0.12, slope)) * (1.0 - snowW);
  let fields = mix(vec3f(0.10, 0.14, 0.055), vec3f(0.17, 0.165, 0.12), smoothstep(0.2, 0.8, noise(p.xz / 90.0)) * 0.6);
  c = mix(c, fields, lowW * 0.6);

  var s: Surf;
  s.albedo = c;
  s.snow = snowW;
  s.occl = mix(1.0, mix(0.4, 1.0, gap), forestW * (1.0 - rockW));
  s.dbg = vec3f(max(rockW, outcrop), forestW, snowW);
  return s;
}

fn waterNormal(xz: vec2f, t: f32, dist: f32) -> vec3f {
  let k = 1.0 - smoothstep(200.0, 4000.0, dist);
  let a = noised(xz / 9.0 + vec2f(t * 0.13, t * 0.07)).yz / 9.0;
  let b = noised(ROT * xz / 3.1 - vec2f(t * 0.21, -t * 0.17)).yz / 3.1;
  let c = noised(xz / 41.0 + vec2f(-t * 0.04, t * 0.05)).yz / 41.0;
  let g = (a * 0.35 + b * 0.12 * k + c * 1.4) * mix(0.15, 1.0, k);
  return normalize(vec3f(-g.x, 1.0, -g.y));
}

@fragment
fn fsTerrain(in: VSOut) -> @location(0) vec4f {
  let p = in.world;
  // geometric normal (only used outside the precomputed region); uniform control flow
  var geoN = normalize(cross(dpdy(p), dpdx(p)));
  geoN = select(geoN, -geoN, geoN.y < 0.0);

  let toCam = F.camPos.xyz - p;
  let dist = length(toCam);
  let V = toCam / max(dist, 1e-3);
  let Ls = F.sunDir.xyz;

  var nBase = geoN;
  var curv = 0.0;
  var sunVis = 1.0;
  var ao = 1.0;
  var skyView = 1.0;
  let uv = extUV(p.xz);
  if (insideUnit(uv)) {
    let ns = textureSampleLevel(normalTex, linSamp, uv, 0.0);
    nBase = vec3f(ns.x, sqrt(max(0.0, 1.0 - ns.x * ns.x - ns.y * ns.y)), ns.y);
    curv = ns.z;
    let sh = textureSampleLevel(shadeTex, linSamp, uv, 0.0);
    sunVis = sh.r; ao = sh.g; skyView = sh.b;
  }
  let w = waterAt(p.xz);
  let water = smoothstep(0.35, 0.65, w.r);

  // micro relief normal: same function/amplitude as the vertex displacement, plus finer octaves
  let rock = rockiness(nBase.y, curv);
  let amp = reliefAmp(rock, w.r) * F.misc.y;
  let rd = reliefD(p.xz, RELIEF_WL, 8, dist, 60.0);
  let gBase = -nBase.xz / max(nBase.y, 0.05);
  let g = gBase + rd.yz * amp;
  let n = normalize(vec3f(-g.x, 1.0, -g.y));
  // small-scale cavity term from relief + curvature
  let cavity = clamp(0.8 + rd.x * 0.25 * rock - max(curv, 0.0) * 0.03, 0.5, 1.0);

  let surf = material(p, nBase, n, curv, rd.x, dist);
  let ndl = max(dot(n, Ls), 0.0);
  // wrap a little on snow (subsurface-ish), sharper on rock
  let diff = mix(ndl, max((dot(n, Ls) + 0.25) / 1.25, 0.0), surf.snow * 0.6);
  let sun = F.sunColor.rgb * diff * sunVis;
  let skyAmb = skyRadiance(normalize(vec3f(n.x * 0.5, 1.0, n.z * 0.5))) * 0.55 * skyView;
  let bounce = vec3f(0.10, 0.11, 0.07) * (0.5 - 0.5 * n.y) * F.sunColor.rgb * 0.5;
  var col = surf.albedo * (sun * mix(1.0, surf.occl, 0.5) + (skyAmb * (0.6 + 0.4 * n.y) + bounce) * ao * cavity * surf.occl);
  // snow sheen
  let Hh = normalize(Ls + V);
  col += F.sunColor.rgb * surf.snow * 0.05 * pow(max(dot(n, Hh), 0.0), 24.0) * sunVis;

  if (water > 0.0) {
    let t = F.camPos.w;
    let wn = waterNormal(p.xz, t, dist);
    let R = reflect(-V, wn);
    let cosV = max(dot(wn, V), 0.0);
    let fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
    var refl = skyRadiance(vec3f(R.x, abs(R.y), R.z));
    // the surrounding mountains darken the reflection near the shore (no true reflection yet)
    refl *= mix(0.55, 1.0, smoothstep(0.0, 0.5, w.g)) * mix(0.6, 1.0, skyView);
    let deep = vec3f(0.006, 0.020, 0.026);
    let shallow = vec3f(0.025, 0.055, 0.050);
    let body = mix(shallow, deep, smoothstep(0.0, 0.25, w.g));
    let wAmb = skyRadiance(vec3f(0.0, 1.0, 0.0)) * 0.5 * ao;
    var wc = body * (wAmb + F.sunColor.rgb * max(Ls.y, 0.0) * sunVis * 0.6) * (1.0 - fres) + refl * fres;
    let spec = pow(max(dot(R, Ls), 0.0), 900.0) * 60.0 + pow(max(dot(R, Ls), 0.0), 90.0) * 0.6;
    wc += F.sunColor.rgb * spec * sunVis;
    col = mix(col, wc, water);
  }

  if (F.misc.z > 0.5) { col = surf.dbg * (0.3 + 0.7 * ndl); }
  col = applyFog(col, p);
  return tonemap(col, in.pos.xy);
}
