/*
 * Self-hosted New York City basemap.
 *
 * Builds MapLibre styles for static/map/nyc.pmtiles (OpenStreetMap data via
 * Protomaps, rebuilt by tools/basemap). Nothing here depends on a third-party
 * tile or glyph service: tiles, fonts and fallback glyphs are all served from
 * this site.
 */

const MAP_DIR = new URL('../map/', import.meta.url).href;

export const TILES_URL = MAP_DIR + 'nyc.pmtiles';
export const ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap</a> ' +
  '<a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a>';

/* Extent of the archive; the camera is kept inside it. */
export const BOUNDS = [[-74.32, 40.46], [-73.63, 40.97]];

/* Data layers are inserted beneath this layer so water and borough names stay legible. */
export const DATA_BEFORE = 'label-water-line';

export const THEMES = {
  night: {
    water: '#030e1a', land: '#18202a', park: '#152922', institutional: '#1c232c', pedestrian: '#1e242c',
    pier: '#212730', industrial: '#171e27', aerodrome: '#1b222b', runway: '#2c333d', sand: '#252a30',
    building: '#212832', building3d: '#28313d', roadMinor: '#26303b', roadMajor: '#303c49', roadHighway: '#3d4c5b',
    rail: '#2e3640', ferry: '#1f3446', coast: '#243b4b', boundary: '#4c5a69',
    labelBorough: '#b8d6e7', labelPlace: '#93a0ae', labelNeighbourhood: '#828e99', labelRoad: '#89939e',
    labelWater: '#6b8ba2', labelPark: '#7b9a8d', halo: '#18202a',
    sky: '#010611', horizon: '#192837', lightIntensity: 0.32,
  },
  day: {
    water: '#b9d9eb', land: '#f5f2ed', park: '#daecd9', institutional: '#f0ece5', pedestrian: '#f9f8f4',
    pier: '#ebe9e5', industrial: '#efece8', aerodrome: '#efece7', runway: '#fbfaf7', sand: '#f4ead5',
    building: '#e5e1db', buildingLine: '#d8d4cd', building3d: '#ece9e4',
    roadMinor: '#ffffff', roadMajor: '#ffffff', roadHighway: '#fffbf4',
    casingMinor: '#dbd9d3', casingMajor: '#d2cfc8', casingHighway: '#c2bdb4',
    rail: '#c1bdb7', ferry: '#8fb5ca', coast: '#9bbdd0', boundary: '#7e8792',
    labelBorough: '#1d4f91', labelPlace: '#3d4958', labelNeighbourhood: '#616a75', labelRoad: '#5e646c',
    labelWater: '#305d7b', labelPark: '#45674c', halo: '#f5f2ed',
    sky: '#d2e8f6', horizon: '#f9f5ec', lightIntensity: 0.4,
  },
};

/*
 * Diverging classes for per-camera change, ordered from the strongest
 * reduction to the strongest increase (green = reduction, red = increase).
 * Steps were validated for lightness order, contrast against each theme's
 * land colour, and protan/deutan separation of same-magnitude pairs.
 */
export const DIVERGING = {
  night: ['#76ebc5', '#3bc59e', '#2a9b7c', '#2a725c', '#7f3c24', '#ba4e25', '#e87045', '#f7a284'],
  day: ['#015b46', '#077b60', '#2a9b7c', '#66b79c', '#e38f72', '#d2643c', '#b4410d', '#892d01'],
};
export const PCT_BREAKS = [-30, -20, -10, 0, 10, 20, 30];
/* Absolute-change classes (Large / Moderate / Small decrease, Small / Moderate / Large increase). */
export const RAW_CLASS_BINS = [0, 2, 3, 4, 5, 7];
export const RAW_BREAKS = [-0.6, -0.2, 0, 0.2, 0.6];

export function pctClass(pct) {
  let i = 0;
  while (i < PCT_BREAKS.length && pct >= PCT_BREAKS[i]) i++;
  return i;
}
export function rawClass(raw, maxRaw) {
  const ratio = raw / maxRaw;
  let i = 0;
  while (i < RAW_BREAKS.length && ratio >= RAW_BREAKS[i]) i++;
  return RAW_CLASS_BINS[i];
}

