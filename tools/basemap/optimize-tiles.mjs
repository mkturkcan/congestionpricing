// Rewrites a Protomaps PMTiles extract into the lean archive served by this site.
//
//   node optimize-tiles.mjs <input.pmtiles> <output.pmtiles>
//
// - Drops building outlines that contain building:part features, so 3D
//   extrusions show real massing (setbacks, towers) instead of a single box
//   at the outline's roof/mast height.
// - Keeps only the attributes and POI categories that static/js/nyc-basemap.js
//   renders, and folds `name:en` into `name` (the multilingual name:* tags are
//   the bulk of label data and are never displayed).
// Geometry is passed through untouched (same integer coordinates, extent, winding).

import fs from 'node:fs';
import zlib from 'node:zlib';
import { PMTiles, zxyToTileId } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import vtpbf from 'vt-pbf';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node optimize-tiles.mjs <input.pmtiles> <output.pmtiles>');
  process.exit(1);
}

const KEEP = {
  earth: ['kind', 'name'],
  landcover: ['kind'],
  landuse: ['kind'],
  water: ['kind', 'kind_detail', 'name', 'min_zoom'],
  roads: ['kind', 'kind_detail', 'is_bridge', 'is_tunnel', 'is_link', 'name', 'min_zoom'],
  buildings: ['kind', 'height', 'min_height'],
  places: ['kind', 'kind_detail', 'name', 'min_zoom', 'population_rank', 'sort_key'],
  pois: ['kind', 'kind_detail', 'name', 'min_zoom'],
  boundaries: ['kind', 'kind_detail', 'disputed'],
};
const POI_KINDS = new Set(['park', 'nature_reserve', 'aerodrome', 'university', 'college', 'zoo', 'stadium', 'beach']);

class FileSource {
  constructor(path) { this.fd = fs.openSync(path, 'r'); this.path = path; }
  getKey() { return this.path; }
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length);
    fs.readSync(this.fd, buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + length) };
  }
}

function slimProperties(layerName, props) {
  const keep = KEEP[layerName];
  if (!keep) return null;
  const out = {};
  for (const key of keep) {
    const value = key === 'name' ? (props['name:en'] ?? props.name) : props[key];
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}

function ringPoint(ring) {
  // Mean of the ring's vertices (closing vertex excluded); inside for the
  // near-convex shapes building parts almost always are.
  const n = ring.length > 1 ? ring.length - 1 : ring.length;
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) { x += ring[i].x; y += ring[i].y; }
  return { x: x / n, y: y / n };
}

function insideRings(pt, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

function bbox(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ring of rings) for (const p of ring) {
    if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y;
  }
  return [x0, y0, x1, y1];
}

function makeFeature(src, properties, geometry) {
  return { id: src.id, type: src.type, properties, loadGeometry: () => geometry };
}

function transformTile(raw) {
  const tile = new VectorTile(new PbfReader(raw));
  const layers = {};
  const stats = { droppedOutlines: 0 };

  for (const [name, layer] of Object.entries(tile.layers)) {
    if (!KEEP[name]) continue;
    const features = [];
    const parts = [];
    const outlines = [];

    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      const p = f.properties;
      if (name === 'pois' && (!POI_KINDS.has(p.kind) || (p.min_zoom ?? 0) > 15)) continue;
      const geometry = f.loadGeometry();
      const feature = makeFeature(f, slimProperties(name, p), geometry);
      if (name === 'buildings' && f.type === 3) {
        if (p.kind === 'building_part') parts.push({ pt: ringPoint(geometry[0]), feature });
        else outlines.push({ box: bbox(geometry), geometry, feature });
      }
      features.push(feature);
    }

    let kept = features;
    if (name === 'buildings' && parts.length && outlines.length) {
      const drop = new Set();
      for (const o of outlines) {
        const [x0, y0, x1, y1] = o.box;
        for (const part of parts) {
          const { x, y } = part.pt;
          if (x < x0 || x > x1 || y < y0 || y > y1) continue;
          if (insideRings(part.pt, o.geometry)) { drop.add(o.feature); break; }
        }
      }
      stats.droppedOutlines += drop.size;
      kept = features.filter((f) => !drop.has(f));
    }

    if (!kept.length) continue;
    layers[name] = {
      name,
      version: layer.version,
      extent: layer.extent,
      length: kept.length,
      feature: (i) => kept[i],
    };
  }
  return { bytes: vtpbf.fromVectorTileJs({ layers }), stats };
}

// ---- minimal PMTiles v3 writer (spec: github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md)
function writeVarint(out, value) {
  let v = BigInt(value);
  while (v >= 0x80n) { out.push(Number((v & 0x7fn) | 0x80n)); v >>= 7n; }
  out.push(Number(v));
}

function serializeDirectory(entries) {
  const out = [];
  writeVarint(out, entries.length);
  let lastId = 0;
  for (const e of entries) { writeVarint(out, e.tileId - lastId); lastId = e.tileId; }
  for (const e of entries) writeVarint(out, e.runLength);
  for (const e of entries) writeVarint(out, e.length);
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    if (i > 0 && e.offset === prev.offset + prev.length) writeVarint(out, 0);
    else writeVarint(out, e.offset + 1);
  });
  return zlib.gzipSync(Buffer.from(out));
}

