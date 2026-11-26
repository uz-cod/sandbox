// Starting points: main summits around Lecco, in display order.
// lat/lon are the OpenStreetMap summit nodes; tools/bake-dem.mjs snaps each one to the highest DEM sample
// within `radius` metres and stores the result in the baked metadata.
// `elev` is the official elevation (null = unknown, the UI then shows the DEM value).
// `look` is the point the camera faces on arrival.
const LECCO = { lat: 45.855, lon: 9.392 };

export const PEAKS = [
  { id: 'magnodeno', name: 'Magnodeno', lat: 45.83961, lon: 9.44072, elev: 1241, radius: 120, look: LECCO },
  { id: 'resegone', name: 'Resegone', lat: 45.85841, lon: 9.46886, elev: 1875, radius: 120, look: { lat: 45.862, lon: 9.39 } },
  { id: 'grigna-settentrionale', name: 'Grigna Settentrionale', lat: 45.95340, lon: 9.38768, elev: 2410, radius: 120, look: { lat: 45.88, lon: 9.372 } },
  { id: 'grigna-meridionale', name: 'Grigna Meridionale', lat: 45.92190, lon: 9.39072, elev: 2177, radius: 200, look: LECCO },
  { id: 'san-martino', name: 'Monte San Martino', lat: 45.87467, lon: 9.38729, elev: 1046, radius: 120, look: { lat: 45.845, lon: 9.40 } },
  { id: 'coltignone', name: 'Monte Coltignone', lat: 45.88561, lon: 9.38902, elev: 1471, radius: 450, look: { lat: 45.85, lon: 9.40 } },
  { id: 'monte-barro', name: 'Monte Barro', lat: 45.83079, lon: 9.38021, elev: 922, radius: 120, look: { lat: 45.87, lon: 9.40 } },
  { id: 'moregallo', name: 'Moregallo', lat: 45.86640, lon: 9.34006, elev: 1276, radius: 120, look: { lat: 45.885, lon: 9.40 } },
];

// Crop: 25 x 25 km square centred here (local equirectangular projection, metres).
export const CROP = { lat: 45.885, lon: 9.40, extent: 25000, samples: 1024 };
