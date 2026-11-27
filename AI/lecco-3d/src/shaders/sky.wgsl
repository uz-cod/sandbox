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
  // cloud layer: ray / plane intersection, lit from the sun with a cheap self-shadow tap
  let cam = F.camPos.xyz;
  if (F.clouds.z > 0.0 && abs(d.y) > 0.005) {
    let t = (CLOUD_H - cam.y) / d.y;
    if (t > 0.0) {
      let q = cam + d * t;
      let dens = cloudDensity(q.xz);
      if (dens > 0.001) {
        let L = F.sunDir.xyz;
        let towardSun = cloudDensity(q.xz + normalize(L.xz + vec2f(1e-4, 0.0)) * 260.0);
        let lit = 1.0 - 0.65 * towardSun;
        let shade = vec3f(0.50, 0.55, 0.64) * 1.25;
        let sunlit = F.sunColor.rgb * 0.42;
        var cc = mix(shade, sunlit, lit) * mix(0.85, 1.0, dens);
        cc += F.sunColor.rgb * 0.5 * pow(max(dot(d, L), 0.0), 10.0) * (1.0 - dens) * lit;   // silver lining
        let far = exp(-t / 38000.0);
        let hz = skyRadiance(normalize(vec3f(d.x, max(d.y, 0.0) * 0.3 + 0.02, d.z)));
        cc = mix(hz, cc, far);
        c = mix(c, cc, dens * smoothstep(0.0, 0.06, abs(d.y)) * (0.35 + 0.65 * far));
      }
    }
  }
  // haze below the horizon line blends with distant fogged terrain
  c = mix(c, applyFog(c, F.camPos.xyz + d * 60000.0), smoothstep(0.08, -0.02, d.y));
  return tonemap(c, in.pos.xy);
}