/* Sequential ramp for live vehicle counts: 1–4, 5–9, 10–19, 20–29, 30+. */
export const SEQUENTIAL = {
  night: ['#3f6f95', '#5b91bd', '#7fb2dc', '#a9d2f2', '#dff0ff'],
  day: ['#7ba1d3', '#5282c1', '#3063a6', '#194781', '#0c2d57'],
};
export const COUNT_BREAKS = [5, 10, 20, 30];
export function countClass(count) {
  let i = 0;
  while (i < COUNT_BREAKS.length && count >= COUNT_BREAKS[i]) i++;
  return i;
}

/*
 * Byte-range source that bypasses the browser HTTP cache. Static hosts such as
 * GitHub Pages attach a short max-age to 206 responses, and some browsers then
 * answer later range requests from the wrong cached fragment. Tiles still stay
 * cached in memory by MapLibre for the session.
 *
 * Requests made without an abort signal are warm-ups (see warmTiles); their
 * responses are held briefly so MapLibre's own request for the same bytes
 * reuses them instead of fetching twice.
 */
class RangeSource {
  constructor(url) {
    this.url = url;
    this.early = new Map();
  }
  getKey() { return this.url; }
  getBytes(offset, length, signal, etag) {
    const key = `${offset}:${length}`;
    const early = this.early.get(key);
    if (early) {
      this.early.delete(key);
      return early;
    }
    const request = this.fetchRange(offset, length, signal, etag);
    if (!signal) {
      this.early.set(key, request);
      request.catch(() => this.early.delete(key));
      setTimeout(() => this.early.delete(key), 20000);
    }
    return request;
  }
  async fetchRange(offset, length, signal, etag) {
    const resp = await fetch(this.url, {
      signal, cache: 'no-store', headers: { range: `bytes=${offset}-${offset + length - 1}` },
    });
    if (resp.status >= 300) throw new Error(`Bad response code: ${resp.status}`);
    const size = resp.headers.get('Content-Length');
    if (resp.status === 200 && (!size || +size > length)) {
      throw new Error('Server returned no content-length header or content-length exceeding request. Check that your storage backend supports HTTP Byte Serving.');
    }
    let tag = resp.headers.get('ETag');
    if (tag && tag.startsWith('W/')) tag = null;
    if (etag && tag && tag !== etag) throw new window.pmtiles.EtagMismatch(`Server returned non-matching ETag ${tag} after one with ${etag}`);
    return { data: await resp.arrayBuffer(), etag: tag || undefined };
  }
}

let archive = null;
function sharedArchive() {
  archive ??= new window.pmtiles.PMTiles(new RangeSource(TILES_URL));
  return archive;
}

let protocolRegistered = false;
export function registerProtocol(maplibregl) {
  if (protocolRegistered) return;
  const protocol = new window.pmtiles.Protocol({ metadata: true });
  protocol.add(sharedArchive());
  maplibregl.addProtocol('pmtiles', protocol.tile);
  protocolRegistered = true;
}

/**
 * Start fetching the archive index and the tiles a camera will show, before
 * MapLibre itself has loaded. `camera` is { center: [lon, lat], zoom } without padding.
 */
export function warmTiles(camera, width, height) {
  if (!window.pmtiles) return;
  const pm = sharedArchive();
  pm.getHeader().catch(() => {});
  if (!camera) return;
  const z = Math.max(0, Math.min(14, Math.floor(camera.zoom)));
  const span = 512 * 2 ** (camera.zoom - z); // on-screen size of one tile at this zoom
  const world = 512 * 2 ** camera.zoom;
  const [lon, lat] = camera.center;
  const px = ((lon + 180) / 360) * world;
  const rad = (lat * Math.PI) / 180;
  const py = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * world;
  for (let x = Math.floor((px - width / 2) / span); x <= Math.floor((px + width / 2) / span); x++) {
    for (let y = Math.floor((py - height / 2) / span); y <= Math.floor((py + height / 2) / span); y++) {
      pm.getZxy(z, x, y).catch(() => {});
    }
  }
}

