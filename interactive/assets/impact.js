import {
  maplibregl, createMap, swapBasemap, initThemeToggle, initSegmented, tweenNumber, initTools, trackSheet,
  storedTheme, reduceMotion, clamp01, easeOutCubic, easeInOutCubic, signed, MINUS,
} from './ui.js';
import { DATA_BEFORE, DIVERGING, pctClass, rawClass, RAW_CLASS_BINS } from '../../static/js/nyc-basemap.js';

window.__appBoot = true;

const data = await fetch(new URL('../../static/data/cameras.json', import.meta.url)).then((r) => r.json());
const FIELDS = { pct: 0, raw: 1, before: 2, after: 3 };

const state = { metric: 'pct', day: 'all', theme: storedTheme('dark') };
const app = document.querySelector('[data-app]');
const isSmall = () => innerWidth <= 700 || innerHeight <= 500;

/* ——— Camera ——— */

function homeCamera() {
  // Matches the original page's opening view (Manhattan-centred), offset for the panels.
  if (innerWidth <= 700) {
    const sheet = document.querySelector('[data-sheet]').offsetHeight;
    return { center: [-73.975, 40.735], zoom: 10.35, bearing: 0, pitch: 0, padding: { top: 150, bottom: sheet + 70, left: 0, right: 0 } };
  }
  if (innerHeight <= 500) {
    return { center: [-73.968, 40.738], zoom: 10.5, bearing: 0, pitch: 0, padding: { top: 20, bottom: 70, left: Math.min(310, innerWidth * 0.36), right: 60 } };
  }
  return {
    center: [-73.968, 40.738], zoom: innerWidth > 1700 ? 11.55 : 11.2, bearing: 0, pitch: 0,
    padding: { top: 30, bottom: 30, left: Math.min(380, innerWidth * 0.28), right: Math.min(280, innerWidth * 0.2) },
  };
}

const map = createMap('map', state.theme, { center: [-73.955, 40.72], zoom: 9.9, bearing: -14 },
  new URL('../../static/images/preview-interactive.webp', import.meta.url).href);
const mapLoaded = new Promise((resolve) => map.once('load', resolve));
const loading = document.getElementById('loading');

/* ——— Encodings ——— */

const palette = () => DIVERGING[state.theme === 'light' ? 'day' : 'night'];
function encode(cam) {
  const v = cam[state.day];
  if (state.metric === 'pct') {
    const pct = v[FIELDS.pct];
    return { r: 4 + Math.abs(pct) / 4, c: palette()[pctClass(pct)] };
  }
  const raw = v[FIELDS.raw];
  return { r: 4 + (Math.abs(raw) / data.maxRaw) * 14, c: palette()[rawClass(raw, data.maxRaw)] };
}

const ring = data.crzPolygon.map(([lat, lon]) => [lon, lat]);
ring.push(ring[0]);
const [cx, cy] = ring.slice(0, -1).reduce((a, p) => [a[0] + p[0] / (ring.length - 1), a[1] + p[1] / (ring.length - 1)], [0, 0]);

// Geometry and identity only. Each marker's current radius and colour live in
// feature-state, so animation never re-tiles the source.
let maxDist = 0;
const features = data.cameras.map((cam, id) => {
  const dist = Math.hypot((cam.lon - cx) * 0.76, cam.lat - cy);
  maxDist = Math.max(maxDist, dist);
  return { type: 'Feature', id, properties: { crz: cam.crz, sort: 0 }, geometry: { type: 'Point', coordinates: [cam.lon, cam.lat] } };
});
const bloomDelay = features.map((f) => {
  const cam = data.cameras[f.id];
  const dist = Math.hypot((cam.lon - cx) * 0.76, cam.lat - cy);
  return 0.1 + (dist / maxDist) ** 0.75 * 1.6 + (f.id % 5) * 0.02;
});
function updateSortKeys() {
  // Small markers draw above large ones; CRZ markers above the rest.
  for (const f of features) f.properties.sort = (f.properties.crz ? 1000 : 0) - encode(data.cameras[f.id]).r;
}
updateSortKeys();
const collection = () => ({ type: 'FeatureCollection', features });

