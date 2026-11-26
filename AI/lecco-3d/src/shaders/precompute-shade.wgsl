// Startup pass: soft sun shadows (heightfield ray march towards the sun) and
// horizon-based ambient occlusion. Output rgba8unorm: (sun visibility, ao, sky view, 1).

@group(0) @binding(2) var shadeOut: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn csShade(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(shadeOut);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let texel = F.ext.z / f32(size.x);
  let p = F.ext.xy + (vec2f(id.xy) + 0.5) * texel;
  let hc = heightFast(p);

  // --- sun visibility with penumbra (tangent-space margin) ---
  let L = F.sunDir.xyz;
  let lxz = length(L.xz);
  let sdir = L.xz / max(lxz, 1e-4);
  let tanE = L.y / max(lxz, 1e-4);
  let h0 = hc + 3.0;
  var vis = 1.0;
  var t = texel * 0.75;
  for (var k = 0; k < 80; k++) {
    let hs = heightFast(p + sdir * t);
    let margin = (h0 + t * tanE - hs) / t;
    vis = min(vis, clamp(0.5 + margin / 0.05, 0.0, 1.0));
    if (vis <= 0.0 || t > 16000.0) { break; }
    t = t * 1.07 + 4.0;
  }

  // --- horizon AO over 8 azimuths, ~1.5 km radius ---
  var ao = 0.0;
  var skyView = 0.0;
  let jitter = hash2(vec2f(id.xy)) * 0.39;
  for (var d = 0; d < 8; d++) {
    let a = f32(d) * 0.7853982 + jitter;
    let dir = vec2f(cos(a), sin(a));
    var maxS = 0.0;
    var r = texel * 0.6;
    for (var k = 0; k < 12; k++) {
      let dh = heightFast(p + dir * r) - hc;
      maxS = max(maxS, dh / sqrt(dh * dh + r * r));
      r *= 1.5;
    }
    ao += 1.0 - maxS;
    skyView += 1.0 - maxS * maxS;
  }
  textureStore(shadeOut, id.xy, vec4f(vis, ao / 8.0, skyView / 8.0, 1.0));
}
