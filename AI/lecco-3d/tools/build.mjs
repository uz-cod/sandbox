// Builds dist/index.html: bakes the DEM if needed, bundles src/ with esbuild
// (WGSL as text, heightfield as embedded binary) and inlines the bundle in the HTML.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bake } from './bake-dem.mjs';
import { bakeOsm } from './bake-osm.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const gen = join(ROOT, 'src/generated/terrain.bin');
const bakeInputs = ['tools/bake-dem.mjs', 'tools/tiff.mjs', 'src/peaks.js', 'data/osm/extract.json'].map((p) => join(ROOT, p));

const stale = !existsSync(gen) || bakeInputs.some((p) => statSync(p).mtimeMs > statSync(gen).mtimeMs);
if (stale) { console.log('baking DEM…'); bake(); }
const osmGen = join(ROOT, 'src/generated/osm.bin');
const osmInputs = ['tools/bake-osm.mjs', 'tools/geo.mjs', 'data/osm/extract.json', 'src/peaks.js'].map((p) => join(ROOT, p));
if (!existsSync(osmGen) || osmInputs.some((p) => statSync(p).mtimeMs > statSync(osmGen).mtimeMs)) { console.log('baking OSM…'); bakeOsm(); }

const result = await build({
  entryPoints: [join(ROOT, 'src/main.js')],
  bundle: true,
  format: 'iife',
  minify: !process.argv.includes('--dev'),
  target: 'es2022',
  loader: { '.wgsl': 'text', '.bin': 'binary' },
  write: false,
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync(join(ROOT, 'src/index.html'), 'utf8').replace('<!--APP-->', () => `<script>${js}</script>`);
mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist/index.html'), html);
console.log(`dist/index.html ${(html.length / 1e6).toFixed(2)} MB`);
