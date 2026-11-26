// Trees: instanced low-poly meshes (near) and procedural billboards (far). Instances come from
// trees-scatter.wgsl; cross-fades use alpha-to-coverage (4x MSAA).

@group(0) @binding(2) var shadeTexD: texture_2d<f32>;
@group(0) @binding(3) var linSampD: sampler;

fn rotY(v: vec3f, a: f32) -> vec3f {
  let c = cos(a); let s = sin(a);
  return vec3f(c * v.x - s * v.z, v.y, s * v.x + c * v.z);
}

fn foliageColor(info: vec4f) -> vec3f {
  if (info.x > 0.5) { return mix(vec3f(0.014, 0.030, 0.020), vec3f(0.028, 0.046, 0.028), info.y); }   // spruce / fir
  return mix(vec3f(0.026, 0.050, 0.016), vec3f(0.056, 0.078, 0.024), info.y);                          // beech / chestnut
}

fn shadeTree(world: vec3f, n: vec3f, albedo: vec3f, ao: f32, foliage: f32) -> vec3f {
  let L = F.sunDir.xyz;
  let toCam = F.camPos.xyz - world;
  let V = toCam / max(length(toCam), 1e-3);
  var sunVis = 1.0; var tao = 1.0;
  let uv = (world.xz - F.ext.xy) * F.ext.w;
  if (all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))) {
    let sh = textureSampleLevel(shadeTexD, linSampD, uv, 0.0);
    sunVis = sh.r; tao = mix(sh.g, 1.0, 0.5);
  }
  let ndl = dot(n, L);
  let diff = mix(max(ndl, 0.0), max(ndl * 0.75 + 0.25, 0.0), foliage) * mix(1.0, 0.85, foliage);   // mild wrap on leaves
  let trans = pow(max(dot(-V, L), 0.0), 4.0) * 0.35 * foliage;               // back-lit leaves glow
  let sky = skyRadiance(normalize(vec3f(n.x * 0.5, 1.0, n.z * 0.5))) * 0.45;
  let bounce = vec3f(0.10, 0.11, 0.06) * F.sunColor.rgb * 0.5;
  let amb = sky * (0.35 + 0.45 * max(n.y, 0.0)) + bounce * (0.6 - 0.4 * n.y);
  let col = albedo * (F.sunColor.rgb * (diff + trans) * sunVis + amb * ao * tao);
  return applyFog(col, world);
}

// ------------------------------------------------------------------ near: meshes
struct MOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) nrm: vec3f,
  @location(2) lp: vec3f,
  @location(3) @interpolate(flat) info: vec4f,
  @location(4) part: f32,
};

@vertex
fn vsTreeMesh(@location(0) lp: vec3f, @location(1) ln: vec3f, @location(2) part: f32,
              @location(3) ip: vec4f, @location(4) info: vec4f) -> MOut {
  let H = ip.w;
  let sx = 0.85 + 0.3 * info.y;
  let sz = 0.85 + 0.3 * fract(info.y * 7.31);
  var l = lp * vec3f(H * sx, H, H * sz);
  let sway = lp.y * lp.y * 0.010 * H * sin(F.camPos.w * 1.3 + info.z * 3.0 + ip.x * 0.05) * part;
  l.x += sway;
  let w = ip.xyz + rotY(l, info.z);
  var o: MOut;
  o.pos = F.viewProj * vec4f(w - F.camPos.xyz, 1.0);
  o.world = w;
  o.nrm = rotY(normalize(ln / vec3f(sx, 1.0, sz)), info.z);
  o.lp = lp;
  o.info = info;
  o.part = part;
  return o;
}

