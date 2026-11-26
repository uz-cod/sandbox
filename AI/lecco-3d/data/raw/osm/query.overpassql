[out:json][timeout:180];
(
  way["highway"~"^(path|footway|track|bridleway|steps|via_ferrata)$"](45.77,9.235,46.0,9.565);
  relation["route"="hiking"](45.77,9.235,46.0,9.565);
  nwr["tourism"~"^(alpine_hut|wilderness_hut|chalet|guest_house)$"](45.77,9.235,46.0,9.565);
  nwr["amenity"~"^(shelter|restaurant)$"](45.77,9.235,46.0,9.565);
  nwr["man_made"="cross"](45.77,9.235,46.0,9.565);
  node["summit:cross"="yes"](45.77,9.235,46.0,9.565);
  node["natural"~"^(peak|saddle)$"](45.77,9.235,46.0,9.565);
  node["historic"="wayside_cross"](45.77,9.235,46.0,9.565);
);
out body geom;
