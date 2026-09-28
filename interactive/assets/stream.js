import {
  maplibregl, createMap, swapBasemap, initThemeToggle, initTools, trackSheet, storedTheme, reduceMotion, easeInOutCubic,
} from './ui.js';
import { DATA_BEFORE, SEQUENTIAL, countClass } from '../../static/js/nyc-basemap.js';

window.__appBoot = true;

// MQTT Configuration (WebSocket)
const MQTT_BROKER = 'wss://broker.hivemq.com:8884/mqtt';
const MQTT_TOPIC = 'nyc/traffic/batch';

const state = { theme: storedTheme('light'), showEmpty: true };
const app = document.querySelector('[data-app]');
const isSmall = () => innerWidth <= 700 || innerHeight <= 500;

// Filter state
const filters = {
  bikes: true,      // class_1
  cars: true,       // class_2
  motorcycles: true, // class_3
  buses: true,      // class_5
  trucks: true,     // class_7
};
const CLASS_KEYS = { bikes: 'class_1_count', cars: 'class_2_count', motorcycles: 'class_3_count', buses: 'class_5_count', trucks: 'class_7_count' };

function getFilteredCount(data) {
  let count = 0;
  for (const key of Object.keys(filters)) if (filters[key]) count += data[CLASS_KEYS[key]] || 0;
  return count;
}
function getRadius(count) {
  if (count === 0) return 3;
  return Math.max(4, Math.min(20, 4 + count * 0.8));
}

/* ——— Map ——— */

function homeCamera() {
  if (innerWidth <= 700) {
    const sheet = document.querySelector('[data-sheet]').offsetHeight;
    return { center: [-73.95, 40.715], zoom: 9.85, bearing: 0, pitch: 0, padding: { top: 90, bottom: sheet + 70, left: 0, right: 0 } };
  }
  if (innerHeight <= 500) {
    return { center: [-73.95, 40.72], zoom: 10.1, bearing: 0, pitch: 0, padding: { top: 20, bottom: 60, left: Math.min(300, innerWidth * 0.34), right: 60 } };
  }
  return {
    center: [-73.955, 40.725], zoom: innerWidth > 1700 ? 11.1 : 10.75, bearing: 0, pitch: 0,
    padding: { top: 30, bottom: 30, left: Math.min(330, innerWidth * 0.25), right: Math.min(280, innerWidth * 0.2) },
  };
}
const map = createMap('map', state.theme, { center: [-73.94, 40.71], zoom: 9.6, bearing: -12 },
  new URL('../../static/images/preview-stream.webp', import.meta.url).href);

const markerData = new Map(); // data_source -> latest message
const features = new Map();   // data_source -> GeoJSON feature (geometry, class, target radius)
const shown = new Map();      // data_source -> radius currently drawn
const anims = new Map();      // data_source -> { from, to, grow, ripple } (ms timestamps)
let dirty = false;

const OWN = { sources: ['live'], layers: ['live-empty', 'live-ripple', 'live', 'live-focus'], before: DATA_BEFORE };
const ZOOM_SCALE = [9, 0.55, 10, 0.72, 11, 0.9, 12, 1, 14, 1.3, 16, 1.75, 18, 2.2];
const SIZE = isSmall() ? 0.8 : 1;
const zoomScaled = (r, extra = 0) => {
  const stops = [];
  for (let i = 0; i < ZOOM_SCALE.length; i += 2) stops.push(ZOOM_SCALE[i], ['+', ['*', r, ZOOM_SCALE[i + 1] * SIZE], extra]);
  return ['interpolate', ['linear'], ['zoom'], ...stops];
};
// Radius and ripple age live in feature-state: animation never re-tiles the source.
const R = ['coalesce', ['feature-state', 'r'], 0];
const AGE = ['coalesce', ['feature-state', 'a'], 1];

