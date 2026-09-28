import { buildStyle, registerProtocol, keepLabelsUpright, DATA_BEFORE, DIVERGING, pctClass, rawClass } from './nyc-basemap.js';

// Signals the inline boot check in index.html that scripted reveals are live.
window.__cpBoot = true;

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DATA_URL = new URL('../data/cameras.json', import.meta.url);
const dataPromise = fetch(DATA_URL).then((r) => r.json());

const MINUS = '−';
const fmtSigned = (v, digits = 1) => (v < 0 ? MINUS : v > 0 ? '+' : '') + Math.abs(v).toFixed(digits);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

/* ——— Navigation & scroll-linked hero ——— */

const nav = document.querySelector('[data-nav]');
const hero = document.querySelector('[data-hero]');

function onScroll() {
  const h = hero.offsetHeight;
  const p = clamp01(window.scrollY / (h * 0.9));
  hero.style.setProperty('--hero-p', reduceMotion ? 0 : p.toFixed(4));
  nav.classList.toggle('is-solid', window.scrollY > h - 72);
}
let scrollQueued = false;
addEventListener('scroll', () => {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => { scrollQueued = false; onScroll(); });
}, { passive: true });
addEventListener('resize', onScroll);
onScroll();

/* ——— Hero entrance ——— */

const fontsReady = Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1200))]);
fontsReady.then(() => requestAnimationFrame(() => hero.classList.add('is-intro')));

/* ——— Reveal on scroll ——— */

