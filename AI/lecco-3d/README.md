# Montagne di Lecco — WebGPU

Real-time scene of the real mountains around Lecco (Italy), built on raw WebGPU + WGSL
(no engines) and shipped as a single self-contained `dist/index.html` (~1.6 MB).
The only external data is the Copernicus GLO-30 DEM; everything else is procedural.

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
| H | hide the interface |

Speed scales with height above ground, so you can descend slopes precisely and still cross
the valley quickly from high up.

URL parameters (debug/tuning): `peak=<n|id>`, `cam=x,y,z,yawDeg,pitchDeg`, `sunaz`, `sunel`,
`snow` (snow line, m), `exp` (exposure), `relief` (micro-relief scale, 0 = off),
`dbg=1` (material weights: red rock, green forest, blue snow), `scale` (render scale),
`pre` (precompute texture size, default 2048).

## Build

```bash
npm install
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

## Known limits (phase 1)

- Beyond the 25 km crop the terrain is a placeholder (mirrored edge fading into low hills);
  a real horizon needs the neighbouring tiles (N46 E009, N45 E008, N46 E008).
- 30 m data: summit domes look smooth up close; no trees, no buildings, no lake reflections
  of the mountains yet.
- Summit positions are snapped from approximate coordinates; *Monte San Martino* is the
  least certain one (DEM shoulder at ≈1011 m above Rancio). Adjust in `src/peaks.js`.

## Data attribution

produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH
2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

The organisations in charge of the Copernicus programme by law or by delegation do not incur
any liability for any use of the Copernicus WorldDEM-30.
