# Aspen explorer

Static HTML/CSS/ES modules on the existing Cloudflare Pages project. No build
step, paid hosting, or new service is needed. `viewer.js` and Cesium are loaded
only after mountain selection. The public token comes from a Pages Function.

## Activate 3D (no Terminal)

1. Create a free Community account at https://ion.cesium.com/.
2. In Asset Depot, add **Google Photorealistic 3D Tiles** to My Assets.
3. In Access Tokens, create a browser token named **Aspen explorer**. Grant
   `assets:read`, restrict asset access to Google Photorealistic 3D Tiles
   (asset 2275207), and restrict allowed URLs to `https://conradgelber.com/`.
   Add a preview origin only if you want to test that preview. No write scopes.
4. Open Cloudflare → Workers & Pages → **conradgelber-com** → Settings →
   Variables and Secrets. Select Production, add **CESIUM_ION_TOKEN**, and
   paste the token as its value. Save.
5. Open Deployments, select the latest production deployment, and choose
   Retry deployment. Wait for Success, then open https://conradgelber.com/aspen/.
6. Choose a mountain. Check the fly-in, labels and run click details, drag to
   pause, then wait six seconds for orbit to resume. Repeat on your phone.

The token is necessarily visible to browsers; saving it as an environment
variable keeps it out of Git, not out of network traffic. Use a restricted
read-only token. Cesium Community is for personal/noncommercial use and currently
includes 1,000 Google root-tile requests/month. Monitor usage in ion; this is not
unlimited free imagery. No Google Cloud billing account is needed for ion access.

## Architecture

- `mountains.js`: resort statistics, mid-mountain camera targets, difficulty signs.
- `aspen.js`: valley, selection, and future panel registry.
- `viewer.js`: lazily loaded renderer, 180-second orbit, six-second idle pause,
  reduced-motion default, 30 fps cap, mobile resolution/cache limits, cleanup.
- `data/*.geojson`: checked-in OSM snapshots; no runtime Overpass calls.
- `../scripts/fetch-aspen.py`: explicit maintenance-only data refresh.
- `../functions/aspen/config.js`: runtime env configuration (no-store).
- `../functions/aspen/_middleware.js`: explorer-scoped CSP; rest of site unchanged.

Runs clamp to Google 3D Tiles, including sign labels. Easy trails use dashes and
circles, intermediate squares, advanced diamonds, expert double diamonds; unknown
ratings remain unknown. Lifts use amber dashes. OSM labels are rendered as text,
never HTML. The keyboard-accessible trail select offers the same details as clicks.

Resort stats describe the resort's reported runs, not the count of OSM segments.
The 2025–26 official stats sheet is linked in the page. The valley positions are
geographic; contours and river are schematic. Google imagery coverage and detail
vary, and not every run can be visible simultaneously behind ridges. Orbit exposes
all sides over time. Real tile streaming, draping and device performance require
verification with the owner's token; no token has been supplied yet.

Snow report and Webcams are separate panel slots. Add panel-specific data loaders
and mount/unmount hooks without coupling future polling to the rendering loop.

## Data license

OSM-derived GeoJSON is © OpenStreetMap contributors, licensed under ODbL 1.0:
https://www.openstreetmap.org/copyright and https://opendatacommons.org/licenses/odbl/1-0/.
Each file records its query, bounding box and retrieval time. The initial snapshots
use the direct OSM map API fallback because the public Overpass endpoints rejected
requests or timed out. The refresh script defaults to Overpass and supports the
explicit --direct fallback. Snowmass requests are split to respect map API limits.
A latitude divide removes neighboring Buttermilk trails from Highlands and vice versa. Google and Cesium
attribution stays visible in the native viewer credits; do not obscure or remove it.
