// Huts, bivouacs and crosses (static mesh from src/osm-data.js), procedural materials.

@group(0) @binding(2) var shadeTexB: texture_2d<f32>;
@group(0) @binding(3) var linSampB: sampler;

struct BIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) uv: vec2f,      // along-wall metres, height above building base
  @location(3) mat: vec2f,     // material id, wall length
};
struct BOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) nrm: vec3f,
  @location(2) uv: vec2f,
  @location(3) @interpolate(flat) mat: vec2f,
};

@vertex
fn vsBuild(v: BIn) -> BOut {
  var o: BOut;
  o.pos = F.viewProj * vec4f(v.pos - F.camPos.xyz, 1.0);
  o.world = v.pos;
  o.nrm = v.nrm;
  o.uv = v.uv;
  o.mat = v.mat;
  return o;
}

fn hash1(p: vec2f) -> f32 { return hash2(p) * 0.5 + 0.5; }

struct BSurf { albedo: vec3f, spec: f32, glass: f32 };

fn stoneWall(uv: vec2f, seed: f32) -> vec3f {
  let rowH = 0.32;
  let row = floor(uv.y / rowH);
  let off = select(0.0, 0.31, fract(row * 0.5) > 0.25);
  let bw = 0.55 + 0.25 * hash1(vec2f(row, seed));
  let col = floor((uv.x + off) / bw);
  let fu = fract((uv.x + off) / bw);
  let fv = fract(uv.y / rowH);
  let mortar = 1.0 - smoothstep(0.0, 0.06, min(min(fu, 1.0 - fu) * bw, min(fv, 1.0 - fv) * rowH));
  let tone = hash1(vec2f(col, row) + seed * 7.0);
  var c = mix(vec3f(0.30, 0.29, 0.27), vec3f(0.46, 0.43, 0.38), tone);
  c = mix(c, vec3f(0.38, 0.33, 0.27), step(0.8, hash1(vec2f(col * 3.1, row) + seed)) * 0.6);
  return mix(c, vec3f(0.55, 0.53, 0.49), mortar * 0.6);
}