function buildDirectories(entries) {
  const rootMax = 16384 - 127;
  const whole = serializeDirectory(entries);
  if (whole.length <= rootMax) return { root: whole, leaves: Buffer.alloc(0) };
  for (let leafSize = 4096; ; leafSize *= 2) {
    const rootEntries = [];
    const leafBuffers = [];
    let leafOffset = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const leaf = serializeDirectory(entries.slice(i, i + leafSize));
      rootEntries.push({ tileId: entries[i].tileId, offset: leafOffset, length: leaf.length, runLength: 0 });
      leafBuffers.push(leaf);
      leafOffset += leaf.length;
    }
    const root = serializeDirectory(rootEntries);
    if (root.length <= rootMax) return { root, leaves: Buffer.concat(leafBuffers) };
  }
}

function serializeHeader(h) {
  const b = Buffer.alloc(127);
  b.write('PMTiles', 0, 'ascii');
  b.writeUInt8(3, 7);
  const u64 = [h.rootOffset, h.rootLength, h.metadataOffset, h.metadataLength, h.leafOffset, h.leafLength,
    h.tileDataOffset, h.tileDataLength, h.addressedTiles, h.tileEntries, h.tileContents];
  u64.forEach((v, i) => b.writeBigUInt64LE(BigInt(v), 8 + i * 8));
  let o = 96;
  for (const v of [h.clustered ? 1 : 0, 2 /* gzip */, 2 /* gzip */, 1 /* mvt */, h.minZoom, h.maxZoom]) b.writeUInt8(v, o++);
  for (const v of [h.minLonE7, h.minLatE7, h.maxLonE7, h.maxLatE7]) { b.writeInt32LE(v, o); o += 4; }
  b.writeUInt8(h.centerZoom, o++);
  b.writeInt32LE(h.centerLonE7, o); o += 4;
  b.writeInt32LE(h.centerLatE7, o);
  return b;
}

// ---- main
const archive = new PMTiles(new FileSource(input));
const header = await archive.getHeader();
const metadata = await archive.getMetadata();

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);

const tiles = [];
let before = 0, after = 0, droppedOutlines = 0;
for (let z = header.minZoom; z <= header.maxZoom; z++) {
  for (let x = lon2x(header.minLon, z); x <= lon2x(header.maxLon, z); x++) {
    for (let y = lat2y(header.maxLat, z); y <= lat2y(header.minLat, z); y++) {
      const t = await archive.getZxy(z, x, y);
      if (!t) continue;
      const raw = Buffer.from(t.data); // the reader returns decompressed tile bytes
      const { bytes, stats } = transformTile(raw);
      const gz = zlib.gzipSync(Buffer.from(bytes), { level: 9 });
      before += raw.length; after += bytes.length; droppedOutlines += stats.droppedOutlines;
      tiles.push({ tileId: zxyToTileId(z, x, y), data: gz });
    }
  }
}
tiles.sort((a, b) => a.tileId - b.tileId);

// De-duplicate identical tiles (open ocean, empty land) and run-length encode.
const entries = [];
const offsets = new Map();
const chunks = [];
let dataLength = 0;
for (const t of tiles) {
  const key = t.data.toString('base64');
  const last = entries[entries.length - 1];
  if (offsets.has(key)) {
    const off = offsets.get(key);
    if (last && last.offset === off && last.tileId + last.runLength === t.tileId) { last.runLength++; continue; }
    entries.push({ tileId: t.tileId, offset: off, length: t.data.length, runLength: 1 });
  } else {
    offsets.set(key, dataLength);
    entries.push({ tileId: t.tileId, offset: dataLength, length: t.data.length, runLength: 1 });
    chunks.push(t.data);
    dataLength += t.data.length;
  }
}

metadata.description = `${metadata.description ?? 'Protomaps basemap'}; optimized for mkturkcan.github.io/congestionpricing`;
const metaBytes = zlib.gzipSync(Buffer.from(JSON.stringify(metadata)));
const { root, leaves } = buildDirectories(entries);
const rootOffset = 127;
const metadataOffset = rootOffset + root.length;
const leafOffset = metadataOffset + metaBytes.length;
const tileDataOffset = leafOffset + leaves.length;
const headerBytes = serializeHeader({
  rootOffset, rootLength: root.length,
  metadataOffset, metadataLength: metaBytes.length,
  leafOffset, leafLength: leaves.length,
  tileDataOffset, tileDataLength: dataLength,
  addressedTiles: tiles.length, tileEntries: entries.length, tileContents: offsets.size,
  clustered: true, minZoom: header.minZoom, maxZoom: header.maxZoom,
  minLonE7: Math.round(header.minLon * 1e7), minLatE7: Math.round(header.minLat * 1e7),
  maxLonE7: Math.round(header.maxLon * 1e7), maxLatE7: Math.round(header.maxLat * 1e7),
  centerZoom: 12, centerLonE7: Math.round(-73.985 * 1e7), centerLatE7: Math.round(40.735 * 1e7),
});
fs.writeFileSync(output, Buffer.concat([headerBytes, root, metaBytes, leaves, ...chunks]));

const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
console.log(`${tiles.length} tiles: ${mb(before)} -> ${mb(after)} uncompressed; ${droppedOutlines} building outlines with parts removed`);
console.log(`wrote ${output} (${mb(fs.statSync(output).size)})`);
