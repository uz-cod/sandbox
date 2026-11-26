# Montagne di Lecco — WebGPU

Real-time scene of the real mountains around Lecco (Italy), built on raw WebGPU + WGSL
(no engines) and shipped as a single self-contained `dist/index.html` (~2.2 MB).
External data: the Copernicus GLO-30 DEM and OpenStreetMap (trails, hiking routes, huts,
bivouacs, crosses); everything else is procedural.

## Run

Open `dist/index.html` in a browser with WebGPU (Chrome/Edge 113+, recent Safari/Firefox).
No server needed.

| Input | Action |
|---|---|
| Click | capture mouse (Esc releases) — or drag to look |
| W A S D | move · E/Space up · Q/C down |
| Shift / Alt | faster / slower · mouse wheel: speed multiplier |
| ← → ↑ ↓ | turn |
| 1–8 | jump to a summit |
| select a summit | its marked itineraries light up (colour = CAI difficulty T/E/EE/EEA) with trailhead pins |
| panel: trailhead name · `sali` · `scendi` | fly to the trailhead · walk up to the summit · walk down |
| V | overview of the selected summit and all its trailheads |
| (on a trail) Space · W/S · Shift · F | pause/resume · forward/back · run · leave the trail |
| H | hide the interface |

Speed scales with height above ground, so you can descend slopes precisely and still cross
the valley quickly from high up.

URL parameters (debug/tuning): `peak=<n|id>`, `cam=x,y,z,yawDeg,pitchDeg`, `sunaz`, `sunel`,
`snow` (snow line, m), `exp` (exposure), `relief` (micro-relief scale, 0 = off),
`dbg=1` (material weights: red rock, green forest, blue snow), `scale` (render scale),
`pre` (precompute texture size, default 2048), `follow=<itinerary>:<metres>[:down]` (walk an
itinerary of the selected summit), `overview`.

## Build

```bash
npm install
node tools/fetch-osm.mjs   # optional: refresh data/osm/extract.json from Overpass (--offline re-extracts)
npm run build        # bakes the DEM if needed, then bundles to dist/index.html
npm run bake         # DEM bake only (prints snapped summits and lake levels)
npm run shot -- "peak=2&hud=0"   # headless screenshots into shots/ (needs Playwright)
```

## How it works

- **Bake** (`tools/bake-dem.mjs`, own GeoTIFF reader in `tools/tiff.mjs`): 25 × 25 km around
  45.885 N 9.40 E reprojected to a local metric grid (1024², 24.4 m), Catmull-Rom resampling,
  lakes flattened per connected component from the WBM mask (Lecco 197 m, Annone, Pusiano,
  Garlate, Segrino), shore distance field, summits snapped to the highest DEM sample,
  uint16 quantisation (3.4 cm), planar predictor + byte planes + deflate → 1.15 MB.
- **OSM bake** (`tools/bake-osm.mjs`): trails above the valley floor (and every way of a marked
  route) simplified to 1 m and quantised to 0.44 m; hiking-route relations chained into continuous
  polylines, kept when they pass within 400 m of a start summit; real huts/bivouacs (`alpine_hut`,
  `wilderness_hut`, shelter huts) above 600 m with an oriented footprint from the OSM building
  outline; crosses above 600 m → ~410 KB.
- **Itineraries & trailheads**: for every marked route reaching a start summit, the far end is the
  trailhead (named from the relation's `from`/`to`, oriented by its first member way), with CAI
  difficulty (`cai_scale`, else derived from `sac_scale`), length, D+ (DEM every 25 m) and time
  (OSM `duration` in the ascent direction, else 4 km/h + 400 m/h). Pieces of longer routes cut by
  the download box are dropped. Itinerary segments carry their summit bit: the selected summit's
  ones are drawn ~3 px wide at any distance; trailheads are distance-scaled billboard pins.
- **Trails & buildings at runtime**: a 40 m CSR cell grid (storage buffers) lets the terrain
  vertex shader flatten building pads and smooth trail beds, and the fragment shader paint trails
  analytically (exact distance to segments, irregular worn edges, gravel up close, sub-pixel
  coverage far away). Huts/bivouacs/crosses are a procedural mesh (stone walls with windows and
  shutters, timber gables, slab or metal roofs, red metal bivouacs).
- **Startup GPU passes**: normals/curvature, soft sun shadows (heightfield ray march) and
  horizon-based AO over the crop + 6 km margin.
- **Terrain**: 10 nested clipmap rings (128² cells, 2 m → 1 km spacing) with CDLOD-style
  geomorphing, no cracks or T-junctions; bicubic heights in the vertex shader plus procedural
  micro relief faded by distance.
- **Shading**: limestone strata, meadows, forest canopy, patchy late-spring snow chosen by
  altitude/slope/aspect/curvature; lakes with Fresnel, animated waves and sun glint; analytic
  sky, exponential height fog, ACES tonemapping, 4× MSAA, reverse-Z depth.
- The frame loop does no JS allocations of its own (preallocated uniforms, descriptors,
  matrices); only WebGPU's own per-frame objects (encoder, swap-chain view) are created.

## Known limits

- Beyond the 25 km crop the terrain is a placeholder (mirrored edge fading into low hills);
  a real horizon needs the neighbouring tiles (N46 E009, N45 E008, N46 E008).
- 30 m data: summit domes look smooth up close; no trees, no lake reflections yet.
- Huts are generic (footprint, size and type from OSM); the Magnodeno ones will get a dedicated
  model from photos.
- Summit positions start from the OSM peak nodes and are snapped to the DEM maximum.

## Data attribution

produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH
2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

Trails, hiking routes, huts and crosses: © OpenStreetMap contributors, available under the
Open Database License (ODbL) 1.0 — https://www.openstreetmap.org/copyright

The organisations in charge of the Copernicus programme by law or by delegation do not incur
any liability for any use of the Copernicus WorldDEM-30.
