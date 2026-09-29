# Self-hosted basemap

The maps on this site no longer depend on a commercial tile provider. Everything
they need is served from this repository:

| Path | What it is |
| --- | --- |
| `static/map/nyc.pmtiles` | Vector tiles for the five boroughs and surroundings (zoom 0–14, OpenStreetMap data via [Protomaps](https://protomaps.com)), read with HTTP range requests |
| `static/map/fonts/*.woff2` | Label fonts (IBM Plex Sans, EB Garamond) rendered by MapLibre's `font-faces` |
| `static/map/fonts/<stack>/*.pbf` | Fallback glyphs (Noto Sans) for any character the label fonts lack |
| `static/js/nyc-basemap.js` | Style builder: night and day themes, 3D buildings, labels, data palettes |
| `static/vendor/` | MapLibre GL JS 6.11.2, PMTiles 4.5.0, MQTT.js 5.16.0 |

Zoom 14 is the deepest level stored; MapLibre over-zooms it for street-level views.
A z15 archive would exceed GitHub's 100 MB file limit.

## Refreshing the map data

1. Install the [`pmtiles` CLI](https://github.com/protomaps/go-pmtiles/releases) and pick a
   daily planet build from <https://maps.protomaps.com/builds/>.
2. Extract New York City:

   ```sh
   pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles tools/basemap/nyc-extract.pmtiles \
     --bbox=-74.32,40.46,-73.63,40.97 --maxzoom=14
   ```

3. Optimize it for this site (drops building outlines that have `building:part`
   children so 3D massing is correct, and strips attributes the style never uses):

   ```sh
   cd tools/basemap
   npm install
   npm run optimize        # writes ../../static/map/nyc.pmtiles
   ```

4. Check the result with `pmtiles verify ../../static/map/nyc.pmtiles`.

## The hero's opening still

`static/images/hero-start.webp` is a 2560×1440 capture of the landing-page map's
first frame (night theme, water labels only, camera `[-73.975, 40.735]`, zoom 11.2,
no pitch or padding). It is shown under the live canvas so the hero appears
instantly and the cross-fade is seamless. Re-capture it if the style or that camera
changes (render the style at 2560×1440 CSS pixels, device pixel ratio 1, without the
attribution control).

Map data © OpenStreetMap contributors (ODbL); the attribution control on every map
links to the copyright page.
