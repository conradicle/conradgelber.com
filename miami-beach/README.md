# Miami Beach city twin — first working edition

## Realism pilot update

The viewer now contains 127 county 3D models in two bounded areas: 113 around
Ocean Drive and 14 in a Diamond-tower quality-check area. 125 share source IDs with
the base footprint inventory; two county 3D models have no direct 2D ID match.
Those 125 estimated masses are suppressed in both overview and detail geometry,
and Compare restores the original masses. Source models are interpreted geometry,
not current survey-grade replicas.

The Ocean Drive area adds NOAA's October 21, 2023 RGB aerial (0.25 m source pixels,
CC0-1.0), projected roof imagery, a 49 × 49 terrain grid derived from 2021 ground
returns, and city tree locations with nearby laser canopy height estimates. The
vegetation forms are reusable procedural assets, not exact individual tree scans.
There is no claimed imagery coverage for the Diamond area in this dataset.

Height QA uses classified building returns at the 99.5th roof-elevation percentile.
102 of 110 checked Ocean Drive models are within 2 m of those sampled roof elevations;
the median absolute difference is 0.22 m. Different source dates, roof definitions,
classification and sample density limit this comparison. The Diamond tower roof
gaps are explicitly flagged, rather than silently scaling the buildings to a
published architectural height. Unclassified high returns are diagnostic points,
not accepted architecture. See data/realism/validation.json.

The Colony front edge is fitted to footprint 402658. Its facade sign and bands
were checked against the hotel's official exterior reference. Small proportions,
materials and windows remain inferred. The copyrighted reference photo is not
distributed. The earlier generic Colony mass is no longer shown.

The two GLBs are served as explicit gzip assets (about 360 KB combined), decompressed
with the browser's native DecompressionStream, with raw GLB fallback where needed.
Compression is byte-for-byte reversible; no WebAssembly, external runtime service,
new CSP allowance or Google dependency is introduced.

### Rebuild the pilot

Create a Python 3.12 environment and install the pinned packages in
play-src/scripts/miami-beach/requirements.txt. From play-src:

1. Run npm run miami-beach:pilot:geometry.
2. Run scripts/miami-beach/prepare-realism.py with that Python environment.
3. Run scripts/miami-beach/analyze-realism.py with that environment.
4. Run npm run miami-beach:pilot:pack.
5. Run npm run build:miami-beach and npm run test:miami-beach.

Source I3S metadata, geometry buffers, laser LAZ tiles and analysis arrays stay
under the ignored raw/ tree. NOAA imagery is read with geographic window requests;
entire 400–500 MB imagery files are not needed. Raw survey data is never shipped.
The pilot is a bounded addition: citywide height replacement, crown reconstruction,
ground imagery and measured terrain outside it remain future work.

