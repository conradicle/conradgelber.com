// One persistent 3D scene for the whole page: the real Roaring Fork Valley on the
// landing screen, then a fly-in and orbit for each mountain. Keeping a single
// viewer means one Google root-tile request per visit (Cesium Community quota).
import {getDifficulty} from './mountains.js?v=6';

const CESIUM_ROOT = 'https://cesium.com/downloads/cesiumjs/releases/1.133/Build/Cesium/';
// SHA-384 of the two files above, so a changed copy on the CDN is refused rather
// than run. Recompute both when CESIUM_ROOT moves to another release:
// curl -s <url> | openssl dgst -sha384 -binary | base64
const CESIUM_JS_SRI = 'sha384-T5EuhVQI1CIAbJfi4MgfK9AvHsM80n3qM7TADseY8WtjMVUfjh/wMSjC66NfosZh';
const CESIUM_CSS_SRI = 'sha384-ghEeMdcWWzRv/BPeUcX835vcKDGrxvROXisl/Btpv3GeekBUXTSPVcFJpI1Tcrgp';
const FEET = 0.3048;
// Target sits east of the ski areas' middle so they frame to the right of the headline.
const VALLEY = {lon: -106.858, lat: 39.168, height: 2500, range: 23000, pitch: -0.44};
const SWAY_PERIOD = 60; // seconds for one sway left and back on the landing view
const ORBIT_PERIOD = 180; // seconds for a full turn around a mountain
const IDLE_MS = 6000;

let library;
function loadCesium() {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  if (!library) {
    library = new Promise((resolve, reject) => {
      window.CESIUM_BASE_URL = CESIUM_ROOT;
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.integrity = CESIUM_CSS_SRI;
      css.crossOrigin = 'anonymous';
      css.href = CESIUM_ROOT + 'Widgets/widgets.css';
      document.head.append(css);
      const s = document.createElement('script');
      s.integrity = CESIUM_JS_SRI;
      s.crossOrigin = 'anonymous';
      s.src = CESIUM_ROOT + 'Cesium.js';
      s.onload = () => resolve(window.Cesium);
      s.onerror = () => {
        s.remove();
        library = null;
        reject(new Error('The 3D engine could not load. Check your connection and try again.'));
      };
      document.head.append(s);
    });
  }
  return library;
}