function colorExpr() {
  const ramp = SEQUENTIAL[state.theme === 'light' ? 'day' : 'night'];
  return ['match', ['get', 'cls'], 0, ramp[0], 1, ramp[1], 2, ramp[2], 3, ramp[3], ramp[4]];
}
function themePaint() {
  const dark = state.theme === 'dark';
  map.setPaintProperty('live', 'circle-color', colorExpr());
  map.setPaintProperty('live', 'circle-stroke-color', dark ? 'rgba(3,14,26,0.85)' : 'rgba(255,255,255,0.9)');
  map.setPaintProperty('live-ripple', 'circle-stroke-color', colorExpr());
  map.setPaintProperty('live-empty', 'circle-stroke-color', dark ? '#6f7c8a' : '#9aa3ad');
  map.setPaintProperty('live-focus', 'circle-stroke-color', dark ? '#ffffff' : '#111b29');
  const ramp = SEQUENTIAL[dark ? 'night' : 'day'];
  for (const sw of document.querySelectorAll('[data-bin]')) sw.style.background = ramp[+sw.dataset.bin];
  const scale = document.querySelector('[data-legend-scale]');
  scale.replaceChildren(...ramp.map((c) => { const i = document.createElement('i'); i.style.background = c; return i; }));
}

function addLayers() {
  const before = map.getLayer(DATA_BEFORE) ? DATA_BEFORE : undefined;
  map.addSource('live', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'live-empty', type: 'circle', source: 'live', filter: ['==', ['get', 'cls'], -1],
    paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': zoomScaled(3), 'circle-stroke-width': 1.5, 'circle-stroke-color': '#9aa3ad', 'circle-stroke-opacity': 0.75 },
  }, before);
  map.addLayer({
    id: 'live-ripple', type: 'circle', source: 'live', filter: ['>=', ['get', 'cls'], 0],
    paint: {
      'circle-color': 'rgba(0,0,0,0)', 'circle-radius': zoomScaled(['+', R, ['*', 15, ['^', AGE, 0.6]]]),
      'circle-stroke-width': 1.4, 'circle-stroke-opacity': ['*', 0.55, ['-', 1, AGE]],
    },
  }, before);
  map.addLayer({
    id: 'live', type: 'circle', source: 'live', filter: ['>=', ['get', 'cls'], 0],
    layout: { 'circle-sort-key': ['get', 'r1'] },
    paint: { 'circle-radius': zoomScaled(R), 'circle-opacity': 0.9, 'circle-stroke-width': 1 },
  }, before);
  map.addLayer({
    id: 'live-focus', type: 'circle', source: 'live',
    paint: {
      'circle-color': 'rgba(0,0,0,0)', 'circle-radius': zoomScaled(['max', R, 3], 5), 'circle-stroke-width': 1.6,
      'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, ['boolean', ['feature-state', 'hover'], false], 0.85, 0],
    },
  }, before);
  themePaint();
}

/*
 * ~30 fps while anything is moving: markers grow into new counts and each fresh
 * frame from a camera sends out a ripple. With nothing in motion the loop idles.
 */
const GROW_MS = 550, RIPPLE_MS = 1300;
let lastFrame = 0;
let raf = 0;
const easeOut = (t) => 1 - (1 - t) ** 3;
function frame(ts) {
  raf = 0;
  if (!anims.size) return;
  raf = requestAnimationFrame(frame);
  if (document.hidden || ts - lastFrame < 32) return;
  lastFrame = ts;
  const now = performance.now();
  for (const [key, a] of anims) {
    const g = Math.min(1, Math.max(0, (now - a.grow) / GROW_MS));
    const age = a.ripple === null ? 1 : Math.min(1, Math.max(0, (now - a.ripple) / RIPPLE_MS));
    const r = a.from + (a.to - a.from) * easeOut(g);
    shown.set(key, r);
    map.setFeatureState({ source: 'live', id: key }, { r, a: age });
    if (g >= 1 && age >= 1) anims.delete(key);
  }
}
function animate(key, to, ripple) {
  const now = performance.now();
  const from = shown.get(key) ?? 0;
  if (reduceMotion) {
    shown.set(key, to);
    map.setFeatureState({ source: 'live', id: key }, { r: to, a: 1 });
    return;
  }
  const prev = anims.get(key);
  anims.set(key, {
    from, to,
    grow: from === to && prev ? prev.grow : now,
    ripple: ripple ? now : prev?.ripple ?? null,
  });
  if (!raf) raf = requestAnimationFrame(frame);
}

function flush() {
  if (!dirty || !map.getSource('live')) return;
  dirty = false;
  map.getSource('live').setData({ type: 'FeatureCollection', features: [...features.values()].filter((f) => state.showEmpty || f.properties.cls >= 0) });
}

