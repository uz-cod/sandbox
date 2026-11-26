// Starting points: main summits around Lecco, in display order.
// lat/lon are approximate; tools/bake-dem.mjs snaps each one to the highest DEM sample
// within `radius` metres and stores the result in the baked metadata.
// `elev` is the official elevation (null = unknown, the UI then shows the DEM value).
// `look` is the point the camera faces on arrival.
const LECCO = { lat: 45.855, lon: 9.392 };

export const PEAKS = [
  { id: 'magnodeno', name: 'Magnodeno', lat: 45.87458, lon: 9.45208, elev: 1241, radius: 150, look: LECCO },
  { id: 'resegone', name: 'Resegone', lat: 45.85847, lon: 9.46903, elev: 1875, radius: 150, look: { lat: 45.862, lon: 9.39 } },
  { id: 'grigna-settentrionale', name: 'Grigna Settentrionale', lat: 45.95319, lon: 9.38792, elev: 2410, radius: 150, look: { lat: 45.88, lon: 9.372 } },
  { id: 'grigna-meridionale', name: 'Grigna Meridionale', lat: 45.92264, lon: 9.39236, elev: 2177, radius: 150, look: LECCO },
  { id: 'san-martino', name: 'Monte San Martino', lat: 45.87681, lon: 9.39264, elev: null, radius: 100, look: { lat: 45.845, lon: 9.40 } },
  { id: 'coltignone', name: 'Monte Coltignone', lat: 45.88903, lon: 9.38847, elev: 1479, radius: 150, look: { lat: 45.85, lon: 9.40 } },
  { id: 'monte-barro', name: 'Monte Barro', lat: 45.83042, lon: 9.38042, elev: 922, radius: 150, look: { lat: 45.87, lon: 9.40 } },
  { id: 'moregallo', name: 'Moregallo', lat: 45.86625, lon: 9.34042, elev: 1276, radius: 150, look: { lat: 45.885, lon: 9.40 } },
];

// Crop: 25 x 25 km square centred here (local equirectangular projection, metres).
export const CROP = { lat: 45.885, lon: 9.40, extent: 25000, samples: 1024 };
