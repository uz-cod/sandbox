/* Run at https://overpass-turbo.eu (paste, Run, then Export -> "raw OSM data" -> download)
   and save the file as AI/lecco-3d/data/osm/extra.json. Used for: bridges, real industrial /
   residential / park areas, the Erna cable car, stations and place names. */
[out:json][timeout:180][bbox:45.77,9.235,46.0,9.565];
(
  way["bridge"]["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|pedestrian|footway|cycleway|path)$"];
  way["bridge"]["railway"];
  way["man_made"="bridge"];
  way["landuse"~"^(industrial|commercial|retail|residential)$"];
  relation["landuse"~"^(industrial|commercial|retail|residential)$"];
  way["leisure"~"^(park|pitch|garden)$"];
  way["aerialway"];
  node["aerialway"="station"];
  node["railway"="station"];
  node["place"~"^(town|village|hamlet|suburb|locality)$"];
);
out body geom;