/* ——— Colour interpolation in OKLab ——— */

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function hexToLab(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => toLin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function labToRgb([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return `rgb(${rgb.map((v) => Math.round(Math.max(0, Math.min(1, toSrgb(Math.max(0, v)))) * 255)).join(',')})`;
}

/* ——— Marker animation (feature-state) ——— */

const vis = features.map(() => ({ r: 0, lab: null }));   // what is on screen now
const tweens = new Map();                                 // id -> { from, to, start, dur, ease }
let tweenRaf = 0;

function setMarker(id, r, lab) {
  vis[id].r = r;
  vis[id].lab = lab;
  map.setFeatureState({ source: 'cams', id }, { r, c: labToRgb(lab) });
}
function tweenFrame(now) {
  tweenRaf = 0;
  for (const [id, tw] of tweens) {
    const p = clamp01((now - tw.start) / tw.dur);
    if (p <= 0) continue;
    const e = tw.ease(p);
    const lab = tw.from.lab.map((v, i) => v + (tw.to.lab[i] - v) * e);
    setMarker(id, tw.from.r + (tw.to.r - tw.from.r) * e, lab);
    if (p >= 1) tweens.delete(id);
  }
  if (tweens.size) tweenRaf = requestAnimationFrame(tweenFrame);
}
/** Animate every marker to the current encoding; `delays` staggers the start per marker (seconds). */
function animateMarkers({ duration = 700, delays = null, ease = easeInOutCubic, fromZero = false } = {}) {
  const now = performance.now();
  for (const f of features) {
    const target = encode(data.cameras[f.id]);
    const to = { r: target.r, lab: hexToLab(target.c) };
    const from = fromZero ? { r: 0, lab: to.lab } : { r: vis[f.id].r, lab: vis[f.id].lab ?? to.lab };
    if (reduceMotion) { tweens.delete(f.id); setMarker(f.id, to.r, to.lab); continue; }
    tweens.set(f.id, { from, to, start: now + (delays ? delays[f.id] * 1000 : 0), dur: duration, ease });
  }
  if (!reduceMotion && tweens.size && !tweenRaf) tweenRaf = requestAnimationFrame(tweenFrame);
}

const ZOOM_SCALE = [9, 0.5, 10, 0.68, 11, 0.85, 12, 1, 13, 1.15, 14, 1.35, 16, 1.85, 18, 2.4];
const SIZE = isSmall() ? 0.78 : 1;
function radiusExpr(extra = 0, mult = 1) {
  const r = ['coalesce', ['feature-state', 'r'], 0];
  const stops = [];
  for (let i = 0; i < ZOOM_SCALE.length; i += 2) stops.push(ZOOM_SCALE[i], ['+', ['*', r, ZOOM_SCALE[i + 1] * mult * SIZE], extra]);
  return ['interpolate', ['linear'], ['zoom'], ...stops];
}
const COLOR = ['to-color', ['coalesce', ['feature-state', 'c'], 'rgba(0,0,0,0)']];

const OWN = {
  sources: ['crz-area', 'crz-edge', 'cams'],
  layers: ['crz-fill', 'crz-glow', 'crz-draw', 'crz-line', 'cams-halo', 'cams', 'cams-focus'],
  before: DATA_BEFORE,
};

function themePaint() {
  const dark = state.theme === 'dark';
  const crz = dark ? '#b9d9eb' : '#1d4f91';
  map.setPaintProperty('crz-fill', 'fill-color', crz);
  map.setPaintProperty('crz-fill', 'fill-opacity', dark ? 0.06 : 0.07);
  map.setPaintProperty('crz-glow', 'line-color', crz);
  map.setPaintProperty('crz-glow', 'line-opacity', dark ? 0.26 : 0);
  map.setPaintProperty('crz-line', 'line-color', crz);
  map.setPaintProperty('cams-halo', 'circle-opacity', dark ? 0.22 : 0);
  map.setPaintProperty('cams', 'circle-stroke-color', ['case', ['get', 'crz'], dark ? '#f3f0e9' : '#111b29', dark ? 'rgba(3,14,26,0.75)' : 'rgba(255,255,255,0.95)']);
  map.setPaintProperty('cams-focus', 'circle-stroke-color', dark ? '#ffffff' : '#111b29');
}

function addDataLayers(introProgress) {
  const before = map.getLayer(DATA_BEFORE) ? DATA_BEFORE : undefined;
  map.addSource('crz-area', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } } });
  map.addSource('crz-edge', { type: 'geojson', lineMetrics: true, data: { type: 'Feature', geometry: { type: 'LineString', coordinates: ring } } });
  map.addSource('cams', { type: 'geojson', data: collection() });

  map.addLayer({ id: 'crz-fill', type: 'fill', source: 'crz-area', paint: { 'fill-color': '#b9d9eb', 'fill-opacity': 0, 'fill-opacity-transition': { duration: 1200 } } }, before);
  map.addLayer({ id: 'crz-glow', type: 'line', source: 'crz-edge', layout: { 'line-join': 'round' }, paint: { 'line-color': '#b9d9eb', 'line-width': 10, 'line-blur': 9, 'line-opacity': 0, 'line-opacity-transition': { duration: 1200 } } }, before);
  map.addLayer({ id: 'crz-draw', type: 'line', source: 'crz-edge', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-width': 2.2, 'line-gradient': edgeGradient(introProgress) } }, before);
  map.addLayer({
    id: 'crz-line', type: 'line', source: 'crz-edge', layout: { 'line-join': 'round', visibility: introProgress >= 1 ? 'visible' : 'none' },
    paint: { 'line-color': '#b9d9eb', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 15, 2.6], 'line-dasharray': [3, 2] },
  }, before);
  map.addLayer({
    id: 'cams-halo', type: 'circle', source: 'cams',
    paint: { 'circle-color': COLOR, 'circle-blur': 1, 'circle-radius': radiusExpr(0, 2.3), 'circle-opacity': 0, 'circle-opacity-transition': { duration: 600 } },
  }, before);
  map.addLayer({
    id: 'cams', type: 'circle', source: 'cams',
    layout: { 'circle-sort-key': ['get', 'sort'] },
    paint: {
      'circle-color': COLOR,
      'circle-opacity': 0.9,
      'circle-radius': radiusExpr(),
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['get', 'crz'], 1.4, 0.6], 14, ['case', ['get', 'crz'], 2.4, 1]],
      'circle-stroke-opacity': ['min', 1, ['*', ['coalesce', ['feature-state', 'r'], 0], 0.5]],
      'circle-stroke-color': '#f3f0e9',
    },
  }, before);
  map.addLayer({
    id: 'cams-focus', type: 'circle', source: 'cams',
    paint: {
      'circle-color': 'rgba(0,0,0,0)',
      'circle-radius': radiusExpr(5),
      'circle-stroke-width': 1.6,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, ['boolean', ['feature-state', 'hover'], false], 0.85, 0],
    },
  }, before);
  themePaint();
}