(function initReveals() {
  const items = [...document.querySelectorAll('[data-reveal]')];
  const byParent = new Map();
  for (const el of items) {
    const group = byParent.get(el.parentElement) ?? [];
    group.push(el);
    byParent.set(el.parentElement, group);
  }
  for (const group of byParent.values()) group.forEach((el, i) => el.style.setProperty('--i', Math.min(i, 8)));
  if (reduceMotion || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('is-in');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  items.forEach((el) => io.observe(el));
})();

/* ——— Hero legend scale ——— */

(function paintScale() {
  const bar = document.querySelector('[data-hero-scale]');
  for (const c of DIVERGING.night) {
    const i = document.createElement('i');
    i.style.background = c;
    bar.append(i);
  }
})();

/* ——— Hero map ——— */

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function heroCamera() {
  const w = innerWidth, h = hero.offsetHeight;
  if (w < 760) {
    return { center: [-73.9960, 40.7262], zoom: 11.8, pitch: 52, bearing: 62, padding: { top: 70, bottom: h * 0.46, left: 0, right: 0 } };
  }
  return {
    center: [-73.9930, 40.7300], zoom: 12.7 + Math.max(0, Math.min(1, (w - 1440) / 1120)) * 0.6, pitch: 58, bearing: 62,
    padding: { top: 0, bottom: h * 0.36, left: Math.min(w * 0.38, 700), right: 0 },
  };
}

async function initHeroMap() {
  const container = document.querySelector('[data-hero-map]');
  if (!webglAvailable()) {
    container.classList.add('is-fallback');
    return;
  }
  // Loaded on demand so the page never depends on the map bundle to render.
  const maplibregl = await import('../vendor/maplibre/maplibre-gl.js');
  registerProtocol(maplibregl);
  const end = heroCamera();
  const start = reduceMotion ? end : { center: [-73.975, 40.735], zoom: 11.2, pitch: 0, bearing: 0, padding: end.padding };

  const map = new maplibregl.Map({
    container,
    style: buildStyle({ theme: 'night', labels: 'minimal', buildings3d: { from: 11.6, to: 12.7 } }),
    ...start,
    interactive: false,
    attributionControl: { compact: true },
    maxPitch: 70,
    fadeDuration: 0,
    canvasContextAttributes: { antialias: true },
  });
  const loaded = new Promise((resolve) => map.once('load', resolve));
  map.getCanvasContainer().setAttribute('aria-hidden', 'true');
  keepLabelsUpright(map);
  const data = await dataPromise;
  await loaded;

  const ring = data.crzPolygon.map(([lat, lon]) => [lon, lat]);
  ring.push(ring[0]);
  const [cx, cy] = ring.slice(0, -1).reduce((a, p) => [a[0] + p[0] / (ring.length - 1), a[1] + p[1] / (ring.length - 1)], [0, 0]);

  const palette = DIVERGING.night;
  const dist = data.cameras.map((cam) => Math.hypot((cam.lon - cx) * 0.76, cam.lat - cy));
  const maxDist = Math.max(...dist);
  const features = data.cameras.map((cam, i) => {
    const pct = cam.all[0];
    return {
      type: 'Feature', id: i,
      properties: { c: palette[pctClass(pct)], r: 2.4 + Math.abs(pct) / 6, crz: cam.crz },
      geometry: { type: 'Point', coordinates: [cam.lon, cam.lat] },
    };
  });
  // Stagger: the bloom radiates outward from the zone.
  const delay = dist.map((d, i) => 0.15 + (d / maxDist) ** 0.8 * 1.9 + (i % 7) * 0.018);

  if (map.getLayer('label-borough')) map.setLayoutProperty('label-borough', 'visibility', 'none');
  const before = map.getLayer(DATA_BEFORE) ? DATA_BEFORE : undefined;
  map.addSource('crz-area', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } } });
  map.addSource('crz-edge', { type: 'geojson', lineMetrics: true, data: { type: 'Feature', geometry: { type: 'LineString', coordinates: ring } } });
  map.addSource('cams', { type: 'geojson', data: { type: 'FeatureCollection', features } });
  map.addSource('pings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  // Growth (g) and ping age (a) are feature-state, so animating never re-tiles a source.
  const G = ['coalesce', ['feature-state', 'g'], 0];
  const AGE = ['coalesce', ['feature-state', 'a'], 0];
  const CU = '#b9d9eb';
  map.addLayer({ id: 'crz-fill', type: 'fill', source: 'crz-area', paint: { 'fill-color': CU, 'fill-opacity': 0, 'fill-opacity-transition': { duration: 1600 } } }, before);
  map.addLayer({ id: 'crz-glow', type: 'line', source: 'crz-edge', layout: { 'line-join': 'round' }, paint: { 'line-color': CU, 'line-width': 12, 'line-blur': 10, 'line-opacity': 0, 'line-opacity-transition': { duration: 1600 } } }, before);
  map.addLayer({ id: 'crz-line', type: 'line', source: 'crz-edge', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-width': 2, 'line-gradient': edgeGradient(reduceMotion ? 1 : 0) } }, before);
  map.addLayer({
    id: 'cams-glow', type: 'circle', source: 'cams',
    paint: { 'circle-color': ['get', 'c'], 'circle-blur': 1, 'circle-pitch-alignment': 'map', 'circle-radius': ['*', ['get', 'r'], 2.6, G], 'circle-opacity': ['*', 0.3, G] },
  }, before);
  map.addLayer({
    id: 'cams', type: 'circle', source: 'cams',
    paint: {
      'circle-color': ['get', 'c'], 'circle-pitch-alignment': 'map', 'circle-radius': ['*', ['get', 'r'], G], 'circle-opacity': 0.95,
      'circle-stroke-color': ['case', ['get', 'crz'], 'rgba(243,240,233,0.92)', 'rgba(7,13,22,0.55)'],
      'circle-stroke-width': ['case', ['get', 'crz'], 1.1, 0.5],
      'circle-stroke-opacity': G,
    },
  }, before);
  map.addLayer({
    id: 'pings', type: 'circle', source: 'pings',
    paint: {
      'circle-color': 'rgba(0,0,0,0)', 'circle-pitch-alignment': 'map', 'circle-stroke-color': ['get', 'c'], 'circle-stroke-width': 1.2,
      'circle-radius': ['+', ['get', 'r'], ['*', 26, ['^', AGE, 0.6]]], 'circle-stroke-opacity': ['*', 0.7, ['-', 1, AGE]],
    },
  }, before);

  const note = document.querySelector('[data-crz-note]');
  const noteAnchor = [-73.9772, 40.7668];
  const placeNote = () => {
    const p = map.project(noteAnchor);
    const x = Math.max(16, Math.min(innerWidth - note.offsetWidth - 16, p.x - note.offsetWidth / 2));
    note.style.transform = `translate(${Math.round(x)}px, ${Math.round(p.y - 38)}px)`;
  };
  map.on('move', placeNote);

  let introDone = reduceMotion;
  let lastWidth = innerWidth;
  addEventListener('resize', () => {
    // Phones fire resize as the URL bar collapses; only a width change needs a new framing.
    if (innerWidth === lastWidth) return;
    lastWidth = innerWidth;
    const cam = heroCamera();
    map.jumpTo({ ...cam, bearing: introDone ? map.getBearing() : cam.bearing });
    placeNote();
  });

  await new Promise((resolve) => map.once('idle', resolve));
  container.classList.add('is-ready');

  const setAllGrown = () => { for (const f of features) map.setFeatureState({ source: 'cams', id: f.id }, { g: 1 }); };
  if (reduceMotion) {
    setAllGrown();
    map.setPaintProperty('crz-fill', 'fill-opacity', 0.06);
    map.setPaintProperty('crz-glow', 'line-opacity', 0.28);
    placeNote();
    note.classList.add('is-visible');
    return;
  }

  let heroVisible = hero.getBoundingClientRect().bottom > 0;
  if (heroVisible) map.flyTo({ ...end, duration: 5600, curve: 1.2, easing: easeInOutSine, essential: true });
  else map.jumpTo(end);

  const t0 = performance.now();
  const edgeStart = 0.9, edgeDur = 2.6, bloomStart = 1.6;
  const growing = new Set(features.map((f) => f.id));
  const drift = innerWidth >= 760; // phones hold still once the intro settles
  let driftBase = null;
  let lastPing = 0;
  let pingId = 0;
  const pings = [];
  let raf = 0;

  const shouldRun = () => heroVisible && !document.hidden && (!introDone || drift);
  const sync = () => {
    if (shouldRun()) {
      if (!raf) raf = requestAnimationFrame(frame);
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  function frame(now) {
    raf = 0;
    const t = (now - t0) / 1000;
    if (!introDone) {
      map.setPaintProperty('crz-line', 'line-gradient', edgeGradient(easeInOutCubic(clamp01((t - edgeStart) / edgeDur))));
      for (const id of growing) {
        const x = clamp01((t - bloomStart - delay[id]) / 0.75);
        if (x <= 0) continue;
        map.setFeatureState({ source: 'cams', id }, { g: easeOutCubic(x) });
        if (x >= 1) growing.delete(id);
      }
      if (t > edgeStart + edgeDur) {
        map.setPaintProperty('crz-fill', 'fill-opacity', 0.055);
        map.setPaintProperty('crz-glow', 'line-opacity', 0.28);
        if (!note.classList.contains('is-visible')) { placeNote(); note.classList.add('is-visible'); }
      }
      if (!growing.size && t > edgeStart + edgeDur && t > 6) {
        introDone = true;
        map.setPaintProperty('crz-line', 'line-gradient', edgeGradient(1));
        driftBase = { bearing: map.getBearing(), t };
      }
    } else if (driftBase) {
      const dt = t - driftBase.t;
      map.setBearing(driftBase.bearing + Math.sin((dt / 46) * Math.PI * 2) * 5 * Math.min(1, dt / 6));
      if (t - lastPing > 0.85) {
        lastPing = t;
        const f = features[(Math.random() * features.length) | 0];
        pings.push({ type: 'Feature', id: ++pingId, properties: { c: f.properties.c, r: f.properties.r, s: t }, geometry: f.geometry });
        while (pings.length && t - pings[0].properties.s > 2.2) pings.shift();
        map.getSource('pings').setData({ type: 'FeatureCollection', features: pings });
      }
      for (const p of pings) map.setFeatureState({ source: 'pings', id: p.id }, { a: Math.min(1, (t - p.properties.s) / 2.2) });
    }
    if (shouldRun()) raf = requestAnimationFrame(frame);
  }

  // Render only while the hero is on screen and the tab is visible. The intro is
  // time-based, so after a pause it resumes where it should be.
  new IntersectionObserver(([e]) => { heroVisible = e.isIntersecting; sync(); }).observe(hero);
  document.addEventListener('visibilitychange', sync);
  if (!heroVisible) {
    // Opened scrolled past the hero: show the settled state without animating off-screen.
    setAllGrown();
    growing.clear();
  }
  sync();
}

function edgeGradient(p) {
  const on = '#b9d9eb', off = 'rgba(185,217,235,0)';
  if (p <= 0.001) return ['step', ['line-progress'], off, 0.5, off];
  if (p >= 0.999) return ['step', ['line-progress'], on, 0.5, on];
  return ['step', ['line-progress'], on, p, off];
}

initHeroMap().catch((err) => {
  console.error(err);
  document.querySelector('[data-hero-map]').classList.add('is-fallback');
});

/* ——— Results: distribution of per-camera change ——— */

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

async function initResults() {
  const data = await dataPromise;
  const root = document.querySelector('[data-results]');
  const host = root.querySelector('[data-swarm]');
  const tip = root.querySelector('[data-swarm-tip]');
  const titleEl = root.querySelector('[data-chart-title]');
  const statEls = { crz: root.querySelector('[data-stat="crz"]'), control: root.querySelector('[data-stat="control"]') };
  const nEl = root.querySelector('[data-sample-size]');
  const DAY_INDEX = { all: 'all', weekday: 'weekday', weekend: 'weekend' };
  const palette = DIVERGING.night;
  const state = { metric: 'pct', day: 'all' };

  // Axis extents come from the data (every day type) so no camera is pinned to an edge.
  const extent = (i) => data.cameras.reduce(([lo, hi], c) => {
    for (const k of ['all', 'weekday', 'weekend']) { lo = Math.min(lo, c[k][i]); hi = Math.max(hi, c[k][i]); }
    return [lo, hi];
  }, [Infinity, -Infinity]);
  const niceDomain = ([lo, hi], step) => [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
  const DOMAIN = { pct: niceDomain(extent(0), 5), raw: niceDomain(extent(1), 1) };
  const ticks = ([lo, hi], step) => {
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
    return out;
  };
  const TICKS = { pct: ticks(DOMAIN.pct, 10), raw: ticks(DOMAIN.raw, 2) };
  const fmtTick = (m, v) => (v === 0 ? '0' : fmtSigned(v, 0) + (m === 'pct' ? '%' : ''));

  const svg = svgEl('svg', { role: 'img' });
  const gGrid = svgEl('g');
  const gRows = svgEl('g');
  const gDots = svgEl('g');
  const gMedians = svgEl('g');
  svg.append(gGrid, gRows, gDots, gMedians);
  host.prepend(svg);

  const cams = data.cameras;
  const dots = cams.map((cam) => {
    const c = svgEl('circle', { class: 'dot' + (cam.crz ? ' is-crz' : ''), r: 0 });
    gDots.append(c);
    return { cam, el: c, x: 0, y: 0, r: 0, color: '#000', tx: 0, ty: 0, tr: 0, tcolor: '#000', sx: 0, sy: 0, sr: 0 };
  });

  let W = 0, H = 0, layout = null;

  function computeLayout() {
    W = Math.max(300, host.clientWidth);
    const r = W < 520 ? 2.6 : W < 800 ? 3.2 : 3.7;
    const padL = 0, padR = 0, top = 50, rowGap = 72, axisH = 34;
    const [d0, d1] = DOMAIN[state.metric];
    const xs = (v) => padL + ((Math.max(d0, Math.min(d1, v)) - d0) / (d1 - d0)) * (W - padL - padR);
    const idx = state.metric === 'pct' ? 0 : 1;
    const day = DAY_INDEX[state.day];
    const rows = [true, false].map((isCrz) => {
      const members = dots.filter((d) => d.cam.crz === isCrz);
      const placed = [];
      const sorted = [...members].sort((a, b) => a.cam[day][idx] - b.cam[day][idx]);
      const minD = 2 * r + 0.9;
      for (const d of sorted) {
        const x = xs(d.cam[day][idx]);
        const blocks = [];
        for (let k = placed.length - 1; k >= 0; k--) {
          const p = placed[k];
          const dx = x - p.x;
          if (dx > minD) break;
          const h = Math.sqrt(Math.max(0, minD * minD - dx * dx));
          blocks.push([p.y - h, p.y + h]);
        }
        let y = 0;
        if (blocks.length) {
          const candidates = [0];
          for (const [a, b] of blocks) candidates.push(a - 0.01, b + 0.01);
          candidates.sort((u, v) => Math.abs(u) - Math.abs(v));
          y = candidates.find((c) => blocks.every(([a, b]) => c <= a || c >= b));
        }
        placed.push({ x, y, d });
      }
      const extent = placed.reduce((m, p) => Math.max(m, Math.abs(p.y)), 0) + r + 4;
      return { isCrz, placed, extent };
    });
    let y = top;
    for (const row of rows) {
      row.center = y + row.extent;
      row.top = y;
      y += row.extent * 2 + rowGap;
    }
    H = y - rowGap + axisH + 10;
    for (const row of rows) for (const p of row.placed) {
      const v = p.d.cam[day][idx];
      p.d.tx = p.x;
      p.d.ty = row.center + p.y;
      p.d.tr = r;
      p.d.tcolor = palette[state.metric === 'pct' ? pctClass(v) : rawClass(v, data.maxRaw)];
    }
    layout = { xs, rows, r, axisY: H - axisH };
  }

  function drawFrame() {
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('height', H);
    gGrid.replaceChildren();
    gRows.replaceChildren();
    const { xs, rows, axisY } = layout;
    for (const v of TICKS[state.metric]) {
      const x = xs(v);
      gGrid.append(svgEl('line', { class: v === 0 ? 'zero' : 'grid', x1: x, x2: x, y1: 30, y2: axisY }));
      const label = svgEl('text', { class: 'axis-label', x, y: axisY + 22, 'text-anchor': 'middle' });
      label.textContent = fmtTick(state.metric, v);
      gGrid.append(label);
    }
    for (const row of rows) {
      const t = svgEl('text', { class: 'row-label', x: 0, y: row.top - 24 });
      t.textContent = row.isCrz ? 'CRZ (Congestion Relief Zone)' : 'non-CRZ';
      gRows.append(t);
    }
  }

  function drawMedians(animate) {
    const s = data.stats[state.day];
    const key = state.metric === 'pct' ? 'pct' : 'raw';
    gMedians.replaceChildren();
    for (const row of layout.rows) {
      const v = row.isCrz ? s[`crz_median_${key}`] : s[`non_crz_median_${key}`];
      const x = layout.xs(v);
      const top = row.center - row.extent;
      const line = svgEl('line', { class: 'median', x1: x, x2: x, y1: top - 16, y2: row.center + row.extent - 2 });
      const label = svgEl('text', { class: 'median-label', x: x + 7, y: top - 6 });
      label.textContent = fmtSigned(v) + (key === 'pct' ? '%' : '');
      gMedians.append(line, label);
      if (animate && !reduceMotion) {
        line.animate([{ opacity: 0, transform: 'scaleY(0.2)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: 500, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' });
        line.style.transformOrigin = `${x}px ${row.center}px`;
        line.style.transformBox = 'view-box';
        label.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 700, fill: 'backwards' });
      }
    }
  }

  function updateText(animate) {
    const s = data.stats[state.day];
    const isPct = state.metric === 'pct';
    titleEl.textContent = isPct ? 'Change in Peak Observed Car Count per Frame (%)' : 'Change in Peak Observed Car Count per Frame (Count)';
    const targets = {
      crz: isPct ? s.crz_median_pct : s.crz_median_raw,
      control: isPct ? s.non_crz_median_pct : s.non_crz_median_raw,
    };
    for (const [k, el] of Object.entries(statEls)) {
      const to = targets[k];
      const from = el._shown ?? to;
      const render = (v) => { el._shown = v; el.textContent = fmtSigned(v) + (isPct ? '%' : ''); };
      cancelAnimationFrame(el._raf);
      if (!animate || reduceMotion || from === to) { render(to); continue; }
      const t0 = performance.now();
      const step = (now) => {
        const p = easeOutCubic(clamp01((now - t0) / 900));
        render(from + (to - from) * p);
        if (p < 1) el._raf = requestAnimationFrame(step);
      };
      el._raf = requestAnimationFrame(step);
    }
    nEl.textContent = s.crz_n + ' CRZ cameras • ' + s.non_crz_n + ' non-CRZ cameras';
    svg.setAttribute('aria-label', `${titleEl.textContent}. CRZ (Congestion Relief Zone): ${fmtSigned(targets.crz)}${isPct ? '%' : ''}. non-CRZ: ${fmtSigned(targets.control)}${isPct ? '%' : ''}. ${nEl.textContent}.`);
  }

  function applyDots() {
    for (const d of dots) {
      d.el.setAttribute('cx', d.x.toFixed(2));
      d.el.setAttribute('cy', d.y.toFixed(2));
      d.el.setAttribute('r', Math.max(0, d.r).toFixed(2));
      d.el.setAttribute('fill', d.color);
    }
  }

  let anim = null;
  function transition(mode) {
    // mode: 'intro' drops dots into place, 'morph' moves them, 'jump' snaps.
    for (const d of dots) {
      d.sx = d.x; d.sy = d.y; d.sr = d.r;
      if (mode === 'intro') { d.sx = d.tx; d.sy = d.ty - 26; d.sr = 0; }
      d.color = d.tcolor;
    }
    if (anim) cancelAnimationFrame(anim);
    if (mode === 'jump' || reduceMotion) {
      for (const d of dots) { d.x = d.tx; d.y = d.ty; d.r = d.tr; }
      applyDots();
      return;
    }
    const dur = mode === 'intro' ? 900 : 750;
    const spread = mode === 'intro' ? 700 : 160;
    const t0 = performance.now();
    const step = (now) => {
      let active = false;
      for (const d of dots) {
        const delay = ((d.tx / W) * spread) | 0;
        const p = clamp01((now - t0 - delay) / dur);
        if (p < 1) active = true;
        const e = mode === 'intro' ? easeOutCubic(p) : easeInOutCubic(p);
        d.x = d.sx + (d.tx - d.sx) * e;
        d.y = d.sy + (d.ty - d.sy) * e;
        d.r = d.sr + (d.tr - d.sr) * (mode === 'intro' ? easeOutCubic(clamp01(p * 1.6)) : e);
      }
      applyDots();
      anim = active ? requestAnimationFrame(step) : null;
    };
    anim = requestAnimationFrame(step);
  }

  let shown = false;
  function render(mode) {
    computeLayout();
    drawFrame();
    drawMedians(mode !== 'jump');
    updateText(mode !== 'jump');
    transition(mode);
  }

  // Controls: radio-group semantics with arrow-key support.
  for (const group of root.querySelectorAll('[data-control]')) {
    const buttons = [...group.querySelectorAll('button')];
    const select = (btn, focus) => {
      buttons.forEach((b) => {
        const on = b === btn;
        b.setAttribute('aria-checked', on);
        b.tabIndex = on ? 0 : -1;
      });
      if (focus) btn.focus();
      state[group.dataset.control] = btn.dataset.value;
      if (shown) {
        render('morph');
      } else {
        computeLayout();
        drawFrame();
        updateText(true);
      }
    };
    buttons.forEach((b) => { b.tabIndex = b.getAttribute('aria-checked') === 'true' ? 0 : -1; });
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn && btn.getAttribute('aria-checked') !== 'true') select(btn, false);
    });
    group.addEventListener('keydown', (e) => {
      const i = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      select(buttons[(i + dir + buttons.length) % buttons.length], true);
    });
  }

  // Hover: nearest dot within reach, so small marks are easy to hit.
  let hovered = null;
  function setHover(d) {
    if (hovered === d) return;
    hovered?.el.classList.remove('is-hover');
    hovered = d;
    if (!d) { tip.hidden = true; return; }
    d.el.classList.add('is-hover');
    gDots.append(d.el);
    const day = DAY_INDEX[state.day];
    const [pct, raw, before, after] = d.cam[day];
    tip.innerHTML = '';
    const name = document.createElement('div');
    name.className = 'tip__name';
    name.textContent = d.cam.name;
    const dl = document.createElement('dl');
    dl.className = 'tip__grid';
    const row = (k, v, cls) => {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); if (cls) dd.className = cls;
      if (v instanceof Node) dd.append(v); else dd.textContent = v;
      dl.append(dt, dd);
    };
    row('Before:', `${before.toFixed(1)} vehicles`);
    row('After:', `${after.toFixed(1)} vehicles`);
    const change = document.createElement('span');
    const sw = document.createElement('span');
    sw.className = 'tip__swatch';
    sw.style.background = DIVERGING.day[pctClass(pct)];
    change.append(sw, `${fmtSigned(pct)}% (${fmtSigned(raw)})`);
    row('Change:', change, 'tip__change');
    row('Zone:', d.cam.crz ? 'CRZ' : 'non-CRZ');
    tip.append(name, dl);
    tip.hidden = false;
    const scale = host.clientWidth / W;
    const x = Math.max(120, Math.min(host.clientWidth - 120, d.x * scale));
    tip.style.left = `${x}px`;
    tip.style.top = `${d.y * scale - d.r}px`;
  }
  const nearest = (e) => {
    const rect = svg.getBoundingClientRect();
    const scale = W / rect.width;
    const px = (e.clientX - rect.left) * scale, py = (e.clientY - rect.top) * scale;
    let best = null, bestD = (e.pointerType === 'touch' ? 22 : 14) * scale;
    for (const d of dots) {
      const dist = Math.hypot(d.x - px, d.y - py);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  };
  host.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') setHover(nearest(e)); });
  host.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') setHover(nearest(e)); });
  host.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') setHover(null); });
  document.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && !host.contains(e.target)) setHover(null); });

  let resizeTimer = 0;
  let measured = host.clientWidth;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (Math.abs(host.clientWidth - measured) <= 2) return;
      measured = host.clientWidth;
      if (shown) {
        render('jump');
      } else {
        computeLayout();
        drawFrame();
      }
    }, 120);
  }).observe(host);

  // Frame and numbers are ready immediately; the dots fall in when the chart is seen.
  computeLayout();
  drawFrame();
  updateText(false);
  const statsBlock = root.querySelector('.results__stats');
  if (!reduceMotion && 'IntersectionObserver' in window && !statsBlock.classList.contains('is-in')) {
    // The block is still hidden (it fades in on reveal), so counting up from zero causes no visible jump.
    const countIO = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      countIO.disconnect();
      for (const el of Object.values(statEls)) el._shown = 0;
      updateText(true);
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    countIO.observe(statsBlock);
  }
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    shown = true;
    render('intro');
  }, { threshold: 0.25 });
  io.observe(host);
}

