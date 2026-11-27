// Shared OSM feature lookup (terrain shading and tree scattering).
// OSM features (see src/osm-data.js): trail segments (a.xy, b.xy) followed by pads
// (2 x vec4: centre, cos, sin | half size u, half size w, base height, margin);
// cells = CSR grid: [cellCount + 1 start offsets | items]; item high bit = pad.
@group(0) @binding(7) var<storage, read> segs: array<vec4f>;
@group(0) @binding(8) var<storage, read> segAttr: array<u32>;
@group(0) @binding(9) var<storage, read> cells: array<u32>;

struct Feat { edge: f32, center: f32, halfW: f32, attr: u32, padW: f32, padH: f32, hlD: f32, hlAttr: u32, selD: f32 };

fn features(xz: vec2f, wantTrails: bool) -> Feat {
  var f: Feat;
  f.edge = 1e9; f.center = 1e9; f.halfW = 0.0; f.attr = 0u; f.padW = 0.0; f.padH = 0.0; f.hlD = 1e9; f.hlAttr = 0u; f.selD = 1e9;
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
        if (f32(it) >= F.sel.x && f32(it) < F.sel.y) { f.selD = min(f.selD, dc); }
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

