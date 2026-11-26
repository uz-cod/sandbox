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
// OSM features (see src/osm-data.js): trail segments (a.xy, b.xy) followed by pads
// (2 x vec4: centre, cos, sin | half size u, half size w, base height, margin);
// cells = CSR grid: [cellCount + 1 start offsets | items]; item high bit = pad.
@group(0) @binding(7) var<storage, read> segs: array<vec4f>;
@group(0) @binding(8) var<storage, read> segAttr: array<u32>;
@group(0) @binding(9) var<storage, read> cells: array<u32>;

struct Feat { edge: f32, center: f32, halfW: f32, attr: u32, padW: f32, padH: f32, hlD: f32, hlAttr: u32 };

fn features(xz: vec2f, wantTrails: bool) -> Feat {
  var f: Feat;
  f.edge = 1e9; f.center = 1e9; f.halfW = 0.0; f.attr = 0u; f.padW = 0.0; f.padH = 0.0; f.hlD = 1e9; f.hlAttr = 0u;
  let sel = u32(F.misc.w);
  let g = (xz - F.grid.xy) / F.grid.z;
  let n = F.grid.w;
  if (g.x < 0.0 || g.y < 0.0 || g.x >= n || g.y >= n) { return f; }
  let c = u32(g.y) * u32(n) + u32(g.x);
  let a = cells[c];
  let b = min(cells[c + 1u], a + 160u);
  for (var i = a; i < b; i++) {
    let it = cells[i];
    if ((it & 0x80000000u) != 0u) {
      let k = it & 0x7fffffffu;
      let p0 = segs[k];
      let p1 = segs[k + 1u];
      let d = xz - p0.xy;
      let local = vec2f(d.x * p0.z + d.y * p0.w, -d.x * p0.w + d.y * p0.z);
      let q = abs(local) - p1.xy;
      let outside = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
      let w = 1.0 - smoothstep(0.0, p1.w, outside);
      if (w > f.padW) { f.padW = w; f.padH = p1.z; }
    } else if (wantTrails) {
      let at = segAttr[it];
      let isHL = (at & 256u) != 0u;
      if (isHL && ((at >> 16u) & sel) == 0u) { continue; }   // itinerary of a summit not selected
      let s = segs[it];
      let pa = xz - s.xy;
      let ba = s.zw - s.xy;
      let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
      let dc = length(pa - ba * h);
      if (isHL) {
        if (dc < f.hlD) { f.hlD = dc; f.hlAttr = at; }
      } else {
        let hw = f32(at >> 16u) * 0.001;
        let e = dc - hw;
        if (e < f.edge) { f.edge = e; f.center = dc; f.halfW = hw; f.attr = at; }
      }
    }
  }
  return f;
}

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

  var h = heightAt(xz);
  var disp = 0.0;
  let uv = extUV(xz);
  if (insideUnit(uv)) {
    let ns = textureSampleLevel(normalTex, linSamp, uv, 0.0);
    let ny = sqrt(max(0.0, 1.0 - ns.x * ns.x - ns.y * ns.y));
    let d3 = distance(vec3f(xz.x, h, xz.y), F.camPos.xyz);
    disp = reliefD(xz, RELIEF_WL, 4, d3, 12.0).x * reliefAmp(rockiness(ny, ns.z), waterAt(xz).r) * F.misc.y;
    if (d3 < 5000.0) {
      let ft = features(xz, L.spacing < 17.0);
      h = mix(h, ft.padH, ft.padW);                       // building / cross pads
      let trailW = 1.0 - smoothstep(0.0, 1.5, ft.edge);   // trails are smooth, slightly sunk
      disp *= 1.0 - max(ft.padW, trailW);
      h -= 0.15 * trailW;
    }
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
  // strata bands fade out before they alias
  let strata = mix(0.5, sin(p.y * 0.55 + n2 * 3.0 + n3 * 1.5) * 0.5 + 0.5, 1.0 - smoothstep(250.0, 1200.0, dist));
  var rock = mix(vec3f(0.17, 0.165, 0.155), vec3f(0.31, 0.30, 0.28), strata * 0.5 + n3 * 0.25 + 0.2);
  // vertical water / lichen streaks on cliffs
  let tc = normalize(vec2f(-nb.z, nb.x) + vec2f(1e-4, 0.0));
  let streak = noise(vec2f(dot(p.xz, tc) / 6.0, p.y / 90.0)) * 0.6 * (1.0 - smoothstep(1500.0, 5000.0, dist)) + noise(vec2f(dot(p.xz, tc) / 2.2, p.y / 30.0)) * 0.4 * (1.0 - smoothstep(150.0, 700.0, dist));
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
  var n = normalize(vec3f(-g.x, 1.0, -g.y));
  // small-scale cavity term from relief + curvature
  let cavity = clamp(0.8 + rd.x * 0.25 * rock - max(curv, 0.0) * 0.03, 0.5, 1.0);

  let surf = material(p, nBase, n, curv, rd.x, dist);
  var albedo = surf.albedo;
  var hlCol = vec3f(0.0);
  var hlA = 0.0;
  let pfx = dist * 1.155 * F.screen.w;                 // pixel footprint (m)
  let featRange = select(6000.0, 22000.0, F.misc.w > 0.5);
  if (dist < featRange && water < 0.5) {
    let ft = features(p.xz, true);
    if (ft.hlD < 1e8) {
      // selected summit's itineraries: ~3 px wide line with a dark outline, coloured by difficulty
      let core = clamp(pfx * 1.4, 0.7, 30.0);
      let outl = core + clamp(pfx * 1.0, 0.25, 12.0);
      let aa = pfx * 0.6;
      let d = (ft.hlAttr >> 9u) & 7u;
      var c = vec3f(0.75);
      if (d == 1u) { c = vec3f(0.30, 0.80, 0.40); }
      if (d == 2u) { c = vec3f(1.0, 0.72, 0.15); }
      if (d == 3u) { c = vec3f(0.95, 0.27, 0.20); }
      if (d == 4u) { c = vec3f(0.70, 0.40, 1.0); }
      let inCore = 1.0 - smoothstep(core - aa, core + aa, ft.hlD);
      let inOut = 1.0 - smoothstep(outl - aa, outl + aa, ft.hlD);
      hlCol = mix(vec3f(0.02, 0.02, 0.02), c, inCore / max(inOut, 1e-3));
      hlA = inOut * 0.92 * smoothstep(30.0, 140.0, dist);   // near the eye the real trail shows
    }
    if (dist < 6000.0) {
    if (ft.padW > 0.0) {
      n = normalize(mix(n, vec3f(0.0, 1.0, 0.0), ft.padW));
      albedo = mix(albedo, vec3f(0.24, 0.22, 0.19) * (0.85 + 0.3 * noise(p.xz / 0.8)), smoothstep(0.6, 1.0, ft.padW) * 0.7 * (1.0 - surf.snow));
    }
    let pf = pfx;
    if (ft.edge < 1.6 + pf) {
      let hw = ft.halfW;
      let hwe = max(hw, pf * 0.55);                    // keep sub-pixel trails visible, energy-preserving
      let cov = hw / hwe * mix(1.0, 0.55, smoothstep(250.0, 2500.0, dist));
      let aa = pf * 0.5 + 0.06;
      // irregular edges: grass encroaching, wider worn patches
      let wob = (noise(p.xz / 1.6) * 0.22 + noise(p.xz / 0.45) * 0.08) * (1.0 - smoothstep(20.0, 150.0, dist));
      let dcen = ft.center + wob;
      let m = (1.0 - smoothstep(hwe - aa, hwe + aa, dcen)) * cov;
      let border = (1.0 - smoothstep(hw, hw + 1.2, dcen)) * (1.0 - smoothstep(40.0, 400.0, dist));
      let cls = ft.attr & 15u;
      let grain = noise(p.xz / 0.9) * 0.5 + 0.5;
      // packed earth with limestone gravel; stones and darker damp patches up close
      var pc = mix(vec3f(0.14, 0.115, 0.085), vec3f(0.25, 0.23, 0.20), clamp(grain * 0.6 + rock * 0.5, 0.0, 1.0));
      let near = 1.0 - smoothstep(8.0, 50.0, dist);
      pc *= 0.8 + 0.35 * noise(p.xz / 0.22) * near;
      pc = mix(pc, vec3f(0.29, 0.28, 0.26), smoothstep(0.6, 0.85, noise(ROT * p.xz / 0.3 + 9.0)) * near * 0.5);
      pc = mix(pc, pc * 0.6, smoothstep(0.3, 0.7, noise(p.xz / 3.5 + 4.0)) * 0.4);
      if (cls == 2u) {                                // track: grassy strip between the ruts
        pc = mix(pc, albedo * 0.95, (1.0 - smoothstep(0.2, 0.42, dcen)) * 0.85);
      }
      if (cls == 3u) { pc = vec3f(0.34, 0.33, 0.31) * (0.9 + 0.2 * grain); }
      let keep = 1.0 - surf.snow * 0.75;
      albedo = mix(albedo, albedo * vec3f(0.92, 0.85, 0.74), border * 0.55 * keep);
      albedo = mix(albedo, pc, m * keep);
      n = normalize(mix(n, nBase, m * 0.8));
    }
    }
  }
  let ndl = max(dot(n, Ls), 0.0);
  // wrap a little on snow (subsurface-ish), sharper on rock
  let diff = mix(ndl, max((dot(n, Ls) + 0.25) / 1.25, 0.0), surf.snow * 0.6);
  let sun = F.sunColor.rgb * diff * sunVis;
  let skyAmb = skyRadiance(normalize(vec3f(n.x * 0.5, 1.0, n.z * 0.5))) * 0.55 * skyView;
  let bounce = vec3f(0.10, 0.11, 0.07) * (0.5 - 0.5 * n.y) * F.sunColor.rgb * 0.5;
  var col = albedo * (sun * mix(1.0, surf.occl, 0.5) + (skyAmb * (0.6 + 0.4 * n.y) + bounce) * ao * cavity * surf.occl);
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
  if (hlA > 0.0) {
    // itinerary overlay: lit softly, only partly fogged so it reads from far away
    let lit = hlCol * (1.1 + 0.9 * ndl * sunVis);
    col = mix(col, mix(lit, applyFog(lit, p), 0.35), hlA);
  }
  return tonemap(col, in.pos.xy);
}