fn buildingSurf(i: BOut) -> BSurf {
  let id = u32(i.mat.x + 0.5);
  let L = i.mat.y;
  let uv = i.uv;
  let seed = floor(i.world.x * 0.05) + floor(i.world.z * 0.05) * 17.0;
  var s: BSurf;
  s.spec = 0.0; s.glass = 0.0;
  switch id {
    case 0u: {   // stone walls with windows and shutters
      s.albedo = stoneWall(uv, seed);
      if (L > 3.0 && uv.y > 0.0) {
        let floorY = uv.y - floor(uv.y / 2.9) * 2.9;
        let nwin = max(1.0, floor((L - 1.6) / 2.6));
        let span = (L - 1.6) / nwin;
        let lx = uv.x - 0.8 - span * (floor((uv.x - 0.8) / span) + 0.5);
        let inRange = uv.x > 0.8 && uv.x < L - 0.8;
        let win = inRange && abs(lx) < 0.42 && floorY > 0.95 && floorY < 2.05;
        let shutter = inRange && abs(lx) >= 0.42 && abs(lx) < 0.85 && floorY > 0.95 && floorY < 2.05;
        let frameW = inRange && abs(lx) < 0.5 && floorY > 0.88 && floorY < 2.12;
        let shutCol = select(vec3f(0.10, 0.20, 0.10), vec3f(0.30, 0.16, 0.08), hash1(vec2f(seed, 3.0)) > 0.5);
        if (frameW) { s.albedo = vec3f(0.55, 0.53, 0.50); }
        if (shutter) { s.albedo = shutCol * (0.85 + 0.15 * step(0.5, fract(floorY * 9.0))); }
        if (win) { s.albedo = vec3f(0.02, 0.025, 0.03); s.glass = 1.0; }
      }
    }
    case 1u, 7u: {   // timber gables: vertical planks
      let plank = floor(uv.x / 0.18);
      s.albedo = vec3f(0.22, 0.13, 0.07) * (0.75 + 0.35 * hash1(vec2f(plank, seed)));
      s.albedo *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.015, abs(fract(uv.x / 0.18) - 0.5) - 0.48));
    }
    case 2u: {   // stone-slab / dark sheet roof
      let row = floor(uv.y / 0.35);
      s.albedo = vec3f(0.11, 0.11, 0.115) * (0.8 + 0.35 * hash1(vec2f(floor(uv.x / 0.5 + row * 0.5), row)));
      s.spec = 0.15;
    }
    case 3u: {   // bivouac: red sheet metal with vertical ribs
      let rib = smoothstep(0.42, 0.5, abs(fract(uv.x / 0.3) - 0.5));
      s.albedo = mix(vec3f(0.42, 0.06, 0.04), vec3f(0.30, 0.04, 0.03), rib);
      s.spec = 0.3;
      // small door on the first long side
      if (L > 2.5 && uv.x > L * 0.5 - 0.4 && uv.x < L * 0.5 + 0.4 && uv.y > 0.0 && uv.y < 1.8) { s.albedo = vec3f(0.30, 0.30, 0.30); }
    }
    case 4u: { s.albedo = vec3f(0.07, 0.07, 0.075); s.spec = 0.5; }            // iron
    case 5u: { s.albedo = vec3f(0.38, 0.37, 0.35) * (0.85 + 0.3 * noise(uv * 4.0)); }  // concrete / stone base
    default: {   // grey metal roof
      let rib = smoothstep(0.4, 0.5, abs(fract(uv.x / 0.4) - 0.5));
      s.albedo = mix(vec3f(0.30, 0.31, 0.32), vec3f(0.20, 0.21, 0.22), rib);
      s.spec = 0.4;
    }
  }
  return s;
}

@fragment
fn fsBuild(i: BOut) -> @location(0) vec4f {
  let p = i.world;
  let n = normalize(i.nrm);
  let toCam = F.camPos.xyz - p;
  let dist = length(toCam);
  let V = toCam / max(dist, 1e-3);
  let Ls = F.sunDir.xyz;
  var sunVis = 1.0; var ao = 1.0;
  let uv = (p.xz - F.ext.xy) * F.ext.w;
  if (all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))) {
    let sh = textureSampleLevel(shadeTexB, linSampB, uv, 0.0);
    sunVis = sh.r; ao = mix(sh.g, 1.0, 0.4);
  }
  let s = buildingSurf(i);
  // contact darkening near the ground
  let grounded = mix(0.55, 1.0, smoothstep(-0.2, 1.2, i.uv.y));
  let ndl = max(dot(n, Ls), 0.0);
  // ambient: sky from above, warm-green bounce from the sunlit slopes for walls / shaded faces
  let sky = skyRadiance(normalize(vec3f(n.x * 0.5, 1.0, n.z * 0.5))) * 0.45;
  let bounce = vec3f(0.13, 0.13, 0.085) * F.sunColor.rgb * (0.35 + 0.65 * sunVis);
  let amb = sky * (0.45 + 0.55 * max(n.y, 0.0)) + bounce * (1.0 - 0.6 * max(n.y, 0.0));
  var col = s.albedo * (F.sunColor.rgb * ndl * sunVis + amb * ao * grounded);
  let Hh = normalize(Ls + V);
  col += F.sunColor.rgb * s.spec * 0.25 * pow(max(dot(n, Hh), 0.0), 40.0) * sunVis;
  if (s.glass > 0.0) {
    let R = reflect(-V, n);
    let fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    col = mix(col, skyRadiance(vec3f(R.x, abs(R.y), R.z)) * 0.6, fres);
  }
  col = applyFog(col, p);
  return tonemap(col, i.pos.xy);
}
