# Miami hurricane replay

Static HTML and ES modules, using Aspen’s Cesium 1.133 loader and its fly-to-bounding-sphere, 180-second orbit, reduced-motion and six-second manual-input grace behavior. Streams Esri World Imagery satellite tiles through Cesium’s ArcGIS imagery provider, with source attribution retained in the viewer. No new mapping library or token is required. Desktop rendering uses up to 2× pixel density, phones up to 1.5×, with four-sample anti-aliasing and finer globe tiles. Cloudflare Pages middleware extends Aspen’s Cesium CSP with satellite image/connect access to services.arcgisonline.com only on this route.

Refresh annually after NOAA publishes HURDAT2: `python3 scripts/fetch-hurricanes.py` (from the repository root), then commit `hurricanes/data/`.

The script selects the Atlantic file with the greatest end year and latest revision date, handles both six- and eight-digit revision dates, and writes a compact index plus individual storm files and source provenance. Wind is knots; pressure is mb; missing measurements are null. Times are UTC Unix milliseconds. All NOAA downloads happen during preprocessing.

Closest distances minimize the distance to Miami along shortest great-circle arcs between observations. Playback uses the same interpolation, and the readout holds meteorological values at the latest fix rather than inventing intermediate observations. Closest approach is an estimate, not a recorded fix. The 1926 unnamed storm nearest Miami is labeled Great Miami Hurricane; no featured storm IDs are hardcoded.

The initial Miami fly-in does not autoplay the historical timeline. Orbit is disabled for reduced-motion preferences. Playback pauses in background tabs, supports keyboard-operable controls, and remains usable if WebGL fails. Landfalls appear as their timestamps are reached; their complete dates are also available in the text list. The closest-approach callout appears when the timeline reaches that point and persists through the end; scrubbing earlier hides it.

Serve the repo with `python3 -m http.server 8000` for local preview. Production serves the same static files through Cloudflare Pages. Run `node --test test/*.test.mjs` and `python3 -m unittest discover -s test -p '*hurricanes*.py'`.
