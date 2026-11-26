# Lecco Mountains — project rules

- Real-time WebGPU scene of the real mountains around Lecco (Italy), free-flying camera.
- No engines (no Three.js/Babylon/etc.). Raw WebGPU + WGSL only.
- Source is modular (src/*.js, src/shaders/*.wgsl); the deliverable is a single self-contained
  dist/index.html produced by `npm run build`. Never hand-edit dist/.
- External data: the Copernicus GLO-30 DEM (+ optional WBM water mask) in data/raw/, and
  OpenStreetMap (trails, hiking routes, huts/bivouacs, crosses) fetched by tools/fetch-osm.mjs
  into the committed extract data/osm/extract.json. Both are preprocessed by tools/ into compact
  embedded data. data/raw/ is never bundled and is in .gitignore.
- Everything else (textures, vegetation, rocks, snow, water, sky, clouds) is procedural.
- Zero per-frame JS allocations: preallocate typed arrays and uniform buffers, no closures or
  temporary objects in the render loop.
- Include the Copernicus DEM attribution required by data/raw/eula_F.pdf and the OpenStreetMap
  attribution (ODbL) in the page (small, unobtrusive credits line) and in README.md.
- Visual-critic subagents receive ONLY rendered images/video, never code or reasoning.