function edgeGradient(p) {
  const on = state.theme === 'dark' ? '#b9d9eb' : '#1d4f91';
  const off = state.theme === 'dark' ? 'rgba(185,217,235,0)' : 'rgba(29,79,145,0)';
  if (p <= 0.001) return ['step', ['line-progress'], off, 0.5, off];
  if (p >= 0.999) return ['step', ['line-progress'], on, 0.5, on];
  return ['step', ['line-progress'], on, p, off];
}

/* ——— Panel & legend ——— */

const fmtPct = (v) => signed(v) + '%';
const fmtRaw = (v) => signed(v);
const PCT_LABELS = [`< ${MINUS}30%`, `${MINUS}30% to ${MINUS}20%`, `${MINUS}20% to ${MINUS}10%`, `${MINUS}10% to 0%`, '0% to +10%', '+10% to +20%', '+20% to +30%', '> +30%'];
const RAW_LABELS = ['Large decrease', 'Moderate decrease', 'Small decrease', 'Small increase', 'Moderate increase', 'Large increase'];

function updatePanel() {
  const stats = data.stats[state.day];
  const isPct = state.metric === 'pct';
  document.getElementById('panel-title').textContent = isPct
    ? 'Change in Peak Observed Car Count per Frame (%) - All Day'
    : 'Change in Peak Observed Car Count per Frame (Count) - All Day';
  tweenNumber(document.getElementById('crz-stat'), stats.crz_median_pct, fmtPct);
  tweenNumber(document.getElementById('control-stat'), stats.non_crz_median_pct, fmtPct);
  tweenNumber(document.getElementById('crz-raw-stat'), stats.crz_median_raw, fmtRaw);
  tweenNumber(document.getElementById('control-raw-stat'), stats.non_crz_median_raw, fmtRaw);
  document.getElementById('sample-size').textContent = `${stats.crz_n} CRZ cameras • ${stats.non_crz_n} non-CRZ cameras`;
}

