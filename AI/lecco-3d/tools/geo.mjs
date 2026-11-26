// Shared local projection: equirectangular around the crop centre, metres.
// x = east, z = south (matches the renderer's world frame).
import { CROP } from '../src/peaks.js';

export function metresPerDegree(latDeg) {
  const p = (latDeg * Math.PI) / 180;
  return {
    lat: 111132.954 - 559.822 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p),
    lon: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p),
  };
}

const MPD = metresPerDegree(CROP.lat);
export const toXZ = (lat, lon) => [(lon - CROP.lon) * MPD.lon, (CROP.lat - lat) * MPD.lat];
export const toLatLon = (x, z) => [CROP.lat - z / MPD.lat, CROP.lon + x / MPD.lon];
export { MPD, CROP };