@fragment
fn fsTreeMesh(i: MOut) -> @location(0) vec4f {
  var n = normalize(i.nrm);
  var albedo: vec3f;
  var ao: f32;
  if (i.part > 0.5) {
    // leaf clumps: perturbed normals and dark gaps
    let q = i.lp * vec3f(22.0, 16.0, 22.0) + i.info.y * 13.0;
    let nn = vec3f(noise(q.xz), noise(q.zy + 3.1), noise(q.xy + 7.7));
    n = normalize(n + nn * 0.4);
    let clump = noise(q.xz * 0.6 + q.y) * 0.6 + noise(q.zy * 1.9) * 0.4;
    albedo = foliageColor(i.info) * (0.6 + 0.6 * smoothstep(-0.6, 0.6, clump));
    ao = mix(0.3, 1.0, smoothstep(0.15, 0.95, i.lp.y)) * (0.55 + 0.45 * smoothstep(-0.5, 0.5, clump));
  } else {
    albedo = select(vec3f(0.24, 0.23, 0.21), vec3f(0.15, 0.10, 0.07), i.info.x > 0.5);
    ao = 0.6;
  }
  let col = shadeTree(i.world, n, albedo, ao, i.part);
  var o = tonemap(col, i.pos.xy);
  o.a = i.info.w;                                  // alpha-to-coverage cross-fade
  return o;
}

// ------------------------------------------------------------------ far: billboards
struct BOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) world: vec3f,
  @location(2) @interpolate(flat) info: vec4f,
  @location(3) right: vec3f,
  @location(4) toCam: vec3f,
};

@vertex
fn vsTreeBB(@builtin(vertex_index) vid: u32, @location(3) ip: vec4f, @location(4) info: vec4f) -> BOut {
  var corners = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = corners[vid];
  let H = ip.w;
  let Wd = H * select(0.40, 0.30, info.x > 0.5);
  let toCam = F.camPos.xyz - ip.xyz;
  let right = normalize(vec3f(toCam.z, 0.0, -toCam.x) + vec3f(1e-4, 0.0, 0.0));
  let world = ip.xyz + right * (c.x * Wd) + vec3f(0.0, c.y * H, 0.0);
  var o: BOut;
  o.pos = F.viewProj * vec4f(world - F.camPos.xyz, 1.0);
  o.uv = c;
  o.world = world;
  o.info = info;
  o.right = right;
  o.toCam = normalize(vec3f(toCam.x, 0.0, toCam.z));
  return o;
}

@fragment
fn fsTreeBB(i: BOut) -> @location(0) vec4f {
  let x = i.uv.x;
  let y = i.uv.y;
  let conifer = i.info.x > 0.5;
  var inside = false;
  var nx = 0.0; var ny = 0.0;
  var trunk = false;
  if (conifer) {
    let t = clamp((y - 0.10) / 0.90, 0.0, 1.0);
    var hw = (1.0 - t) * 0.95;
    hw *= 0.72 + 0.28 * (1.0 - fract(t * 5.0 + i.info.y));          // branch tiers
    hw *= 0.9 + 0.2 * noise(vec2f(y * 23.0, i.info.y * 9.0));
    inside = y > 0.10 && abs(x) < hw;
    nx = x / max(hw, 0.05); ny = 0.35;
    trunk = y <= 0.12 && abs(x) < 0.06;
  } else {
    let q = vec2f(x / 0.95, (y - 0.60) / 0.40);
    let r = length(q);
    let edge = 1.0 + 0.22 * noise(vec2f(atan2(q.y, q.x) * 2.5, i.info.y * 11.0)) + 0.1 * noise(i.uv * 9.0 + i.info.y * 5.0);
    inside = r < edge;
    nx = q.x; ny = q.y;
    trunk = y < 0.3 && abs(x) < 0.07;
  }
  if (!inside && !trunk) { discard; }
  let nz = sqrt(max(0.0, 1.0 - nx * nx * 0.6 - ny * ny * 0.6));
  var n = normalize(i.right * nx * 0.8 + vec3f(0.0, 1.0, 0.0) * (ny * 0.6 + 0.3) + i.toCam * nz);
  var albedo = foliageColor(i.info) * (0.8 + 0.4 * noise(i.uv * 7.0 + i.info.y * 3.0));
  var ao = mix(0.45, 1.0, smoothstep(0.1, 0.9, y));
  var fol = 1.0;
  if (!inside) { albedo = vec3f(0.18, 0.15, 0.12); ao = 0.5; fol = 0.0; n = i.toCam; }
  let col = shadeTree(i.world, n, albedo, ao, fol);
  var o = tonemap(col, i.pos.xy);
  o.a = i.info.w;
  return o;
}