export async function createScene(container, mountains, {onHover, onEnter, onRun, onStatus}) {
  const response = await fetch('/aspen/config');
  if (!response.ok) throw new Error('The 3D view is missing its Cesium access token.');
  const {token} = await response.json();
  if (!token) throw new Error('The 3D view is missing its Cesium access token.');
  const C = await loadCesium();
  C.Ion.defaultAccessToken = token;

  const footprints = await (await fetch('/aspen/data/footprints.json?v=6')).json();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const phone = matchMedia('(max-width:700px)').matches;

  const viewer = new C.Viewer(container, {
    globe: false, baseLayer: false, geocoder: false, animation: false, timeline: false,
    baseLayerPicker: false, sceneModePicker: false, navigationHelpButton: false,
    homeButton: false, fullscreenButton: false, selectionIndicator: false, infoBox: false,
    requestRenderMode: true, maximumRenderTimeChange: Infinity, msaaSamples: 1,
  });
  viewer.resolutionScale = Math.min(1, 1.5 / (window.devicePixelRatio || 1));
  viewer.targetFrameRate = 30;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 150;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 60000;
  const render = () => viewer.scene.requestRender();

  // State shared by the landing view and the mountain view.
  let mode = 'valley';
  let hovered = null;
  let focused = null;
  let paused = reduced;
  let holding = false;
  let flying = false;
  let idleUntil = 0;
  let recenter = false;
  let heading = Math.PI;
  let clock = 0;
  let lastPointer = 'mouse';
  let frame;
  let dead = false;

  // Ski-area footprints draped on the real terrain: a tint plus an outline.
  const byEntity = new Map();
  const tint = id => {
    const lit = id === hovered || id === focused;
    if (mode === 'mountain') return lit ? C.Color.fromCssColorString('#f6f2e6').withAlpha(0.10) : C.Color.TRANSPARENT;
    if (lit) return C.Color.fromCssColorString('#f6f2e6').withAlpha(0.26);
    return hovered ? C.Color.fromCssColorString('#13233c').withAlpha(0.18) : C.Color.fromCssColorString('#f6f2e6').withAlpha(0.08);
  };
  const outlines = {};
  const labels = {};
  for (const m of mountains) {
    const ring = footprints[m.id].ring;
    const [cx, cy] = footprints[m.id].center;
    const fill = viewer.entities.add({
      id: `fp:${m.id}`,
      polygon: {
        hierarchy: C.Cartesian3.fromDegreesArray(ring.flat()),
        material: new C.ColorMaterialProperty(new C.CallbackProperty(() => tint(m.id), false)),
        classificationType: C.ClassificationType.CESIUM_3D_TILE,
      },
    });
    byEntity.set(fill.id, m);
    const closed = [...ring, ring[0]].flat();
    const line = (width, color) => viewer.entities.add({
      polyline: {
        positions: C.Cartesian3.fromDegreesArray(closed), width, clampToGround: true,
        classificationType: C.ClassificationType.CESIUM_3D_TILE,
        material: new C.ColorMaterialProperty(C.Color.fromCssColorString(color)),
      },
    });
    outlines[m.id] = {calm: line(2, '#f6f2e6cc'), lit: line(5, '#f6f2e6')};
    outlines[m.id].lit.show = false;
    const label = viewer.entities.add({
      id: `label:${m.id}`,
      position: C.Cartesian3.fromDegrees(cx, cy, m.summit * FEET + 420),
      label: {
        text: m.name.toUpperCase(), font: '600 15px "IBM Plex Sans", sans-serif',
        fillColor: C.Color.fromCssColorString('#13233c'), showBackground: true,
        backgroundColor: C.Color.fromCssColorString('#eef0f3').withAlpha(0.92),
        backgroundPadding: new C.Cartesian2(10, 6),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        verticalOrigin: C.VerticalOrigin.BOTTOM,
      },
    });
    byEntity.set(label.id, m);
    labels[m.id] = label;
  }

  function paint() {
    for (const m of mountains) {
      const lit = m.id === hovered || m.id === focused;
      const visible = mode === 'valley' || m.id === focused;
      outlines[m.id].lit.show = visible && lit;
      outlines[m.id].calm.show = visible && !lit;
      labels[m.id].show = mode === 'valley';
      labels[m.id].label.backgroundColor = (lit ? C.Color.fromCssColorString('#14675e') : C.Color.fromCssColorString('#eef0f3')).withAlpha(0.94);
      labels[m.id].label.fillColor = lit ? C.Color.WHITE : C.Color.fromCssColorString('#13233c');
    }
    render();
  }

  // Runs and lifts for each mountain, loaded the first time it is opened.
  const runSources = {};
  async function loadRuns(m) {
    if (runSources[m.id]) return runSources[m.id];
    const res = await fetch(`/aspen/data/${m.id}.geojson?v=6`);
    if (!res.ok) throw new Error('Trail data could not load. Please try again.');
    const data = await res.json();
    const source = new C.CustomDataSource(m.id);
    const entries = [];
    source.entities.suspendEvents();
    for (const f of data.features) {
      const p = f.properties;
      const coords = f.geometry.coordinates;
      const d = getDifficulty(p['piste:difficulty']);
      const lift = !!p.aerialway;
      const color = C.Color.fromCssColorString(lift ? '#f4bd53' : d.color);
      const mid = coords[Math.floor(coords.length / 2)];
      const entity = source.entities.add({
        id: `run:${m.id}:${f.id}`,
        polyline: {
          positions: C.Cartesian3.fromDegreesArray(coords.flat()), width: lift ? 3 : 5,
          clampToGround: true, classificationType: C.ClassificationType.CESIUM_3D_TILE,
          material: lift || d.dash
            ? new C.PolylineDashMaterialProperty({color, gapColor: C.Color.WHITE.withAlpha(0.5), dashLength: lift ? 16 : 10})
            : new C.PolylineOutlineMaterialProperty({color, outlineColor: C.Color.WHITE, outlineWidth: 1}),
        },
        position: C.Cartesian3.fromDegrees(...mid),
        label: {
          text: lift ? '↟' : d.symbol, font: 'bold 16px sans-serif', fillColor: color,
          outlineColor: C.Color.WHITE, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE,
          heightReference: C.HeightReference.CLAMP_TO_3D_TILE, showBackground: true,
          backgroundColor: C.Color.WHITE.withAlpha(0.8),
          distanceDisplayCondition: new C.DistanceDisplayCondition(0, 2600),
          pixelOffset: new C.Cartesian2(0, -9), scale: 0.85,
        },
      });
      entity.trail = p;
      entries.push(entity);
    }
    source.entities.resumeEvents();
    source.show = false;
    await viewer.dataSources.add(source);
    runSources[m.id] = {source, entries};
    return runSources[m.id];
  }

  // Camera moves.
  const valleyTarget = C.Cartesian3.fromDegrees(VALLEY.lon, VALLEY.lat, VALLEY.height);
  const targetOf = m => C.Cartesian3.fromDegrees(m.lon, m.lat, m.height);
  const flyTo = (target, offset, duration) => {
    flying = true;
    viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
    viewer.camera.flyToBoundingSphere(new C.BoundingSphere(target, 100), {
      duration: reduced ? 0 : duration, offset,
      complete: () => { flying = false; },
      cancel: () => { flying = false; },
    });
  };
  const swayHeading = () => Math.PI + 0.38 * Math.sin((clock / SWAY_PERIOD) * Math.PI * 2);

  function loop(now) {
    if (dead) return;
    const dt = Math.min((now - (loop.last || now)) / 1000, 0.1);
    loop.last = now;
    const free = !document.hidden && !paused && !holding && !flying && now > idleUntil;
    if (free) {
      if (mode === 'valley') {
        if (recenter) {
          recenter = false;
          flyTo(valleyTarget, new C.HeadingPitchRange(swayHeading(), VALLEY.pitch, VALLEY.range), 1.6);
        } else {
          clock += dt;
          viewer.camera.lookAt(valleyTarget, new C.HeadingPitchRange(swayHeading(), VALLEY.pitch, VALLEY.range));
          viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
          render();
        }
      } else if (focused) {
        const m = mountains.find(x => x.id === focused);
        if (recenter) {
          recenter = false;
          flyTo(targetOf(m), new C.HeadingPitchRange(heading, -0.48, m.range), 1.5);
        } else {
          heading += (dt * Math.PI * 2) / ORBIT_PERIOD;
          viewer.camera.lookAt(targetOf(m), new C.HeadingPitchRange(heading, -0.48, m.range));
          viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
          render();
        }
      }
    }
    frame = requestAnimationFrame(loop);
  }

  // Input: hover and tap on the real terrain.
  const interact = () => {
    recenter = true;
    idleUntil = performance.now() + IDLE_MS;
    if (flying) { viewer.camera.cancelFlight(); flying = false; }
  };
  const canvas = viewer.canvas;
  const listeners = [
    [canvas, 'pointerdown', e => { lastPointer = e.pointerType; holding = true; interact(); }],
    [window, 'pointerup', () => { holding = false; idleUntil = performance.now() + IDLE_MS; }],
    [window, 'pointercancel', () => { holding = false; }],
    [canvas, 'wheel', interact],
    [canvas, 'pointerleave', () => { if (mode === 'valley' && hovered) { hovered = null; paint(); onHover(null); } }],
  ];
  for (const [el, type, fn] of listeners) el.addEventListener(type, fn, {passive: true});

  const handler = new C.ScreenSpaceEventHandler(canvas);
  let pendingMove = null;
  handler.setInputAction(e => {
    if (mode !== 'valley' || flying || pendingMove) return;
    pendingMove = requestAnimationFrame(() => {
      pendingMove = null;
      const m = byEntity.get(viewer.scene.pick(e.endPosition)?.id?.id);
      const id = m?.id || null;
      if (flying || mode !== 'valley') return;
      if (id !== hovered) { hovered = id; paint(); onHover(m || null); }
      canvas.style.cursor = id ? 'pointer' : '';
    });
  }, C.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction(e => {
    const picked = viewer.scene.pick(e.position)?.id;
    if (mode === 'valley') {
      if (flying) return;
      const m = byEntity.get(picked?.id);
      if (!m) return;
      // On touch, the first tap previews a mountain and the second enters it.
      if (lastPointer === 'touch' && hovered !== m.id) { hovered = m.id; paint(); onHover(m); return; }
      onEnter(m);
    } else if (picked?.trail) {
      interact();
      onRun(picked);
    }
  }, C.ScreenSpaceEventType.LEFT_CLICK);

  // The real terrain: Google Photorealistic 3D Tiles.
  const tileset = await C.createGooglePhotorealistic3DTileset(
    {onlyUsingWithGoogleGeocoder: true},
    {maximumScreenSpaceError: phone ? 24 : 16, cacheBytes: 128 * 1024 * 1024,
      maximumCacheOverflowBytes: 32 * 1024 * 1024, enableCollision: true},
  );
  viewer.scene.primitives.add(tileset);
  tileset.loadProgress.addEventListener((pending, processing) => onStatus(pending + processing > 0 ? 'Loading terrain…' : ''));
  tileset.tileFailed.addEventListener(() => onStatus('Some terrain could not load. Check your connection.'));

  viewer.camera.lookAt(valleyTarget, new C.HeadingPitchRange(swayHeading(), VALLEY.pitch, VALLEY.range));
  viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
  paint();
  frame = requestAnimationFrame(loop);

  return {
    hover(id) {
      if (mode !== 'valley' || id === hovered) return;
      hovered = id;
      paint();
    },
    overview() {
      mode = 'valley';
      if (focused && runSources[focused]) runSources[focused].source.show = false;
      focused = null;
      hovered = null;
      recenter = false;
      paused = reduced;
      paint();
      flyTo(valleyTarget, new C.HeadingPitchRange(swayHeading(), VALLEY.pitch, VALLEY.range), 2.5);
    },
    async focus(m) {
      mode = 'mountain';
      hovered = null;
      focused = m.id;
      heading = 0;
      recenter = false;
      paint();
      flyTo(targetOf(m), new C.HeadingPitchRange(heading, -0.48, m.range), 3);
      const runs = await loadRuns(m);
      if (focused !== m.id) return null;
      for (const id in runSources) runSources[id].source.show = id === m.id;
      render();
      return runs.entries;
    },
    showRun(entity) {
      interact();
      viewer.flyTo(entity, {duration: reduced ? 0 : 1.2, offset: new C.HeadingPitchRange(heading, -0.5, 1400)});
      onRun(entity);
    },
    reset() {
      if (!focused) return;
      heading = 0;
      flyTo(targetOf(mountains.find(x => x.id === focused)), new C.HeadingPitchRange(0, -0.48, mountains.find(x => x.id === focused).range), 2);
    },
    togglePause() {
      paused = !paused;
      idleUntil = 0;
      return paused;
    },
    get paused() { return paused; },
    destroy() {
      dead = true;
      cancelAnimationFrame(frame);
      for (const [el, type, fn] of listeners) el.removeEventListener(type, fn);
      if (!handler.isDestroyed()) handler.destroy();
      if (!viewer.isDestroyed()) viewer.destroy();
    },
  };
}
