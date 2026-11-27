// Tree scattering (compute, every frame): world-anchored jittered grid around the camera,
// density from zoneWeights() (same rule as the terrain's forest material), trails / huts /
// water kept clear, frustum culled, appended to instance regions with atomic counters that are
// also the instanceCount of the indirect draws.
//   near: 4 m cells within 300 m -> 3D meshes (conifer / broadleaf regions)
//   far: 12 m cells 240 m .. 2.7 km -> billboards

@group(0) @binding(3) var normalTexT: texture_2d<f32>;
@group(0) @binding(5) var waterTexT: texture_2d<f32>;
@group(0) @binding(6) var linSampT: sampler;
@group(0) @binding(12) var landTexT: texture_2d<f32>;

struct Tree { pos: vec4f, info: vec4f };          // xyz base, height | type, hue, rotation, fade
@group(0) @binding(10) var<storage, read_write> trees: array<Tree>;
@group(0) @binding(11) var<storage, read_write> args: array<atomic<u32>, 16>;  // 4 x drawIndirect args

const NEAR_CELL: f32 = 4.0;
const NEAR_R: f32 = 300.0;
const NEAR_SIDE: u32 = 150u;          // 2 * NEAR_R / NEAR_CELL
const FAR_CELL: f32 = 12.0;
const FAR_R: f32 = 2700.0;
const FAR_SIDE: u32 = 450u;           // 2 * FAR_R / FAR_CELL
const FADE0: f32 = 240.0;             // near -> far cross-fade band
const FADE1: f32 = 300.0;
const NEAR_MAX: u32 = 30000u;         // per type
const FAR_MAX: u32 = 200000u;
const SINK: f32 = 0.45;
const HOUSE_CELL: f32 = 14.0;
const HOUSE_R: f32 = 4000.0;
const HOUSE_SIDE: u32 = 572u;         // 2 * HOUSE_R / HOUSE_CELL
const HOUSE_MAX: u32 = 120000u;               // the DSM already contains the canopy: plant trees partly "in" it

fn h2(c: vec2f, k: f32) -> f32 { return hash2(c * 1.37 + vec2f(k * 17.3, k * 5.1)) * 0.5 + 0.5; }
fn landT(xz: vec2f) -> vec2f {
  let wuv = ((xz - F.terr.xy) / F.terr.z + 0.5) / F.terr.w;
  if (any(wuv < vec2f(0.0)) || any(wuv > vec2f(1.0))) { return vec2f(0.0); }
  return textureSampleLevel(landTexT, linSampT, wuv, 0.0).rg;
}
fn waterUrban(xz: vec2f) -> vec3f {
  let wuv = ((xz - F.terr.xy) / F.terr.z + 0.5) / F.terr.w;
  if (any(wuv < vec2f(0.0)) || any(wuv > vec2f(1.0))) { return vec3f(0.0); }
  return textureSampleLevel(waterTexT, linSampT, wuv, 0.0).rgb;
}

