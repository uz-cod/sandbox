// Cables (aerialways): each segment is a camera-facing quad about one pixel wide at any distance.

struct LIn { @location(0) a: vec4f, @location(1) b: vec4f };
struct LOut { @builtin(position) pos: vec4f, @location(0) world: vec3f };

@vertex
fn vsLine(@builtin(vertex_index) vid: u32, l: LIn) -> LOut {
  var c = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let k = c[vid];
  let p = mix(l.a.xyz, l.b.xyz, k.x);
  let toCam = F.camPos.xyz - p;
  let dist = length(toCam);
  let side = normalize(cross(l.b.xyz - l.a.xyz, toCam) + vec3f(0.0, 1e-5, 0.0));
  let hw = max(0.035, dist * 0.6 * F.screen.w * 1.155);
  let w = p + side * k.y * hw;
  var o: LOut;
  o.pos = F.viewProj * vec4f(w - F.camPos.xyz, 1.0);
  o.world = w;
  return o;
}

@fragment
fn fsLine(i: LOut) -> @location(0) vec4f {
  let col = applyFog(vec3f(0.035, 0.035, 0.04), i.world);
  return tonemap(col, i.pos.xy);
}