/*
 * Map-aligned place names (Manhattan follows the island's axis) are flipped by
 * 180° whenever the camera bearing would otherwise turn them upside down.
 */
export function keepLabelsUpright(map) {
  let flipped = null;
  const update = () => {
    const screenAngle = ((-62 - map.getBearing()) % 360 + 540) % 360 - 180;
    const flip = Math.abs(screenAngle) > 90;
    if (flip === flipped || !map.getLayer('label-borough')) return;
    flipped = flip;
    map.setLayoutProperty('label-borough', 'text-rotate', flip ? ['+', ['get', 'rotate'], ['case', ['==', ['get', 'rotate'], 0], 0, 180]] : ['get', 'rotate']);
  };
  map.on('styledata', () => { flipped = null; update(); });
  map.on('rotate', update);
}

/* Hand-placed borough names; Manhattan runs along the island's axis. */
const PLACE_LABELS = {
  type: 'FeatureCollection',
  features: [
    ['Manhattan', -73.9606, 40.7968, -62, 'borough'],
    ['Brooklyn', -73.9447, 40.6502, 0, 'borough'],
    ['Queens', -73.8130, 40.7165, 0, 'borough'],
    ['The Bronx', -73.8660, 40.8466, 0, 'borough'],
    ['Staten Island', -74.1470, 40.5812, 0, 'borough'],
    ['New Jersey', -74.1180, 40.7700, 0, 'state'],
  ].map(([name, lon, lat, rotate, kind]) => ({
    type: 'Feature',
    properties: { name, rotate, kind },
    geometry: { type: 'Point', coordinates: [lon, lat] },
  })),
};

const FONT = {
  sans: ['carto-sans'],
  strong: ['carto-sans-strong'],
  serif: ['carto-serif'],
  italic: ['carto-serif-it'],
};

const zoomExp = (...stops) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops];
const zoomLin = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops];
const isPolygon = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
const isLine = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const isPoint = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false];
const kindIn = (...kinds) => ['match', ['get', 'kind'], kinds, true, false];
const flag = (key) => ['to-boolean', ['get', key]];
const notFlag = (key) => ['!', ['to-boolean', ['get', key]]];
const visibleFrom = (fallback, offset = 0) => ['>=', ['zoom'], ['+', ['coalesce', ['get', 'min_zoom'], fallback], offset]];

const PARK_KINDS = ['park', 'national_park', 'nature_reserve', 'protected_area', 'garden', 'cemetery', 'grave_yard',
  'golf_course', 'grass', 'forest', 'wood', 'scrub', 'grassland', 'meadow', 'heath', 'wetland', 'recreation_ground',
  'playground', 'pitch', 'dog_park', 'village_green', 'allotments', 'orchard', 'farmland', 'zoo'];

/*
 * Road geometry, widths in px. Casings (day only) add a hairline either side.
 */
const ROADS = {
  highway: { filter: ['all', ['==', ['get', 'kind'], 'highway'], notFlag('is_link')], width: zoomExp(5, 0.5, 9, 0.9, 12, 1.6, 15, 5, 18, 15), casing: zoomExp(5, 0.5, 9, 1.4, 12, 2.8, 15, 7, 18, 17.5), color: 'roadHighway', casingColor: 'casingHighway', minzoom: 5 },
  link: { filter: ['all', ['==', ['get', 'kind'], 'highway'], flag('is_link')], width: zoomExp(12, 0, 13, 0.8, 18, 9), casing: zoomExp(12, 0, 13, 1.8, 18, 11), color: 'roadHighway', casingColor: 'casingHighway', minzoom: 12 },
  major: { filter: ['==', ['get', 'kind'], 'major_road'], width: zoomExp(8, 0.3, 12, 1.4, 15, 3, 18, 13), casing: zoomExp(8, 0.3, 12, 2.4, 15, 4.8, 18, 15), color: 'roadMajor', casingColor: 'casingMajor', minzoom: 8 },
  minor: { filter: ['all', ['==', ['get', 'kind'], 'minor_road'], ['!=', ['get', 'kind_detail'], 'service']], width: zoomExp(11, 0, 12.5, 0.5, 15, 2, 18, 11), casing: zoomExp(11, 0, 12.5, 1.1, 15, 3.4, 18, 12.6), color: 'roadMinor', casingColor: 'casingMinor', minzoom: 11 },
  service: { filter: ['all', ['==', ['get', 'kind'], 'minor_road'], ['==', ['get', 'kind_detail'], 'service']], width: zoomExp(13, 0, 18, 6), casing: zoomExp(13, 0, 18, 7.4), color: 'roadMinor', casingColor: 'casingMinor', minzoom: 13 },
  path: { filter: kindIn('path', 'other'), width: zoomExp(14, 0, 16, 0.8, 20, 5), casing: null, color: 'roadMinor', casingColor: null, minzoom: 14 },
};
const ROAD_ORDER = ['path', 'service', 'minor', 'link', 'major', 'highway'];

