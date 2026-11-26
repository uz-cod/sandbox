// Minimal GeoTIFF reader for Copernicus GLO-30 COG tiles.
// Supports: first IFD only (full resolution), tiled layout, Deflate (8) or none (1),
// predictor 1/2/3, 8-bit unsigned and 32-bit float single-band rasters.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8 };

export function readGeoTiff(path) {
  const buf = readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const le = buf.toString('latin1', 0, 2) === 'II';
  if (!le) throw new Error('big-endian TIFF not supported');
  if (dv.getUint16(2, true) !== 42) throw new Error('BigTIFF not supported');

  const ifd = dv.getUint32(4, true);
  const n = dv.getUint16(ifd, true);
  const tags = new Map();
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = dv.getUint16(e, true);
    const type = dv.getUint16(e + 2, true);
    const count = dv.getUint32(e + 4, true);
    const size = (TYPE_SIZE[type] || 1) * count;
    const off = size <= 4 ? e + 8 : dv.getUint32(e + 8, true);
    const vals = [];
    for (let k = 0; k < count; k++) {
      const o = off + k * (TYPE_SIZE[type] || 1);
      switch (type) {
        case 3: vals.push(dv.getUint16(o, true)); break;
        case 4: vals.push(dv.getUint32(o, true)); break;
        case 12: vals.push(dv.getFloat64(o, true)); break;
        case 16: vals.push(Number(dv.getBigUint64(o, true))); break;
        default: vals.push(dv.getUint8(o));
      }
    }
    tags.set(tag, vals);
  }
  const t = (id, d) => (tags.has(id) ? tags.get(id) : d);

  const width = t(256)[0], height = t(257)[0];
  const bps = t(258, [8])[0];
  const compression = t(259, [1])[0];
  const predictor = t(317, [1])[0];
  const sampleFormat = t(339, [1])[0];
  const tw = t(322)?.[0], th = t(323)?.[0];
  if (!tw) throw new Error('only tiled TIFFs are supported');
  const offsets = t(324), counts = t(325);
  const isFloat = sampleFormat === 3 && bps === 32;
  if (!isFloat && !(bps === 8 && sampleFormat === 1)) throw new Error(`unsupported sample format ${sampleFormat}/${bps}`);

  // Georeferencing: pixel scale + tiepoint, raster type (1 = PixelIsArea, 2 = PixelIsPoint).
  const [sx, sy] = t(33550);
  const tie = t(33922);
  const keys = t(34735, []);
  let rasterType = 1;
  for (let k = 4; k + 3 < keys.length; k += 4) if (keys[k] === 1025) rasterType = keys[k + 3];
  // Geographic coordinate of the CENTRE of pixel (0,0).
  const halfPx = rasterType === 1 ? 0.5 : 0;
  const lon0 = tie[3] + (halfPx - tie[0]) * sx;
  const lat0 = tie[4] - (halfPx - tie[1]) * sy;

  const out = isFloat ? new Float32Array(width * height) : new Uint8Array(width * height);
  const bpp = bps / 8;
  const tilesX = Math.ceil(width / tw);
  const rowBytes = tw * bpp;
  const tmp = new Uint8Array(rowBytes);
  const f32 = new Float32Array(1), f32b = new Uint8Array(f32.buffer);

  for (let k = 0; k < offsets.length; k++) {
    let raw = buf.subarray(offsets[k], offsets[k] + counts[k]);
    if (compression === 8 || compression === 32946) raw = inflateSync(raw);
    else if (compression !== 1) throw new Error(`compression ${compression} not supported`);
    const ty = Math.floor(k / tilesX), tx = k % tilesX;
    for (let r = 0; r < th; r++) {
      const y = ty * th + r;
      if (y >= height) break;
      const row = raw.subarray(r * rowBytes, (r + 1) * rowBytes);
      if (predictor === 2 || predictor === 3) {
        tmp.set(row);
        const stride = predictor === 2 ? bpp : 1; // predictor 3 differences bytes
        for (let i = stride; i < rowBytes; i++) tmp[i] = (tmp[i] + tmp[i - stride]) & 255;
      } else tmp.set(row);
      for (let c = 0; c < tw; c++) {
        const x = tx * tw + c;
        if (x >= width) break;
        let v;
        if (isFloat) {
          if (predictor === 3) {
            // byte planes, most significant first
            f32b[3] = tmp[c]; f32b[2] = tmp[tw + c]; f32b[1] = tmp[2 * tw + c]; f32b[0] = tmp[3 * tw + c];
          } else {
            f32b[0] = tmp[c * 4]; f32b[1] = tmp[c * 4 + 1]; f32b[2] = tmp[c * 4 + 2]; f32b[3] = tmp[c * 4 + 3];
          }
          v = f32[0];
        } else v = tmp[c];
        out[y * width + x] = v;
      }
    }
  }
  return { width, height, data: out, lon0, lat0, dLon: sx, dLat: sy, rasterType };
}
