// Startup pass: terrain normals + curvature over the extended region (crop + margin).
// Output rgba16float: (normal.x, normal.z, curvature, height).

@group(0) @binding(2) var normalOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn csNormals(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(normalOut);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let texel = F.ext.z / f32(size.x);
  let p = F.ext.xy + (vec2f(id.xy) + 0.5) * texel;
  let e = texel;
  let hc = heightAt(p);
  let hl = heightAt(p - vec2f(e, 0.0));
  let hr = heightAt(p + vec2f(e, 0.0));
  let hn = heightAt(p - vec2f(0.0, e));
  let hs = heightAt(p + vec2f(0.0, e));
  let n = normalize(vec3f(hl - hr, 2.0 * e, hn - hs));
  // curvature at a coarser scale (~3 texels): >0 concave (gullies), <0 convex (ridges)
  let E = 3.0 * e;
  let lap = (heightAt(p - vec2f(E, 0.0)) + heightAt(p + vec2f(E, 0.0))
           + heightAt(p - vec2f(0.0, E)) + heightAt(p + vec2f(0.0, E)) - 4.0 * hc) / (E * E);
  textureStore(normalOut, id.xy, vec4f(n.x, n.z, clamp(lap * 60.0, -4.0, 4.0), hc));
}