// Returns tree (pos, info) or pos.w < 0 if no tree in this cell.
fn plant(cellXZ: vec2f, cell: f32, near: bool) -> Tree {
  var t: Tree;
  t.pos = vec4f(0.0, 0.0, 0.0, -1.0);
  let jit = vec2f(h2(cellXZ, 1.0), h2(cellXZ, 2.0));
  let xz = (cellXZ + 0.1 + jit * 0.8) * cell;
  let d = distance(xz, F.camPos.xz);
  if (near && d > FADE1) { return t; }
  if (!near && (d < FADE0 || d > FAR_R)) { return t; }
  let uv = (xz - F.ext.xy) * F.ext.w;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return t; }
  let ns = textureSampleLevel(normalTexT, linSampT, uv, 0.0);
  let nb = vec3f(ns.x, sqrt(max(0.0, 1.0 - ns.x * ns.x - ns.y * ns.y)), ns.y);
  var h: f32;
  if (near) { h = heightAt(xz); } else { h = heightFast(xz); }
  let zw = zoneWeights(vec3f(xz.x, h, xz.y), nb, ns.z);
  let wu = waterUrban(xz);
  // towns have no forest, except their parks (scattered park trees)
  let townW = urbanWeight(vec3f(xz.x, h, xz.y), nb, wu.b);
  let park = parkWeight(landT(xz).g) * smoothstep(0.05, 0.3, townW + landT(xz).g);
  let w = max(zw.x * (1.0 - zw.y) * (1.0 - zw.z) * (1.0 - smoothstep(0.15, 0.4, townW)), park * 0.35);
  if (h2(cellXZ, 3.0) > w * 0.9) { return t; }
  if (wu.r > 0.2) { return t; }
  let ft = features(xz, true);
  if (ft.padW > 0.0 || ft.edge < select(4.5, 2.2, near)) { return t; }

  // species and size: conifers higher up and on north slopes
  let pc = smoothstep(850.0, 1450.0, h) * 0.75 + (-nb.z) * 0.2 + (h2(cellXZ, 4.0) - 0.5) * 0.5 + noise(xz / 180.0) * 0.25;
  let conifer = select(0.0, 1.0, pc > 0.45);
  let hl = 1.0 - 0.45 * smoothstep(1250.0, 1600.0, h);           // smaller near the tree line
  var H = mix(13.0, 24.0, h2(cellXZ, 5.0)) * (0.65 + 0.35 * w) * hl;
  H *= select(1.0, 1.12, conifer > 0.5);
  if (!near) { H *= 1.15; }

  // frustum: bounding sphere of the tree in clip space
  let c = F.viewProj * vec4f(vec3f(xz.x, h + H * (0.5 - SINK), xz.y) - F.camPos.xyz, 1.0);
  let r = H * 0.9;
  if (c.w < -r || abs(c.x) > c.w * 1.05 + r * 1.8 || c.y > c.w * 1.05 + r * 1.8 || c.y < -c.w * 1.05 - r * 1.8) { return t; }

  var fade = 1.0;
  if (near) { fade = 1.0 - smoothstep(FADE0, FADE1, d); }
  else { fade = smoothstep(FADE0, FADE1, d) * (1.0 - smoothstep(FAR_R - 500.0, FAR_R, d)); }
  t.pos = vec4f(xz.x, h - SINK * H, xz.y, H);
  t.info = vec4f(conifer, h2(cellXZ, 6.0), h2(cellXZ, 7.0) * 6.2832, fade);
  return t;
}

@compute @workgroup_size(8, 8)
fn csNear(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= NEAR_SIDE || id.y >= NEAR_SIDE) { return; }
  let base = floor(F.camPos.xz / NEAR_CELL) - f32(NEAR_SIDE / 2u);
  let t = plant(base + vec2f(id.xy), NEAR_CELL, true);
  if (t.pos.w < 0.0) { return; }
  let k = u32(t.info.x);                          // 0 broadleaf, 1 conifer
  let i = atomicAdd(&args[k * 4u + 1u], 1u);
  if (i < NEAR_MAX) { trees[k * NEAR_MAX + i] = t; }
}

@compute @workgroup_size(8, 8)
fn csFar(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= FAR_SIDE || id.y >= FAR_SIDE) { return; }
  let base = floor(F.camPos.xz / FAR_CELL) - f32(FAR_SIDE / 2u);
  let t = plant(base + vec2f(id.xy), FAR_CELL, false);
  if (t.pos.w < 0.0) { return; }
  let i = atomicAdd(&args[9u], 1u);
  if (i < FAR_MAX) { trees[2u * NEAR_MAX + i] = t; }
}

