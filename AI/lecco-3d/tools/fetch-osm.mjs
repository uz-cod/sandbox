// Downloads the OpenStreetMap data used by the scene (Overpass API) and writes a compact,
// committed extract: data/osm/extract.json (trails, hiking routes, huts, summit crosses).
//   node tools/fetch-osm.mjs            download (mirrors tried in order), then extract
//   node tools/fetch-osm.mjs --offline  re-extract from data/raw/osm/overpass.json
// Data © OpenStreetMap contributors, ODbL 1.0.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data/raw/osm/overpass.json');
const QUERY = join(ROOT, 'data/raw/osm/query.overpassql');
const OUT = join(ROOT, 'data/osm/extract.json');
const MIRRORS = ['https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter'];

async function download() {
  const body = new URLSearchParams({ data: readFileSync(QUERY, 'utf8') });
  for (const url of MIRRORS) {
    try {
      console.log(`Overpass: ${url}`);
      const res = await fetch(url, { method: 'POST', body, headers: { 'User-Agent': 'lecco-3d-bake/0.1' }, signal: AbortSignal.timeout(300000) });
      if (!res.ok) { console.log(`  HTTP ${res.status}`); continue; }
      const text = await res.text();
      if (!text.includes('"elements"')) { console.log('  unexpected response'); continue; }
      mkdirSync(dirname(RAW), { recursive: true });
      writeFileSync(RAW, text);
      return;
    } catch (e) { console.log(`  ${e.message}`); }
  }
  throw new Error('all Overpass mirrors failed');
}

const TRAIL = /^(path|footway|track|bridleway|steps|via_ferrata)$/;
const KEEP_WAY_TAGS = ['highway', 'sac_scale', 'trail_visibility', 'tracktype', 'surface', 'name', 'ref'];
const r6 = (v) => Math.round(v * 1e6);

function extract(osm) {
  const ways = [], routes = [], huts = [], crosses = [], peaks = [];
  for (const e of osm.elements) {
    const t = e.tags || {};
    if (e.type === 'way' && TRAIL.test(t.highway || '') && e.geometry) {
      const tags = {};
      for (const k of KEEP_WAY_TAGS) if (t[k]) tags[k] = t[k];
      ways.push({ id: e.id, tags, c: e.geometry.flatMap((g) => [r6(g.lat), r6(g.lon)]) });
    } else if (e.type === 'relation' && t.route === 'hiking') {
      routes.push({ id: e.id, ref: t.ref || '', name: t.name || '', osmc: t['osmc:symbol'] || '', operator: t.operator || '',
        ways: e.members.filter((m) => m.type === 'way').map((m) => m.ref) });
    } else if (t.tourism === 'alpine_hut' || t.tourism === 'wilderness_hut' || t.amenity === 'shelter' || /^(rifugio|bivacco|capanna)\b/i.test(t.name || '')) {
      if (t.amenity === 'shelter' && /picnic|public_transport|field_shelter|sun_shelter|pavilion/.test(t.shelter_type || '')) continue;
      const poly = e.type === 'way' && e.geometry ? e.geometry.flatMap((g) => [r6(g.lat), r6(g.lon)]) : null;
      const lat = e.type === 'node' ? e.lat : e.bounds ? (e.bounds.minlat + e.bounds.maxlat) / 2 : null;
      const lon = e.type === 'node' ? e.lon : e.bounds ? (e.bounds.minlon + e.bounds.maxlon) / 2 : null;
      if (lat == null) continue;
      huts.push({ id: `${e.type[0]}${e.id}`, name: t.name || '', kind: t.tourism || t.amenity || '', shelter: t.shelter_type || '',
        building: t.building || '', levels: Number(t['building:levels']) || 0, roof: t['roof:shape'] || '', ele: Number(t.ele) || 0,
        lat: r6(lat), lon: r6(lon), poly });
    }
    if (e.type === 'node' && (t['summit:cross'] === 'yes' || t.man_made === 'cross')) {
      crosses.push({ id: e.id, name: t.name || '', summit: t['summit:cross'] === 'yes' || t.natural === 'peak', material: t.material || '', structure: t.structure || '', lat: r6(e.lat), lon: r6(e.lon) });
    }
    if (e.type === 'node' && t.natural === 'peak' && t.name) peaks.push({ id: e.id, name: t.name, ele: Number(t.ele) || 0, lat: r6(e.lat), lon: r6(e.lon) });
  }
  return { source: 'OpenStreetMap via Overpass API', license: 'ODbL 1.0, © OpenStreetMap contributors', timestamp: osm.osm3s?.timestamp_osm_base, ways, routes, huts, crosses, peaks };
}

if (!process.argv.includes('--offline') || !existsSync(RAW)) await download();
const ex = extract(JSON.parse(readFileSync(RAW, 'utf8')));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(ex));
console.log(`extract: ${ex.ways.length} trail ways, ${ex.routes.length} routes, ${ex.huts.length} huts/shelters, ${ex.crosses.length} crosses, ${ex.peaks.length} peaks (OSM ${ex.timestamp})`);
