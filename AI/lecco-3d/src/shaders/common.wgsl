// Shared declarations: frame uniforms, heightfield sampling, noise, sky, fog, tonemap.
// World frame: x = east, y = up (metres a.s.l.), z = south. Origin = crop centre.

struct Frame {
  viewProj: mat4x4f,     // camera-relative (rotation + projection, no translation)
  invViewProj: mat4x4f,
  camPos: vec4f,         // xyz camera position, w = time (s)
  sunDir: vec4f,         // xyz unit vector towards the sun
  sunColor: vec4f,       // rgb radiance
  terr: vec4f,           // heightfield origin x, origin z, spacing, samples
  ext: vec4f,            // precomputed-texture region origin x, origin z, size (m), 1/size
  screen: vec4f,         // width, height, 1/width, 1/height
  fog: vec4f,            // density at 200 m, height falloff, exposure, detail strength
  misc: vec4f,           // snow line, relief scale, debug view, unused
  grid: vec4f,           // OSM feature grid: origin x, origin z, cell size, cells per side
};

@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var heightTex: texture_2d<f32>;

// ---------------------------------------------------------------- hashing / noise
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn hash2(p: vec2f) -> f32 {           // lattice hash in [-1, 1]
  let q = vec2u(vec2i(p) + vec2i(65536));
  return f32(pcg(q.x + pcg(q.y))) * (2.0 / 4294967295.0) - 1.0;
}
// Value noise with analytic derivatives: (value, d/dx, d/dy), value in [-1, 1].
fn noised(p: vec2f) -> vec3f {
  let i = floor(p);
  let f = p - i;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let a = hash2(i);
  let b = hash2(i + vec2f(1.0, 0.0));
  let c = hash2(i + vec2f(0.0, 1.0));
  let d = hash2(i + vec2f(1.0, 1.0));
  let k1 = b - a; let k2 = c - a; let k4 = a - b - c + d;
  return vec3f(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y,
               du * vec2f(k1 + k4 * u.y, k2 + k4 * u.x));
}
fn noise(p: vec2f) -> f32 { return noised(p).x; }

const ROT = mat2x2f(0.8, -0.6, 0.6, 0.8);