// Houses: same buffer, after the tree regions. pos = (x, base, z, height), info = (length, width, angle, colour seed)
@compute @workgroup_size(8, 8)
fn csHouses(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= HOUSE_SIDE || id.y >= HOUSE_SIDE) { return; }
  let cellXZ = floor(F.camPos.xz / HOUSE_CELL) - f32(HOUSE_SIDE / 2u) + vec2f(id.xy);
  let xz = (cellXZ + 0.25 + vec2f(h2(cellXZ, 11.0), h2(cellXZ, 12.0)) * 0.5) * HOUSE_CELL;
  let d = distance(xz, F.camPos.xz);
  if (d > HOUSE_R) { return; }
  let uv = (xz - F.ext.xy) * F.ext.w;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return; }
  let ns = textureSampleLevel(normalTexT, linSampT, uv, 0.0);
  let nb = vec3f(ns.x, sqrt(max(0.0, 1.0 - ns.x * ns.x - ns.y * ns.y)), ns.y);
  let h = heightFast(xz);
  let wu = waterUrban(xz);
  if (wu.r > 0.05) { return; }
  let u = urbanWeight(vec3f(xz.x, h, xz.y), nb, wu.b);
  let land = landT(xz);
  if (parkWeight(land.g) > 0.5) { return; }                              // parks, gardens, pitches stay open
  let ind = industryWeight(land.r, nb.y);
  if (ind > 0.5) {
    // industrial estate: one large shed per 4x4 block of cells
    if (u32(cellXZ.x) % 4u != 0u || u32(cellXZ.y) % 4u != 0u) { return; }
    let cxz = (cellXZ + 2.0) * HOUSE_CELL;
    let ft2 = features(cxz, true);
    if (ft2.padW > 0.0 || ft2.edge < 8.0) { return; }
    let wu2 = waterUrban(cxz);
    if (wu2.r > 0.02) { return; }
    let hb = heightFast(cxz);
    let Ls = mix(32.0, 52.0, h2(cellXZ, 21.0));
    let Ws = mix(18.0, 34.0, h2(cellXZ, 22.0));
    let Hs = mix(7.0, 12.0, h2(cellXZ, 23.0));
    let cc = F.viewProj * vec4f(vec3f(cxz.x, hb + Hs * 0.5, cxz.y) - F.camPos.xyz, 1.0);
    if (cc.w < -Ls || abs(cc.x) > cc.w * 1.05 + Ls * 1.8 || abs(cc.y) > cc.w * 1.05 + Ls * 1.8) { return; }
    let k = atomicAdd(&args[13u], 1u);
    if (k < HOUSE_MAX) {
      var sh: Tree;
      sh.pos = vec4f(cxz.x, hb - 3.0, cxz.y, Hs + 3.0);
      // negative w marks a shed (flat roof, panel walls)
      sh.info = vec4f(Ls, Ws, noise(cxz / 650.0) * 3.1416, -(h2(cellXZ, 24.0) + (1.0 - smoothstep(HOUSE_R - 600.0, HOUSE_R, d)) * 2.0 + 0.001));
      trees[2u * NEAR_MAX + FAR_MAX + k] = sh;
    }
    return;
  }
  if (h2(cellXZ, 13.0) > smoothstep(0.05, 0.6, u) * 0.95) { return; }   // dense in town, thinning at the edges
  let ft = features(xz, true);
  if (ft.padW > 0.0 || ft.edge < 5.0) { return; }
  let lecco = smoothstep(0.6, 1.0, u);                 // town centres: bigger, taller blocks
  let L = mix(8.0, 15.0, h2(cellXZ, 14.0)) * (1.0 + lecco * 0.5);
  let W = mix(6.0, 9.5, h2(cellXZ, 15.0));
  let floors = floor(mix(2.0, 3.99, h2(cellXZ, 16.0)) + lecco * h2(cellXZ, 17.0) * 3.0);
  let H = floors * 3.0 + 0.6;
  // streets: houses in a neighbourhood share an orientation
  let ang = noise(xz / 650.0) * 3.1416 + select(0.0, 1.5708, h2(cellXZ, 18.0) > 0.8);
  // streets: a loose grid in the local orientation, plus a few open spaces
  let a0 = noise(xz / 650.0) * 3.1416;
  let sq = vec2f(xz.x * cos(a0) + xz.y * sin(a0), -xz.x * sin(a0) + xz.y * cos(a0));
  let st = fract(sq / vec2f(58.0, 74.0));
  if (min(min(st.x, 1.0 - st.x), min(st.y, 1.0 - st.y)) < 0.12) { return; }
  if (noise(xz / 140.0 + 3.0) > 0.62) { return; }
  let c = F.viewProj * vec4f(vec3f(xz.x, h + H * 0.5, xz.y) - F.camPos.xyz, 1.0);
  let r = L;
  if (c.w < -r || abs(c.x) > c.w * 1.05 + r * 1.8 || abs(c.y) > c.w * 1.05 + r * 1.8) { return; }
  let i = atomicAdd(&args[13u], 1u);
  if (i < HOUSE_MAX) {
    var t: Tree;
    t.pos = vec4f(xz.x, h - 3.0, xz.y, H + 3.0);      // the DSM already holds the roofs: start below it
    t.info = vec4f(L, W, ang, h2(cellXZ, 19.0) + (1.0 - smoothstep(HOUSE_R - 600.0, HOUSE_R, d)) * 2.0);
    trees[2u * NEAR_MAX + FAR_MAX + i] = t;
  }
}

@compute @workgroup_size(1)
fn csClamp() {
  atomicMin(&args[13u], HOUSE_MAX);
  // counters may overshoot the regions: clamp the instance counts used by drawIndirect
  atomicMin(&args[1u], NEAR_MAX);
  atomicMin(&args[5u], NEAR_MAX);
  atomicMin(&args[9u], FAR_MAX);
}
