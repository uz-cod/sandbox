// Headless screenshots of dist/index.html (needs Playwright + Chromium; WebGPU runs on
// SwiftShader, i.e. on the CPU: fine for images, meaningless for performance).
// Usage: node tools/shot.mjs [query ...]   e.g.  node tools/shot.mjs "peak=1" "peak=resegone&hud=0"
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'shots');
mkdirSync(OUT, { recursive: true });

const queries = process.argv.slice(2);
if (!queries.length) for (let i = 1; i <= 8; i++) queries.push(`peak=${i}&hud=0`);
const size = { width: Number(process.env.W || 1280), height: Number(process.env.H || 720) };

const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader',
    '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: size });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || process.env.VERBOSE) console.log(`  [${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
const url = pathToFileURL(join(ROOT, 'dist/index.html')).href;
for (const q of queries) {
  const t0 = Date.now();
  await page.goto(`${url}?shot&scale=1&t=10&${q}`);
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 600000 });
  const err = await page.evaluate(() => window.__error);
  if (err) { console.log(`${q}: ERROR ${err}`); continue; }
  const file = join(OUT, `${q.replace(/[^a-z0-9=,.-]+/gi, '_')}.png`);
  await page.screenshot({ path: file });
  console.log(`${q} -> ${file} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
await browser.close();