function updateLegend() {
  const isPct = state.metric === 'pct';
  const pal = palette();
  document.querySelector('[data-legend-title]').textContent = isPct
    ? 'Change in Peak Observed Car Count per Frame (%)'
    : 'Change in Peak Observed Car Count per Frame (Count)';
  const list = document.querySelector('[data-legend-items]');
  const labels = isPct ? PCT_LABELS : RAW_LABELS;
  const colors = isPct ? pal : RAW_CLASS_BINS.map((i) => pal[i]);
  list.replaceChildren(...labels.map((label, i) => {
    const li = document.createElement('li');
    li.className = 'legend__item';
    const sw = document.createElement('span');
    sw.className = 'legend__swatch';
    sw.style.background = colors[i];
    li.append(sw, label);
    return li;
  }));
  const scale = document.querySelector('[data-legend-scale]');
  scale.replaceChildren(...colors.map((c) => { const i = document.createElement('i'); i.style.background = c; return i; }));
}

/* ——— Tooltip / popup ——— */

function tipContent(id) {
  const cam = data.cameras[id];
  const [pct, raw, before, after] = cam[state.day];
  const wrap = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'tip__name';
  name.textContent = cam.name;
  const dl = document.createElement('dl');
  dl.className = 'tip__grid';
  const row = (k, v, strong) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); if (strong) dd.className = 'strong';
    if (v instanceof Node) dd.append(v); else dd.textContent = v;
    dl.append(dt, dd);
  };
  row('Before:', `${before.toFixed(1)} vehicles`);
  row('After:', `${after.toFixed(1)} vehicles`);
  const change = document.createElement('span');
  const sw = document.createElement('span');
  sw.className = 'tip__swatch';
  sw.style.background = palette()[pctClass(pct)];
  change.append(sw, `${signed(pct)}% (${signed(raw)})`);
  row('Change:', change, true);
  row('Zone:', cam.crz ? 'CRZ' : 'non-CRZ');
  wrap.append(name, dl);
  return wrap;
}
function popupBody(id) {
  const el = tipContent(id);
  el.className = 'tip-body';
  return el;
}

const tip = document.querySelector('[data-tip]');
let hoverId = null;
let selectedId = null;
let popup = null;
function clearSelection() {
  if (selectedId !== null) map.setFeatureState({ source: 'cams', id: selectedId }, { selected: false });
  selectedId = null;
}

function showTip(id) {
  const [lon, lat] = features[id].geometry.coordinates;
  const p = map.project([lon, lat]);
  tip.replaceChildren(tipContent(id));
  tip.style.left = `${p.x}px`;
  tip.style.top = `${p.y - 6}px`;
  tip.classList.add('is-visible');
}
function setHover(id) {
  if (hoverId === id) return;
  if (hoverId !== null) map.setFeatureState({ source: 'cams', id: hoverId }, { hover: false });
  hoverId = id;
  if (id === null) {
    tip.classList.remove('is-visible');
    map.getCanvas().style.cursor = '';
    return;
  }
  map.setFeatureState({ source: 'cams', id }, { hover: true });
  map.getCanvas().style.cursor = 'pointer';
  if (id !== selectedId) showTip(id);
  else tip.classList.remove('is-visible');
}
function refreshDetails() {
  if (popup && selectedId !== null) popup.setDOMContent(popupBody(selectedId));
  if (hoverId !== null && hoverId !== selectedId) showTip(hoverId);
}