function roadLayers(t, isDay, group, groupFilter) {
  const layers = [];
  if (isDay) {
    for (const key of ROAD_ORDER) {
      const r = ROADS[key];
      if (!r.casing) continue;
      layers.push({
        id: `${group}-${key}-casing`, type: 'line', source: 'basemap', 'source-layer': 'roads', minzoom: r.minzoom,
        filter: ['all', groupFilter, r.filter],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': t[r.casingColor], 'line-width': r.casing },
      });
    }
  }
  for (const key of ROAD_ORDER) {
    const r = ROADS[key];
    layers.push({
      id: `${group}-${key}`, type: 'line', source: 'basemap', 'source-layer': 'roads', minzoom: r.minzoom,
      filter: ['all', groupFilter, r.filter],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': isDay && r.casingColor && key !== 'service'
          ? zoomLin(r.minzoom + (key === 'highway' ? 5 : 2), t[r.casingColor], r.minzoom + (key === 'highway' ? 7.5 : 4), t[r.color])
          : t[r.color],
        'line-width': r.width,
        ...(key === 'path' ? { 'line-opacity': zoomLin(14, 0, 15, isDay ? 0.9 : 0.7) } : {}),
      },
    });
  }
  return layers;
}

/**
 * @param {object} options
 * @param {'night'|'day'} [options.theme]
 * @param {'full'|'minimal'|'water'|'none'} [options.labels] minimal keeps water and borough names; water keeps water names only
 * @param {boolean|{from:number,to:number}} [options.buildings3d] extrude building heights, rising between two zooms
 */