// Ridged-ish fbm for rock/ground micro relief, with derivatives in world units.
// `wl` = wavelength of the first octave (m); `fade` per-octave cut-off by distance.
fn reliefD(xz: vec2f, wl: f32, octaves: i32, dist: f32, fadeK: f32) -> vec3f {
  var p = xz / wl;
  var amp = 1.0;
  var freq = 1.0 / wl;
  var sum = vec3f(0.0);
  var m = mat2x2f(1.0, 0.0, 0.0, 1.0);
  for (var o = 0; o < octaves; o++) {
    let lambda = 1.0 / freq;
    // octave is invisible once a pixel / mesh cell covers ~1/4 of its wavelength
    let k = 1.0 - smoothstep(lambda * fadeK, lambda * 2.0 * fadeK, dist);
    if (k <= 0.0) { break; }
    let n = noised(p);
    sum += vec3f(n.x, transpose(m) * n.yz / wl) * amp * k;   // p = m * xz / wl
    p = ROT * p * 2.03;
    m = ROT * m * 2.03;
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

// ---------------------------------------------------------------- heightfield
fn hLoad(p: vec2i) -> f32 {
  let n = i32(F.terr.w);
  return textureLoad(heightTex, clamp(p, vec2i(0), vec2i(n - 1)), 0).r;
}
fn catmull(t: f32) -> vec4f {
  let t2 = t * t; let t3 = t2 * t;
  return vec4f(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0,
               -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
}
fn gridCubic(g: vec2f) -> f32 {
  let i = floor(g); let f = g - i; let b = vec2i(i) - 1;
  let wx = catmull(f.x); let wy = catmull(f.y);
  var h = 0.0;
  for (var y = 0; y < 4; y++) {
    let r = wx.x * hLoad(b + vec2i(0, y)) + wx.y * hLoad(b + vec2i(1, y))
          + wx.z * hLoad(b + vec2i(2, y)) + wx.w * hLoad(b + vec2i(3, y));
    h += r * wy[y];
  }
  return h;
}
fn gridLinear(g: vec2f) -> f32 {
  let i = floor(g); let f = g - i; let b = vec2i(i);
  return mix(mix(hLoad(b), hLoad(b + vec2i(1, 0)), f.x),
             mix(hLoad(b + vec2i(0, 1)), hLoad(b + vec2i(1, 1)), f.x), f.y);
}

// Beyond the 25 km crop: low rolling hills (placeholder until a real horizon ring exists).
// Mirrored in src/terrain-data.js (fallbackHeight) for the camera ground clamp.
fn fallbackHeight(xz: vec2f) -> f32 {
  let a = sin(xz.x * 0.00031 + 1.3) * sin(xz.y * 0.00037 + 0.7);
  let b = sin(xz.x * 0.00071 + xz.y * 0.00053 + 2.1);
  let c = sin(xz.x * -0.00113 + xz.y * 0.00131 + 0.4);
  return 420.0 + 260.0 * a + 120.0 * b + 60.0 * c;
}

// Returns (grid coords to sample, blend weight towards fallback).
fn edgeMap(xz: vec2f) -> vec3f {
  let n = F.terr.w;
  let maxg = n - 1.0;
  let g = (xz - F.terr.xy) / F.terr.z;
  let outside = max(max(-g, g - maxg), vec2f(0.0));
  let d = length(outside) * F.terr.z;
  var m = select(g, -g, g < vec2f(0.0));
  m = select(m, 2.0 * maxg - m, m > vec2f(maxg));
  m = clamp(m, vec2f(0.0), vec2f(maxg));
  return vec3f(m, smoothstep(300.0, 5000.0, d));
}
fn heightAt(xz: vec2f) -> f32 {
  let e = edgeMap(xz);
  let h = gridCubic(e.xy);
  if (e.z <= 0.0) { return h; }
  return mix(h, fallbackHeight(xz), e.z);
}
fn heightFast(xz: vec2f) -> f32 {
  let e = edgeMap(xz);
  let h = gridLinear(e.xy);
  if (e.z <= 0.0) { return h; }
  return mix(h, fallbackHeight(xz), e.z);
}

// ---------------------------------------------------------------- sky / fog / tonemap
fn skyRadiance(d: vec3f) -> vec3f {
  let L = F.sunDir.xyz;
  let y = max(d.y, 0.0);
  let sunH = clamp(L.y, 0.0, 1.0);
  let zenith = vec3f(0.10, 0.24, 0.58) * (0.4 + 0.6 * sunH);
  let horizon = vec3f(0.58, 0.68, 0.82) * (0.5 + 0.5 * sunH);
  var c = mix(horizon, zenith, pow(y, 0.42));
  let mu = max(dot(d, L), 0.0);
  c += F.sunColor.rgb * (0.025 * pow(mu, 6.0) + 0.12 * pow(mu, 48.0));
  // slightly warmer, denser band right at the horizon
  c = mix(c, horizon * vec3f(1.05, 1.0, 0.95), exp(-y * 18.0) * 0.5);
  if (d.y < 0.0) { c = mix(c, horizon * 0.75, smoothstep(0.0, 0.25, -d.y)); }
  return c * 1.6;
}

// Analytic exponential height fog along the camera->p segment (aerial perspective).
fn applyFog(col: vec3f, p: vec3f) -> vec3f {
  let cam = F.camPos.xyz;
  let rd = p - cam;
  let dist = length(rd);
  let dir = rd / max(dist, 1e-3);
  let a = F.fog.x; let b = F.fog.y;
  let dy = rd.y;
  var opt = a * exp(-b * (cam.y - 200.0)) * dist;
  if (abs(dy) > 0.5) { opt *= (1.0 - exp(-b * dy)) / (b * dy); }
  let T = exp(-opt * vec3f(0.85, 1.0, 1.25));
  let fogDir = normalize(vec3f(dir.x, max(dir.y, 0.0) * 0.4 + 0.015, dir.z));
  var fc = skyRadiance(fogDir);
  fc += F.sunColor.rgb * 0.06 * pow(max(dot(dir, F.sunDir.xyz), 0.0), 8.0);
  return col * T + fc * (1.0 - T);
}

fn tonemap(c: vec3f, fragXY: vec2f) -> vec4f {
  let x = c * F.fog.z;
  // ACES fit (Narkowicz)
  let t = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  let srgb = select(1.055 * pow(t, vec3f(1.0 / 2.4)) - 0.055, t * 12.92, t <= vec3f(0.0031308));
  // blue-noise-ish dither against sky banding
  let n = fract(52.9829189 * fract(dot(fragXY, vec2f(0.06711056, 0.00583715))));
  return vec4f(srgb + (n - 0.5) / 255.0, 1.0);
}
