// Trailhead pins: camera-facing billboards (pole + round head), sized to stay readable from far
// away, shown only for the selected summit / hub (owner id == F.misc.w).

struct PinIn {
  @location(0) pos: vec4f,    // x, y (ground), z, selection owner id
  @location(1) col: vec4f,    // rgb, kind (0 trailhead, 1 junction)
};
struct PinOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) col: vec4f,
  @location(2) world: vec3f,
};

@vertex
fn vsPin(@builtin(vertex_index) vid: u32, inst: PinIn) -> PinOut {
  var corners = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = corners[vid];
  var o: PinOut;
  o.uv = c;
  o.col = inst.col;
  let visible = u32(inst.pos.w) == u32(F.misc.w) && F.misc.w > 0.5;
  let base = inst.pos.xyz;
  let toCam = F.camPos.xyz - base;
  let dist = length(toCam);
  // ~45 px tall at any distance (minimum 9 m), junction pins smaller
  let k = select(1.0, 0.6, inst.col.w > 0.5);
  let H = max(9.0, dist * 52.0 * F.screen.w) * k;          // 45 px * 1.155 (tan fov) / screen height
  let Wd = H * 0.16;
  let right = normalize(vec3f(toCam.z, 0.0, -toCam.x) + vec3f(1e-4, 0.0, 0.0));
  let world = base + right * c.x * Wd + vec3f(0.0, c.y * H, 0.0);
  o.world = world;
  o.pos = F.viewProj * vec4f(world - F.camPos.xyz, 1.0);
  if (!visible) { o.pos = vec4f(0.0, 0.0, -1.0, 1.0); }   // outside the clip volume: culled
  return o;
}

@fragment
fn fsPin(i: PinOut) -> @location(0) vec4f {
  // head: circle of radius 1 (in width units) centred at the top; pole: thin line below
  let headC = vec2f(0.0, 1.0 - 0.16);
  let q = vec2f(i.uv.x, (i.uv.y - headC.y) * 6.25);        // aspect: quad is 2 wide x 1 tall, H = 6.25 W
  let r = length(q);
  let pole = abs(i.uv.x) < 0.16 && i.uv.y < headC.y;
  if (r > 1.0 && !pole) { discard; }
  var c = i.col.rgb;
  if (pole) { c = vec3f(0.95); }
  if (r <= 1.0 && r > 0.62) { c = vec3f(1.0); }            // white ring
  let lit = c * 1.4;
  let col = mix(lit, applyFog(lit, i.world), 0.3);
  return tonemap(col, i.pos.xy);
}