Sources: [county models](https://www.arcgis.com/home/item.html?id=ce420278a45a4bf4a349c37c197263b3),
[NOAA imagery](https://www.fisheries.noaa.gov/inport/item/71599),
[NOAA laser survey](https://www.fisheries.noaa.gov/inport/item/76028),
[Colony reference](https://www.colonymiami.com/).

Public route: `/miami-beach/`. Built for the existing static Cloudflare Pages site.
No Google, Cesium ion, Mapbox, map tiles, runtime model calls, API keys, or external
network requests are required. Three.js and all data are bundled on this origin.
AI assisted the implementation, procedural facade rules, and landmark geometry;
the visitor is not talking to an AI and no paid generation happens on page load.

## Working implementation

- County footprint inventory spatially intersected with the **official municipality**.
  Source inventory coverage is not a claim that every present-day building exists.
- Local equirectangular metres around `[-80.135,25.815]`, with geographic coordinates
  retained through the projection helpers. Land is the complement of the county's
  water mask; the municipal boundary is not mistaken for a coastline.
- One simplified overview massing mesh per tile, retaining every footprint.
  Near the camera, 650 m tiles replace it with full geometry, procedural windows,
  and instanced mapped palms/trees. Two concurrent downloads; 12 resident detail
  tiles on narrow screens, 20 on desktop. Far tiles are evicted and resources freed.
- Orbit/pan/zoom, keyboard fly mode (focus canvas, WASD, R/F, Shift, Esc), district
  jumps, landmark jumps, guided tour, daylight/dusk, layer toggles and building picks.
- Three generated GLB assets: an interpretive Colony Hotel, Fontainebleau curved wing,
  and representative lifeguard tower. Sources are in `data/landmarks.json`.
  They are visibly described as approximate artwork, not verified reconstructions.
- CSP remains same-origin. No workers, inline code, CDN imports or texture data URLs.
  WebGL/context-loss and data-load failure messages retain the data source panel.

## Rebuild

From `play-src/`, with Node 24:

```
npm ci
npm run miami-beach:data
npm run build:miami-beach
npm run test:miami-beach
```

The fetcher reuses `play-src/data/miami-beach/raw/` when present; these large source
snapshots are ignored. `node scripts/miami-beach/fetch-data.mjs --refresh` explicitly
refreshes them. Queries are maintenance-only, have timeouts and retry backoff,
download stable object-ID batches, and reject incomplete responses. Published
geometry and `data/manifest.json` are checked in. The manifest records retrieval
timestamps, source URLs, record counts and SHA-256 checksums of original snapshots.
Refresh and rebuild together; do not mix unrelated data vintages in a deployment.

The root is served as-is: commit the generated `viewer.js`, GLBs and JSON, like the
other games. Source stays in the already-blocked `play-src/` folder; this README is
blocked by the existing documentation rule. No hosting configuration change needed.

## Accuracy and remaining phases

**Phase 1 — implemented:** municipal inventory, streets, water/land mask, green-space
polygons, mapped trees, navigation, picking and bounded streaming. Source vintages
vary, including 2015/2018/2021 footprint material; retrieval date is not survey date.
Ground is flat. Bridge decks use schematic heights. Trees have source locations and
species groups, but generic forms and estimated dimensions.

**Phase 2 — first pass implemented:** deterministic AI-authored district palettes,
procedural windows and three reusable GLB assets. Styles are geographic artistic
rules, not historical classifications. There is no facade imagery or texture theft.
County `HEIGHT` has undocumented units in the service. Preserve it for inspection,
but render city `FLOORS × 3.2 m` where a point-on-footprint spatial match exists,
otherwise 6.4 m. The viewer exposes this distinction and source years.

**Phase 3 — next accuracy milestone:** confirm height units/meaning with county
metadata, verify high-rise outliers and floor counts, reconcile city/county
footprints and recent construction. Add LiDAR terrain with a documented vertical
datum. Acceptance: measured-vs-estimated coverage report, landmark height checks,
no unlabelled assumptions. This is not a flood-risk or engineering application.

**Phase 4 — next visual milestone:** verified, licensed landmark references and
surveyed placements; replace overlapping source masses instead of approximate
overlays. Add roof forms, balconies, pools, surveyed bridges and street furniture.
GLB generation is scripted, so revised assets can be regenerated, material-batched,
and eventually meshopt/KTX2 compressed. Acceptance: reviewed landmarks and a clear
separation between documented geometry and artistic inference.

**Phase 5 — production hardening:** physical-device/mobile GPU checks, long fly
sessions for GPU memory plateau, initial transfer and frame-time budgets,
collision handling, spatial search and optional curated tours. Current
desktop browser check is not a cross-device benchmark. The initial overview still
downloads a complete compact footprint inventory; use hierarchy/quantized binary
tiles if the footprint or geographic scope grows materially.

## Source terms

Geometry is provided as-is by the City of Miami Beach and Miami-Dade County. The
county data is approximate and unsuitable for surveying, engineering, site-specific
decisions or financial commitments. Links to source services are always visible in
About. No OSM or Google data is used by this implementation. Three.js is MIT-licensed;
the bundle retains its license comment. The project introduces no license claim over
the government's source GIS data.