// Update or create marker
function updateMarker(data, stamp = true) {
  try {
    if (!data || !data.lat || !data.lon) return;
    const key = data.data_source;
    markerData.set(key, data);
    const count = getFilteredCount(data);
    const r1 = count === 0 ? 0 : getRadius(count);
    features.set(key, {
      type: 'Feature', id: key,
      properties: { r1, cls: count === 0 ? -1 : countClass(count) },
      geometry: { type: 'Point', coordinates: [data.lon, data.lat] },
    });
    animate(key, r1, stamp && count > 0);
    dirty = true;
    if (popupKey === key && popup) popup.setDOMContent(popupBody(key));
  } catch {
    // Ignore malformed items
  }
}

// Refresh all markers with current filter state
function refreshMarkers() {
  for (const data of markerData.values()) updateMarker(data, false);
  flush();
}

/* ——— Tooltip / popup ——— */

function popupContent(key) {
  const data = markerData.get(key);
  const totalCount = (data.class_1_count || 0) + (data.class_2_count || 0) + (data.class_3_count || 0) + (data.class_5_count || 0) + (data.class_7_count || 0);
  const wrap = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'tip__name';
  name.textContent = data.name || 'Camera ' + key;
  const dl = document.createElement('dl');
  dl.className = 'tip__grid';
  const row = (k, v, strong) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v; if (strong) dd.className = 'strong';
    dl.append(dt, dd);
  };
  row('Bicycles:', data.class_1_count || 0);
  row('Cars:', data.class_2_count || 0, true);
  row('Motorcycles:', data.class_3_count || 0);
  row('Buses:', data.class_5_count || 0);
  row('Trucks:', data.class_7_count || 0);
  row('Total:', totalCount, true);
  const foot = document.createElement('div');
  foot.className = 'tip__foot';
  foot.textContent = `Updated: ${new Date(data.current_time).toLocaleTimeString()}`;
  wrap.append(name, dl, foot);
  return wrap;
}

function popupBody(key) {
  const el = popupContent(key);
  el.className = 'tip-body';
  return el;
}

const tip = document.querySelector('[data-tip]');
let hoverKey = null;
let popup = null;
let popupKey = null;
function showTip(key) {
  const f = features.get(key);
  if (!f) return;
  const p = map.project(f.geometry.coordinates);
  tip.replaceChildren(popupContent(key));
  tip.style.left = `${p.x}px`;
  tip.style.top = `${p.y - 6}px`;
  tip.classList.add('is-visible');
}
function setHover(key) {
  if (hoverKey === key) return;
  if (hoverKey !== null && features.has(hoverKey)) map.setFeatureState({ source: 'live', id: hoverKey }, { hover: false });
  hoverKey = key;
  if (key === null) { tip.classList.remove('is-visible'); map.getCanvas().style.cursor = ''; return; }
  map.setFeatureState({ source: 'live', id: key }, { hover: true });
  map.getCanvas().style.cursor = 'pointer';
  if (key !== popupKey) showTip(key); else tip.classList.remove('is-visible');
}

/* ——— Status ——— */

const statusDot = document.querySelector('.live-dot');
const lastUpdate = document.getElementById('last-update');
function setStatus(s) { statusDot.dataset.status = s; }
function updateStats() {
  lastUpdate.textContent = new Date().toLocaleTimeString();
  lastUpdate.classList.remove('is-fresh');
  void lastUpdate.offsetWidth;
  lastUpdate.classList.add('is-fresh');
}

// MQTT Connection
function connectMQTT() {
  const client = window.mqtt.connect(MQTT_BROKER, {
    clientId: 'nyc_traffic_viewer_' + Math.random().toString(16).slice(2, 10),
    clean: true,
    reconnectPeriod: 5000,
  });
  client.on('connect', () => {
    setStatus('connected');
    client.subscribe(MQTT_TOPIC, (err) => { if (err) console.error('Subscribe error:', err); });
  });
  client.on('message', (topic, message) => {
    try {
      const data = JSON.parse(message.toString());
      if (Array.isArray(data)) data.forEach((item) => updateMarker(item));
      else updateMarker(data);
      updateStats();
    } catch {
      // Silently ignore parse errors
    }
  });
  client.on('reconnect', () => setStatus('connecting'));
  client.on('offline', () => setStatus('offline'));
  client.on('close', () => { if (statusDot.dataset.status === 'connected') setStatus('offline'); });
  client.on('error', (err) => console.error('MQTT error:', err));
}