export function buildStyle({ theme = 'night', labels = 'full', buildings3d = false } = {}) {
  const rise = buildings3d === true ? { from: 13, to: 14.2 } : buildings3d || null;
  const t = THEMES[theme];
  const isDay = theme === 'day';
  const layers = [];

  layers.push({ id: 'background', type: 'background', paint: { 'background-color': t.water } });
  layers.push({ id: 'earth', type: 'fill', source: 'basemap', 'source-layer': 'earth', filter: isPolygon, paint: { 'fill-color': t.land } });

  const landuse = (id, kinds, color, extra = {}) => ({
    id, type: 'fill', source: 'basemap', 'source-layer': 'landuse', filter: ['all', isPolygon, kindIn(...kinds)],
    paint: { 'fill-color': color, ...extra },
  });
  layers.push(landuse('landuse-industrial', ['industrial', 'railway', 'brownfield', 'landfill'], t.industrial, { 'fill-opacity': zoomLin(10, 0, 12, 1) }));
  layers.push(landuse('landuse-institutional', ['school', 'university', 'college', 'hospital', 'kindergarten', 'military', 'naval_base'], t.institutional, { 'fill-opacity': zoomLin(11, 0, 13, 1) }));
  layers.push(landuse('landuse-park', PARK_KINDS, t.park, { 'fill-opacity': zoomLin(8, 0, 10, 1) }));
  layers.push(landuse('landuse-sand', ['beach', 'sand'], t.sand, { 'fill-opacity': zoomLin(10, 0, 12, 1) }));
  layers.push(landuse('landuse-aerodrome', ['aerodrome'], t.aerodrome));
  layers.push(landuse('landuse-runway', ['runway', 'taxiway'], t.runway));
  layers.push(landuse('landuse-pedestrian', ['pedestrian', 'platform'], t.pedestrian, { 'fill-opacity': zoomLin(13, 0, 14.5, 1) }));

  layers.push({ id: 'water', type: 'fill', source: 'basemap', 'source-layer': 'water', filter: isPolygon, paint: { 'fill-color': t.water } });
  layers.push({
    id: 'water-river', type: 'line', source: 'basemap', 'source-layer': 'water', minzoom: 11,
    filter: ['all', isLine, kindIn('river', 'canal', 'stream', 'ditch', 'drain')],
    paint: { 'line-color': t.water, 'line-width': zoomExp(11, 0.5, 15, 2, 18, 6) },
  });
  layers.push({
    id: 'water-coast', type: 'line', source: 'basemap', 'source-layer': 'water', filter: isPolygon,
    layout: { 'line-join': 'round' },
    paint: { 'line-color': t.coast, 'line-width': zoomLin(8, 0.3, 12, 0.8, 16, 1.5), 'line-opacity': zoomLin(8, 0.5, 12, 0.9) },
  });
  layers.push(landuse('landuse-pier', ['pier'], t.pier, { 'fill-opacity': zoomLin(12, 0, 13.5, 1) }));

  layers.push({
    id: 'ferry', type: 'line', source: 'basemap', 'source-layer': 'roads', minzoom: 11,
    filter: ['==', ['get', 'kind'], 'ferry'],
    paint: { 'line-color': t.ferry, 'line-width': zoomLin(11, 0.6, 16, 1.4), 'line-dasharray': [2, 3], 'line-opacity': 0.8 },
  });

  layers.push({
    id: 'buildings', type: 'fill', source: 'basemap', 'source-layer': 'buildings', minzoom: rise ? Math.min(11, rise.from - 1.2) : 12, filter: isPolygon,
    paint: {
      'fill-color': t.building,
      'fill-opacity': rise ? zoomLin(rise.from - 1.2, 0, rise.from - 0.4, 0.7, rise.from + 0.3, 0.7, rise.to, 0) : zoomLin(12, 0, 13.5, 1),
      ...(isDay ? { 'fill-outline-color': t.buildingLine } : {}),
    },
  });

  const surface = ['all', notFlag('is_tunnel'), notFlag('is_bridge')];
  layers.push(...roadLayers(t, isDay, 'road', surface));

  layers.push({
    id: 'rail', type: 'line', source: 'basemap', 'source-layer': 'roads', minzoom: 11,
    filter: ['all', ['==', ['get', 'kind'], 'rail'], notFlag('is_tunnel'), ['!=', ['get', 'kind_detail'], 'subway']],
    paint: { 'line-color': t.rail, 'line-width': zoomExp(11, 0.5, 14, 1, 18, 3), 'line-dasharray': [3, 2] },
  });
  layers.push({
    id: 'rail-elevated', type: 'line', source: 'basemap', 'source-layer': 'roads', minzoom: 12,
    filter: ['all', ['==', ['get', 'kind'], 'rail'], ['==', ['get', 'kind_detail'], 'subway'], notFlag('is_tunnel')],
    paint: { 'line-color': t.rail, 'line-width': zoomExp(12, 0.5, 14, 1, 18, 3) },
  });

  layers.push(...roadLayers(t, isDay, 'bridge', flag('is_bridge')));

  layers.push({
    id: 'boundary-state', type: 'line', source: 'basemap', 'source-layer': 'boundaries',
    filter: ['==', ['get', 'kind'], 'region'],
    paint: { 'line-color': t.boundary, 'line-width': zoomLin(8, 0.6, 14, 1.2), 'line-dasharray': [4, 3], 'line-opacity': 0.55 },
  });

  if (rise) {
    layers.push({
      id: 'buildings-3d', type: 'fill-extrusion', source: 'basemap', 'source-layer': 'buildings', minzoom: rise.from, filter: isPolygon,
      paint: {
        'fill-extrusion-color': t.building3d,
        'fill-extrusion-height': zoomLin(rise.from, 0, rise.to, ['coalesce', ['get', 'height'], 8]),
        'fill-extrusion-base': zoomLin(rise.from, 0, rise.to, ['coalesce', ['get', 'min_height'], 0]),
        'fill-extrusion-opacity': isDay ? 0.92 : 0.94,
        'fill-extrusion-vertical-gradient': true,
      },
    });
  }

  const halo = { 'text-halo-color': t.halo, 'text-halo-width': 1.4, 'text-halo-blur': 0.4 };
  const label = [];
  if (labels === 'full') {
    label.push({
      id: 'label-road-minor', type: 'symbol', source: 'basemap', 'source-layer': 'roads', minzoom: 15,
      filter: ['all', ['has', 'name'], kindIn('minor_road')],
      layout: {
        'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': FONT.sans,
        'text-size': zoomLin(15, 10, 18, 13), 'text-max-angle': 30, 'symbol-spacing': 320,
      },
      paint: { 'text-color': t.labelRoad, ...halo },
    });
    label.push({
      id: 'label-road-major', type: 'symbol', source: 'basemap', 'source-layer': 'roads', minzoom: 12.5,
      filter: ['all', ['has', 'name'], kindIn('highway', 'major_road')],
      layout: {
        'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': FONT.sans,
        'text-size': zoomLin(12.5, 10, 18, 14), 'text-max-angle': 30, 'symbol-spacing': 360,
      },
      paint: { 'text-color': t.labelRoad, ...halo },
    });
    label.push({
      id: 'label-poi', type: 'symbol', source: 'basemap', 'source-layer': 'pois', minzoom: 11,
      filter: ['all', isPoint, ['has', 'name'], visibleFrom(16, 0.5)],
      layout: {
        'text-field': ['get', 'name'], 'text-font': FONT.sans, 'text-size': zoomLin(12, 10.5, 17, 13),
        'text-max-width': 8, 'text-padding': 4, 'symbol-sort-key': ['coalesce', ['get', 'min_zoom'], 16],
      },
      paint: {
        'text-color': ['match', ['get', 'kind'], ['park', 'nature_reserve', 'zoo', 'beach'], t.labelPark, t.labelPlace],
        ...halo,
      },
    });
    label.push({
      id: 'label-neighbourhood', type: 'symbol', source: 'basemap', 'source-layer': 'places', minzoom: 12,
      filter: ['all', ['==', ['get', 'kind'], 'neighbourhood'], ['!=', ['get', 'kind_detail'], 'suburb'], visibleFrom(13, -0.5)],
      layout: {
        'text-field': ['get', 'name'], 'text-font': FONT.strong, 'text-transform': 'uppercase',
        'text-size': zoomLin(12, 9, 16, 11.5), 'text-letter-spacing': 0.12, 'text-max-width': 7,
        'text-padding': 6, 'symbol-sort-key': ['coalesce', ['get', 'min_zoom'], 15],
      },
      paint: { 'text-color': t.labelNeighbourhood, ...halo, 'text-opacity': zoomLin(12, 0, 12.6, 1) },
    });
    label.push({
      id: 'label-macrohood', type: 'symbol', source: 'basemap', 'source-layer': 'places', minzoom: 11, maxzoom: 15,
      filter: ['==', ['get', 'kind'], 'macrohood'],
      layout: {
        'text-field': ['get', 'name'], 'text-font': FONT.strong, 'text-transform': 'uppercase',
        'text-size': zoomLin(11, 10, 14, 12.5), 'text-letter-spacing': 0.18, 'text-max-width': 8, 'text-padding': 8,
      },
      paint: { 'text-color': t.labelPlace, ...halo },
    });
    label.push({
      id: 'label-locality', type: 'symbol', source: 'basemap', 'source-layer': 'places', minzoom: 9,
      filter: ['all', ['==', ['get', 'kind'], 'locality'], ['!=', ['get', 'name'], 'New York'],
        ['any', ['match', ['get', 'kind_detail'], ['city', 'town'], true, false], ['>=', ['zoom'], 13]],
        visibleFrom(12, 1)],
      layout: {
        'text-field': ['get', 'name'], 'text-font': FONT.strong, 'text-size': zoomLin(9, 10.5, 14, 13.5),
        'text-max-width': 8, 'text-padding': 6,
        'symbol-sort-key': ['-', 20, ['coalesce', ['get', 'population_rank'], 0]],
      },
      paint: { 'text-color': t.labelPlace, ...halo },
    });
  }

  if (labels !== 'none') {
    const waterHalo = { 'text-halo-color': t.water, 'text-halo-width': 1.2, 'text-halo-blur': 0.5 };
    label.push({
      id: 'label-water-line', type: 'symbol', source: 'basemap', 'source-layer': 'water', minzoom: 10.5,
      filter: ['all', isLine, ['has', 'name'], kindIn('river', 'strait', 'canal')],
      layout: {
        'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': FONT.italic,
        'text-size': zoomLin(10.5, 12, 14, 15, 17, 18), 'text-letter-spacing': 0.06, 'text-max-angle': 25,
        'symbol-spacing': 480,
      },
      paint: { 'text-color': t.labelWater, ...waterHalo },
    });
    label.push({
      id: 'label-water-point', type: 'symbol', source: 'basemap', 'source-layer': 'water', minzoom: 9,
      filter: ['all', isPoint, ['has', 'name'], visibleFrom(12)],
      layout: {
        'text-field': ['get', 'name'], 'text-font': FONT.italic, 'text-size': zoomLin(9, 12, 14, 16),
        'text-letter-spacing': 0.06, 'text-max-width': 7,
      },
      paint: { 'text-color': t.labelWater, ...waterHalo },
    });
    if (labels !== 'water') label.push({
      id: 'label-borough', type: 'symbol', source: 'places', maxzoom: 15,
      layout: {
        'text-field': ['get', 'name'], 'text-font': FONT.serif, 'text-transform': 'uppercase',
        'text-size': ['interpolate', ['linear'], ['zoom'],
          9, ['match', ['get', 'kind'], 'state', 10, 11.5],
          12, ['match', ['get', 'kind'], 'state', 13, 17],
          14, ['match', ['get', 'kind'], 'state', 15, 22]],
        'text-letter-spacing': 0.32, 'text-rotate': ['get', 'rotate'], 'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport', 'text-allow-overlap': false, 'text-padding': 2,
      },
      paint: {
        'text-color': ['match', ['get', 'kind'], 'state', t.labelPlace, t.labelBorough],
        'text-halo-color': t.halo, 'text-halo-width': 1.6, 'text-halo-blur': 0.6,
        'text-opacity': zoomLin(13.4, 1, 14.6, 0),
      },
    });
  }
  layers.push(...label);

  return {
    version: 8,
    name: `NYC ${theme}`,
    sources: {
      basemap: { type: 'vector', url: 'pmtiles://' + TILES_URL, attribution: ATTRIBUTION },
      places: { type: 'geojson', data: PLACE_LABELS },
    },
    glyphs: MAP_DIR + 'fonts/{fontstack}/{range}.pbf',
    'font-faces': {
      'carto-sans': MAP_DIR + 'fonts/carto-sans.woff2',
      'carto-sans-strong': MAP_DIR + 'fonts/carto-sans-strong.woff2',
      'carto-serif': MAP_DIR + 'fonts/carto-serif.woff2',
      'carto-serif-it': MAP_DIR + 'fonts/carto-serif-it.woff2',
    },
    sky: {
      'sky-color': t.sky, 'horizon-color': t.horizon, 'fog-color': t.land,
      'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.8, 'atmosphere-blend': 0,
    },
    light: { anchor: 'viewport', color: '#ffffff', intensity: t.lightIntensity, position: [1.15, 210, 35] },
    transition: { duration: 500, delay: 0 },
    layers,
  };
}