/* ——— Boot ——— */

await mapLoaded;
addDataLayers(reduceMotion ? 1 : 0);
updatePanel();
updateLegend();

await new Promise((resolve) => { map.once('idle', resolve); setTimeout(resolve, 8000); });
loading.classList.add('is-done');
app.classList.add('is-ready');

if (reduceMotion) {
  map.jumpTo(homeCamera());
  animateMarkers();
  map.setLayoutProperty('crz-line', 'visibility', 'visible');
  map.setLayoutProperty('crz-draw', 'visibility', 'none');
} else {
  map.easeTo({ ...homeCamera(), duration: 2600, easing: easeInOutCubic, essential: true });
  // Markers bloom outward from the zone while its boundary draws itself.
  animateMarkers({ duration: 700, delays: bloomDelay.map((d) => d + 0.8), ease: easeOutCubic, fromZero: true });
  const t0 = performance.now();
  const drawStart = 0.5, drawDur = 1.8;
  const frame = (now) => {
    const t = (now - t0) / 1000;
    map.setPaintProperty('crz-draw', 'line-gradient', edgeGradient(easeInOutCubic(clamp01((t - drawStart) / drawDur))));
    if (t < drawStart + drawDur) {
      requestAnimationFrame(frame);
      return;
    }
    map.setLayoutProperty('crz-line', 'visibility', 'visible');
    map.setLayoutProperty('crz-draw', 'visibility', 'none');
  };
  requestAnimationFrame(frame);
}

function reencode(duration) {
  animateMarkers({ duration });
  updateSortKeys();
  map.getSource('cams').setData(collection());
}

initSegmented(document.getElementById('metric-select'), (v) => { state.metric = v; updatePanel(); updateLegend(); reencode(700); });
initSegmented(document.getElementById('day-select'), (v) => { state.day = v; updatePanel(); reencode(700); refreshDetails(); });

initThemeToggle(document.getElementById('theme-toggle'), state.theme, (theme) => {
  state.theme = theme;
  popup?.remove();
  const restyle = () => {
    if (!map.getLayer('cams')) { map.once('styledata', restyle); return; }
    themePaint();
    map.setPaintProperty('crz-draw', 'line-gradient', edgeGradient(1));
    updateLegend();
    animateMarkers({ duration: 520 });
  };
  swapBasemap(map, theme, OWN);
  restyle();
  document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#0a121d' : '#f5f2ed');
});

initTools(document.querySelector('.tools'), map, homeCamera);

const legend = document.querySelector('[data-legend]');
const legendToggle = legend.querySelector('[data-legend-toggle]');
legendToggle.addEventListener('click', () => {
  const open = !legend.classList.contains('is-open');
  legend.classList.toggle('is-open', open);
  legendToggle.setAttribute('aria-expanded', String(open));
});
trackSheet(document.querySelector('[data-sheet]'));

map.on('mousemove', 'cams', (e) => setHover(e.features[0].id));
map.on('mouseleave', 'cams', () => setHover(null));
map.on('move', () => { if (hoverId !== null && hoverId !== selectedId) showTip(hoverId); });
map.on('click', 'cams', (e) => {
  const id = e.features[0].id;
  popup?.remove();
  clearSelection();
  selectedId = id;
  map.setFeatureState({ source: 'cams', id }, { selected: true });
  tip.classList.remove('is-visible');
  // A fresh popup per click: its close-on-click listener must not see the click that opened it.
  const current = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '300px', offset: 14, focusAfterOpen: false })
    .setLngLat(features[id].geometry.coordinates).setDOMContent(popupBody(id)).addTo(map);
  current.on('close', () => { if (popup === current) { popup = null; clearSelection(); } });
  popup = current;
});