/* ——— Controls ——— */

function syncCheckboxes() {
  for (const key of Object.keys(filters)) document.getElementById(`filter-${key}`).checked = filters[key];
}
function clearPresetActive() {
  document.querySelectorAll('.preset').forEach((btn) => btn.setAttribute('aria-pressed', 'false'));
}
const PRESETS = {
  all: { bikes: true, cars: true, motorcycles: true, buses: true, trucks: true },
  cars: { bikes: false, cars: true, motorcycles: false, buses: false, trucks: false },
  bikes: { bikes: true, cars: false, motorcycles: true, buses: false, trucks: false }, // Include motorcycles with bikes
  buses: { bikes: false, cars: false, motorcycles: false, buses: true, trucks: false },
  trucks: { bikes: false, cars: false, motorcycles: false, buses: false, trucks: true },
};
document.querySelectorAll('.preset').forEach((btn) => {
  btn.addEventListener('click', () => {
    clearPresetActive();
    btn.setAttribute('aria-pressed', 'true');
    Object.assign(filters, PRESETS[btn.dataset.preset]);
    syncCheckboxes();
    refreshMarkers();
  });
});
for (const key of Object.keys(filters)) {
  document.getElementById(`filter-${key}`).addEventListener('change', (e) => {
    filters[key] = e.target.checked;
    clearPresetActive();
    refreshMarkers();
  });
}
const advToggle = document.getElementById('advanced-toggle');
const advOptions = document.getElementById('advanced-options');
advToggle.addEventListener('click', () => {
  const open = advToggle.getAttribute('aria-expanded') !== 'true';
  advToggle.setAttribute('aria-expanded', String(open));
  advOptions.hidden = !open;
});
document.getElementById('show-empty-cameras').addEventListener('change', (e) => {
  state.showEmpty = e.target.checked;
  document.getElementById('legend-zero').classList.toggle('is-muted', !state.showEmpty);
  dirty = true;
  flush();
});
const legend = document.querySelector('[data-legend]');
const legendToggle = legend.querySelector('[data-legend-toggle]');
legendToggle.addEventListener('click', () => {
  const open = !legend.classList.contains('is-open');
  legend.classList.toggle('is-open', open);
  legendToggle.setAttribute('aria-expanded', String(open));
});
trackSheet(document.querySelector('[data-sheet]'));

/* ——— Boot ——— */

await new Promise((resolve) => (map.loaded() ? resolve() : map.once('load', resolve)));
addLayers();
connectMQTT();
setInterval(flush, 250);

await new Promise((resolve) => { map.once('idle', resolve); setTimeout(resolve, 8000); });
document.getElementById('loading').classList.add('is-done');
app.classList.add('is-ready');
map.easeTo({ ...homeCamera(), duration: reduceMotion ? 0 : 2400, easing: easeInOutCubic, essential: true });

initThemeToggle(document.getElementById('theme-toggle'), state.theme, (theme) => {
  state.theme = theme;
  popup?.remove();
  const restyle = () => {
    if (!map.getLayer('live')) { map.once('styledata', restyle); return; }
    themePaint();
  };
  swapBasemap(map, theme, OWN);
  restyle();
  document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#0a121d' : '#f5f2ed');
});
initTools(document.querySelector('.tools'), map, homeCamera);

map.on('mousemove', 'live', (e) => setHover(e.features[0].id));
map.on('mouseleave', 'live', () => setHover(null));
map.on('mousemove', 'live-empty', (e) => setHover(e.features[0].id));
map.on('mouseleave', 'live-empty', () => setHover(null));
map.on('move', () => { if (hoverKey !== null && hoverKey !== popupKey) showTip(hoverKey); });
for (const layer of ['live', 'live-empty']) {
  map.on('click', layer, (e) => {
    const key = e.features[0].id;
    popup?.remove();
    tip.classList.remove('is-visible');
    const current = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '300px', offset: 14, focusAfterOpen: false })
      .setLngLat(features.get(key).geometry.coordinates).setDOMContent(popupBody(key)).addTo(map);
    map.setFeatureState({ source: 'live', id: key }, { selected: true });
    current.on('close', () => {
      if (features.has(key)) map.setFeatureState({ source: 'live', id: key }, { selected: false });
      if (popup === current) { popup = null; popupKey = null; }
    });
    popup = current;
    popupKey = key;
  });
}
