import * as maplibregl from '../../static/vendor/maplibre/maplibre-gl.js';
import { buildStyle, registerProtocol, keepLabelsUpright, BOUNDS } from '../../static/js/nyc-basemap.js';

export { maplibregl };
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const MINUS = '−';
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const STORAGE_KEY = 'nyc-cp-theme';
export function storedTheme(fallback) {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : fallback;
  } catch {
    return fallback;
  }
}
function storeTheme(v) {
  try { localStorage.setItem(STORAGE_KEY, v); } catch { /* storage unavailable */ }
}
export const basemapTheme = (theme) => (theme === 'light' ? 'day' : 'night');

/* Style options shared by both apps: street detail, 3D massing once zoomed in. */
const STYLE_OPTIONS = { labels: 'full', buildings3d: { from: 14.2, to: 15.4 } };

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function createMap(container, theme, camera, fallbackImage) {
  if (!webglAvailable()) {
    // Without WebGL, show a still of the map instead of an endless loading state.
    const loading = document.getElementById('loading');
    loading.classList.add('is-fallback');
    loading.style.backgroundImage = `url("${fallbackImage}")`;
    throw new Error('WebGL is not available; showing a static preview.');
  }
  registerProtocol(maplibregl);
  const map = new maplibregl.Map({
    container,
    style: buildStyle({ theme: basemapTheme(theme), ...STYLE_OPTIONS }),
    ...camera,
    maxBounds: [[BOUNDS[0][0] - 0.25, BOUNDS[0][1] - 0.2], [BOUNDS[1][0] + 0.25, BOUNDS[1][1] + 0.2]],
    minZoom: 9,
    maxZoom: 18.5,
    maxPitch: 70,
    attributionControl: { compact: true },
    canvasContextAttributes: { antialias: true },
    dragRotate: true,
    pitchWithRotate: true,
  });
  map.touchZoomRotate.disableRotation();
  keepLabelsUpright(map);
  return map;
}

/**
 * Swap basemap themes in place. MapLibre diffs the two styles and animates the
 * changed paint values; the app's own sources and layers are carried across.
 */
export function swapBasemap(map, theme, ownIds) {
  map.setStyle(buildStyle({ theme: basemapTheme(theme), ...STYLE_OPTIONS }), {
    diff: true,
    transformStyle: (previous, next) => {
      if (!previous) return next;
      const sources = { ...next.sources };
      for (const id of ownIds.sources) if (previous.sources[id]) sources[id] = previous.sources[id];
      const own = previous.layers.filter((l) => ownIds.layers.includes(l.id));
      const layers = [...next.layers];
      for (const layer of own) {
        const beforeIdx = layers.findIndex((l) => l.id === ownIds.before);
        if (beforeIdx === -1) layers.push(layer);
        else layers.splice(beforeIdx, 0, layer);
      }
      return { ...next, sources, layers };
    },
  });
}

export function initThemeToggle(button, initial, onChange) {
  const label = button.querySelector('[data-theme-label]');
  let theme = initial;
  const apply = () => {
    document.body.dataset.theme = theme;
    // The label names the mode the button switches to.
    if (label) label.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
    button.setAttribute('aria-label', theme === 'dark' ? 'Light Mode' : 'Dark Mode');
  };
  apply();
  button.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    storeTheme(theme);
    apply();
    onChange(theme);
  });
  return () => theme;
}

/* Radio-group semantics for segmented controls, including arrow keys. */
export function initSegmented(group, onSelect) {
  const buttons = [...group.querySelectorAll('button')];
  const select = (btn, focus) => {
    for (const b of buttons) {
      const on = b === btn;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (focus) btn.focus();
    onSelect(btn.dataset.value);
  };
  for (const b of buttons) b.tabIndex = b.getAttribute('aria-checked') === 'true' ? 0 : -1;
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn && btn.getAttribute('aria-checked') !== 'true') select(btn, false);
  });
  group.addEventListener('keydown', (e) => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    const i = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    select(buttons[(i + dir + buttons.length) % buttons.length], true);
  });
  return (value) => {
    const btn = buttons.find((b) => b.dataset.value === value);
    for (const b of buttons) {
      b.setAttribute('aria-checked', String(b === btn));
      b.tabIndex = b === btn ? 0 : -1;
    }
  };
}

export function tweenNumber(el, to, format, duration = 700) {
  const from = typeof el._value === 'number' ? el._value : to;
  el._value = to;
  if (reduceMotion || from === to) { el.textContent = format(to); return; }
  const t0 = performance.now();
  cancelAnimationFrame(el._raf);
  const step = (now) => {
    const p = easeOutCubic(clamp01((now - t0) / duration));
    el.textContent = format(from + (to - from) * p);
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

export function initTools(root, map, home) {
  root.querySelector('[data-zoom-in]').addEventListener('click', () => map.zoomIn({ duration: 350 }));
  root.querySelector('[data-zoom-out]').addEventListener('click', () => map.zoomOut({ duration: 350 }));
  root.querySelector('[data-home]').addEventListener('click', () => map.flyTo({ ...home(), duration: reduceMotion ? 0 : 1600, essential: true }));
}

/* Keep floating panels clear of the bottom sheet on small screens. */
export function trackSheet(sheet) {
  const set = () => document.documentElement.style.setProperty('--sheet-h', `${sheet.offsetHeight}px`);
  new ResizeObserver(set).observe(sheet);
  set();
}

export function signed(v, digits = 1) {
  return (v < 0 ? MINUS : v > 0 ? '+' : '') + Math.abs(v).toFixed(digits);
}
