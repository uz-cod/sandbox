// Sky: full-screen triangle drawn last at depth 0 (reverse-Z), only where no terrain was drawn.

struct SkyOut {
  @builtin(position) pos: vec4f,
  @location(0) ndc: vec2f,
};

@vertex
fn vsSky(@builtin(vertex_index) vid: u32) -> SkyOut {
  let xy = vec2f(f32((vid << 1u) & 2u), f32(vid & 2u)) * 2.0 - 1.0;
  var o: SkyOut;
  o.pos = vec4f(xy, 0.0, 1.0);
  o.ndc = xy;
  return o;
}

@fragment
fn fsSky(in: SkyOut) -> @location(0) vec4f {
  let p = F.invViewProj * vec4f(in.ndc, 1.0, 1.0);
  let d = normalize(p.xyz / p.w);
  var c = skyRadiance(d);
  // sun disc with limb darkening
  let mu = dot(d, F.sunDir.xyz);
  let cosR = 0.99998;   // ~0.36 deg
  if (mu > cosR) {
    let r = (1.0 - mu) / (1.0 - cosR);
    c += F.sunColor.rgb * 40.0 * (1.0 - 0.6 * r);
  }
  // haze below the horizon line blends with distant fogged terrain
  c = mix(c, applyFog(c, F.camPos.xyz + d * 60000.0), smoothstep(0.08, -0.02, d.y));
  return tonemap(c, in.pos.xy);
}