initResults().catch((err) => console.error(err));

/* ——— Lightbox ——— */

(function initLightbox() {
  const dialog = document.querySelector('[data-lightbox]');
  const open = document.querySelector('[data-lightbox-open]');
  if (!dialog || !open || typeof dialog.showModal !== 'function') return;
  open.addEventListener('click', () => dialog.showModal());
  dialog.querySelector('[data-lightbox-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
})();

/* ——— BibTeX: tint entry types and field names ——— */

for (const code of document.querySelectorAll('.bib code')) {
  const text = code.textContent;
  const frag = document.createDocumentFragment();
  const re = /(@\w+)(?=\{)|^(\s*)(\w+)(\s*=)/gm;
  let last = 0, m;
  while ((m = re.exec(text))) {
    frag.append(text.slice(last, m.index));
    if (m[1]) {
      const span = document.createElement('span'); span.className = 'bib-type'; span.textContent = m[1]; frag.append(span);
    } else {
      frag.append(m[2]);
      const span = document.createElement('span'); span.className = 'bib-field'; span.textContent = m[3]; frag.append(span, m[4]);
    }
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  code.replaceChildren(frag);
}

/* ——— Copy BibTeX ——— */

for (const btn of document.querySelectorAll('[data-copy]')) {
  btn.addEventListener('click', async () => {
    const text = btn.parentElement.querySelector('code').textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(btn.parentElement.querySelector('code'));
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('copy');
      sel.removeAllRanges();
    }
    btn.classList.add('is-copied');
    setTimeout(() => btn.classList.remove('is-copied'), 1800);
  });
}

