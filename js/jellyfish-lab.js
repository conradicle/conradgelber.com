/* Jellyfish lab: one animal from the shared swimming model, drawn as translucent
   tissue in WebGL2. The model is untouched; only the renderer is new. */
import { JellyfishSchool } from './jellyfish-model.js?v=3';

const canvas = document.querySelector('#lab-canvas');
if (canvas) start(canvas);

function start(canvas) {
  const stage = canvas.parentElement;
  const fallback = document.querySelector('#lab-fallback');
  const stats = document.querySelector('#lab-stats');
  const buttons = {
    motion: document.querySelector('#lab-motion'),
    code: document.querySelector('#lab-code'),
    glow: document.querySelector('#lab-glow'),
    closer: document.querySelector('#lab-closer'),
    farther: document.querySelector('#lab-farther'),
  };
  let gl;
  try { gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false }); } catch (_) { /* handled below */ }
  if (!gl) { stage.classList.add('is-unsupported'); if (fallback) fallback.hidden = false; return; }

  const TAU = Math.PI * 2;
  const FINE = 16, ORAL = 4;          // strands in the shared model
  const TS = 56;                      // samples along a fine tentacle
  const AS = 64, AL = 9;              // samples along and across an oral arm
  const SNOW = 700;
  const BLOOM_LEVELS = 5;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  const school = new JellyfishSchool({ count: 1, specimen: true, aspect: 1.6 });
  const animal = school.animals[0];
  // Let the tentacles settle out of their straight reset pose before the first frame.
  for (let k = 0; k < 270; k++) school.step(1 / 90);

  const state = {
    playing: !reduced.matches, code: 0, codeTarget: 0, bloom: 1, bloomTarget: 1,
    zoom: 1.45, zoomTarget: 1.45, focus: [animal.x, animal.y],
    pointer: [0, 0], pointerPx: [-9999, -9999], hover: 0, lastMove: -1e9,
    pulse: -100, dpr: 1, width: 1, height: 1, last: 0, raf: 0, alive: false,
    cpu: 0, interval: 0, frames: 0,
  };

  /* ---------- shaders ---------- */
  const CAMERA = `
    uniform float uAspect, uZoom;
    uniform vec2 uFocus, uParallax;
    vec4 project(vec3 w) {
      float s = 3.2 / (3.2 - w.z);
      vec2 p = (w.xy - uFocus) * uZoom * s + uParallax * w.z;
      return vec4(p.x / uAspect, p.y, 0.0, 1.0);
    }`;

  // The same closed-form bell as bellPoint() and transform() in jellyfish-model.js,
  // so tentacle roots computed in JavaScript sit exactly on the drawn margin.
  const BELL_VS = `#version 300 es
    precision highp float;
    layout(location=0) in vec3 aUV; // angle, meridian 0..1, layer
    uniform float uC, uTime, uSeed, uScale;
    uniform vec2 uOrigin, uHead;
    uniform vec4 uRot; // sin yaw, cos yaw, sin pitch, cos pitch
    ${CAMERA}
    out vec3 vN;
    out vec2 vUV;
    out float vLayer;
    vec3 bell(float a, float v) {
      float theta = v * 1.5707963;
      float asym = sin(a * 3.0 + uTime * 0.63 + uSeed);
      float rib = 1.0 + 0.018 * cos(a * 12.0 + 0.2 * sin(uTime * 0.4));
      float r = sin(theta) * (1.04 - 0.37 * uC * pow(v, 2.7)) * rib * (1.0 + 0.025 * asym * v * v);
      float y = 0.10 + (0.65 + 0.19 * uC) * cos(theta) + 0.17 * uC * pow(v, 6.0)
        + 0.026 * sin(a * 12.0 + uTime * 0.7) * pow(v, 8.0) + 0.025 * asym * v * (1.0 - v);
      return vec3(cos(a) * r, y, sin(a) * r);
    }
    vec3 shell(float a, float v, float layer) {
      if (layer > 1.5) {
        // Manubrium: a short tube from the underside of the bell to the oral arm roots.
        float r = 0.07 + 0.18 * v * v;
        float top = 0.585 + 0.22 * uC;
        return vec3(cos(a) * r, mix(top, 0.13, v), sin(a) * r);
      }
      vec3 p = bell(a, v);
      // The underside sits inside the outer surface; the jelly between them is
      // thickest at the crown and thins to nothing at the margin.
      float k = layer * (1.0 - v * v);
      p.xz *= 1.0 - 0.20 * k;
      p.y -= 0.15 * k * (1.0 - 0.35 * uC);
      return p;
    }
    vec3 world(vec3 p) {
      float x = uRot.y * p.x + uRot.x * p.z, z = -uRot.x * p.x + uRot.y * p.z;
      float y = uRot.w * (p.y + 0.22) - uRot.z * z, zz = uRot.z * (p.y + 0.22) + uRot.w * z;
      return vec3(uOrigin + vec2(uHead.y * x - uHead.x * y, uHead.x * x + uHead.y * y) * uScale, zz * uScale);
    }
    void main() {
      float a = aUV.x, v = aUV.y, layer = aUV.z;
      vec3 w = world(shell(a, v, layer));
      float vv = clamp(v, 0.04, 0.99), e = 0.012;
      vec3 da = world(shell(a + e, vv, layer)) - world(shell(a - e, vv, layer));
      vec3 dv = world(shell(a, vv + e, layer)) - world(shell(a, vv - e, layer));
      vN = normalize(cross(da, dv));
      vUV = aUV.xy; vLayer = layer;
      gl_Position = project(w);
    }`;

  const BELL_FS = `#version 300 es
    precision highp float;
    in vec3 vN;
    in vec2 vUV;
    in float vLayer;
    uniform float uC, uTime, uPulseAge, uCode, uLens, uTextLength;
    uniform vec2 uPointerPx;
    uniform float uLensRadius;
    uniform sampler2D uAtlas, uText;
    out vec4 o;
    const float TAU = 6.2831853;
    void main() {
      float a = vUV.x, v = vUV.y;
      float facing = normalize(vN).z;
      float fres = pow(1.0 - abs(facing), 3.0);
      float front = smoothstep(-0.25, 0.25, facing);
      vec3 tissue = vec3(0.40, 0.66, 0.95);
      float wave = exp(-pow((v - uPulseAge * 1.5) * 6.0, 2.0)) * exp(-uPulseAge * 1.2);
      vec3 glow = vec3(0.22, 1.0, 0.78);
      vec3 col;
      if (vLayer < 0.5) {
        // Outer surface: almost clear face-on, bright where the view grazes it.
        float i = (0.014 + 0.42 * fres) * mix(0.45, 1.0, front) * (1.0 + 0.3 * uC);
        i *= 1.0 + 0.22 * pow(0.5 + 0.5 * cos(a * 12.0), 5.0) * smoothstep(0.35, 1.0, v);
        col = tissue * i;
        col += tissue * 0.22 * smoothstep(0.03, 0.0, abs(v - 0.985)) * mix(0.45, 1.0, front);
        col += glow * wave * 0.05;

        // Source text set on the surface. It resolves near the pointer, or everywhere
        // when the Code control is on.
        float lens = uLens * smoothstep(uLensRadius, uLensRadius * 0.35, distance(gl_FragCoord.xy, uPointerPx));
        float reveal = max(uCode, lens);
        if (reveal > 0.003) {
          const float ROWS = 24.0, AROUND = 96.0;
          float row = floor(v * ROWS);
          float cols = max(6.0, floor(AROUND * sin((row + 0.5) / ROWS * 1.5707963)));
          float u = fract(-a / TAU) * cols;
          vec2 cell = vec2(fract(u), fract(v * ROWS));
          float index = mod(row * AROUND + floor(u), uTextLength);
          float ch = clamp(floor(texelFetch(uText, ivec2(int(mod(index, 64.0)), int(index / 64.0)), 0).r * 255.0 + 0.5) - 32.0, 0.0, 94.0);
          vec2 grid = vec2(16.0, 6.0);
          vec2 uv = (vec2(mod(ch, 16.0), floor(ch / 16.0)) + vec2(0.06 + 0.88 * cell.x, cell.y)) / grid;
          vec2 smoothCoord = vec2(-a / TAU * cols, v * ROWS);
          float ink = textureGrad(uAtlas, uv, dFdx(smoothCoord) / grid, dFdy(smoothCoord) / grid).r;
          ink *= smoothstep(0.0, 0.08, cell.y) * smoothstep(1.0, 0.92, cell.y) * smoothstep(0.02, 0.2, v);
          float run = 0.6 + 0.4 * sin(u * 0.4 - uTime * 1.3 + row * 1.7);
          col = col * (1.0 - 0.45 * reveal) + vec3(0.72, 0.93, 1.0) * ink * reveal * run * mix(0.10, 0.85, front);
        }
      } else if (vLayer < 1.5) {
        // Underside: swimming muscle, radial canals, the ring canal and four gonads.
        float i = (0.010 + 0.20 * fres) * (1.0 + 0.3 * uC);
        i *= 1.0 + 0.16 * sin(v * 70.0) * smoothstep(0.4, 0.9, v);
        col = tissue * vec3(0.85, 0.95, 1.0) * i;
        float canal = smoothstep(0.085, 0.0, abs(sin(a * 8.0))) * smoothstep(0.22, 0.45, v);
        float ring = smoothstep(0.022, 0.0, abs(v - 0.972));
        col += vec3(0.45, 0.78, 1.0) * (canal * 0.085 + ring * 0.12);
        float af = mod(a + 0.7853982, 1.5707963) - 0.7853982;
        vec2 q = v * vec2(cos(af), sin(af)) - vec2(0.40, 0.0);
        float rr = length(q);
        float gonad = smoothstep(0.036, 0.0, abs(rr - 0.135)) * smoothstep(0.80, 0.30, q.x / max(rr, 1e-4));
        col += vec3(0.80, 0.56, 0.98) * gonad * (0.30 + 0.18 * uC);
        col += glow * wave * (0.03 + canal * 1.1 + ring * 1.3 + gonad * 0.5);
      } else {
        float i = 0.015 + 0.30 * fres;
        col = tissue * vec3(0.9, 0.85, 1.0) * i * smoothstep(0.0, 0.08, v);
        col += glow * exp(-uPulseAge * 1.6) * 0.04;
      }
      o = vec4(col, 1.0);
    }`;

  const STRAND_VS = `#version 300 es
    precision highp float;
    layout(location=0) in vec3 aPos;
    layout(location=1) in vec3 aTan;
    layout(location=2) in vec4 aInfo; // side, distance along, seed, half width in world units
    uniform float uPx, uDpr;
    ${CAMERA}
    out float vSide, vD, vSeed, vGain;
    void main() {
      vec4 c = project(aPos), c2 = project(aPos + aTan * 0.02);
      vec2 dir = (c2.xy - c.xy) * vec2(uAspect, 1.0);
      dir = dir / max(length(dir), 1e-6);
      float want = aInfo.w * uZoom * uPx, wide = max(want, 0.85 * uDpr);
      c.xy += vec2(-dir.y, dir.x) * aInfo.x * wide / uPx / vec2(uAspect, 1.0);
      vSide = aInfo.x; vD = aInfo.y; vSeed = aInfo.z;
      vGain = want / wide * clamp(1.0 + aPos.z * 1.6, 0.5, 1.3);
      gl_Position = c;
    }`;

  const STRAND_FS = `#version 300 es
    precision highp float;
    in float vSide, vD, vSeed, vGain;
    uniform float uPulseAge;
    out vec4 o;
    void main() {
      float profile = 1.0 - vSide * vSide;
      float bead = pow(0.5 + 0.5 * sin(vD * 230.0 + vSeed + 2.0 * sin(vD * 31.0 + vSeed * 3.0)), 3.0);
      float fade = pow(max(0.0, 1.0 - vD), 0.55) * smoothstep(0.0, 0.02, vD);
      vec3 col = vec3(0.42, 0.68, 0.95) * (0.20 + 0.26 * bead) * fade;
      float front = (uPulseAge - 0.55) * 0.85;
      float wave = exp(-pow((vD - front) * 5.0, 2.0)) * exp(-max(0.0, uPulseAge - 0.55) * 0.9) * step(0.55, uPulseAge);
      col += vec3(0.22, 1.0, 0.78) * wave * (0.25 + 0.9 * bead);
      o = vec4(col * profile * vGain, 1.0);
    }`;

  const ARM_VS = `#version 300 es
    precision highp float;
    layout(location=0) in vec3 aPos;
    layout(location=1) in vec3 aUV; // lane -1..1, distance along, seed
    ${CAMERA}
    out vec3 vW, vUV;
    void main() { vW = aPos; vUV = aUV; gl_Position = project(aPos); }`;

  const ARM_FS = `#version 300 es
    precision highp float;
    in vec3 vW, vUV;
    uniform float uPulseAge, uTime;
    out vec4 o;
    void main() {
      // A thin sheet glows where it turns edge-on to the eye.
      vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
      float fres = pow(1.0 - abs(n.z), 1.6);
      float lane = vUV.x, d = vUV.y;
      float edge = pow(abs(lane), 5.0);
      float vein = 0.5 + 0.5 * sin(d * 38.0 + lane * 3.0 + vUV.z);
      float fade = smoothstep(0.0, 0.05, d) * pow(max(0.0, 1.0 - d), 0.45);
      float i = (0.020 + 0.33 * fres + 0.085 * edge) * (0.88 + 0.12 * vein) * fade;
      vec3 col = vec3(0.50, 0.66, 0.98) * i * clamp(1.0 + vW.z * 1.6, 0.5, 1.3);
      float front = (uPulseAge - 0.4) * 0.9;
      float wave = exp(-pow((d - front) * 4.5, 2.0)) * exp(-max(0.0, uPulseAge - 0.4)) * step(0.4, uPulseAge);
      col += vec3(0.22, 1.0, 0.78) * wave * (0.04 + 0.30 * edge + 0.20 * fres) * fade;
      o = vec4(col, 1.0);
    }`;

  // Marine snow has no state: each flake is a function of its seed and the clock,
  // wrapped into a box that follows the camera.
  const SNOW_VS = `#version 300 es
    precision highp float;
    layout(location=0) in vec4 aSeed;
    uniform float uTime, uPx, uDpr;
    ${CAMERA}
    out float vAlpha;
    void main() {
      vec2 box = vec2(uAspect * 1.7, 1.7);
      vec3 p = vec3((aSeed.xy * 2.0 - 1.0) * box, mix(-1.9, 1.25, aSeed.z));
      p.y -= uTime * (0.006 + 0.016 * aSeed.w);
      p.x += 0.03 * sin(uTime * 0.17 + aSeed.w * 40.0) + uTime * 0.004;
      p.xy = mod(p.xy - uFocus + box, 2.0 * box) - box + uFocus;
      float s = 3.2 / (3.2 - p.z);
      float sharp = (0.9 + 1.7 * aSeed.w) * uDpr * s * sqrt(uZoom);
      float size = sharp + abs(p.z) * uZoom * uPx * 0.013;
      gl_PointSize = size;
      vAlpha = (sharp * sharp) / (size * size) * (0.10 + 0.22 * fract(aSeed.w * 7.3)) * clamp(1.2 + p.z * 0.35, 0.35, 1.4);
      gl_Position = project(p);
    }`;

  const SNOW_FS = `#version 300 es
    precision highp float;
    in float vAlpha;
    out vec4 o;
    void main() {
      float r = length(gl_PointCoord * 2.0 - 1.0);
      o = vec4(vec3(0.62, 0.78, 0.92) * vAlpha * smoothstep(1.0, 0.25, r), 1.0);
    }`;

  const SCREEN_VS = `#version 300 es
    out vec2 vUv;
    void main() {
      vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
      vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`;

  const BLUR_FS = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uSrc;
    uniform vec2 uStep;
    uniform float uGain;
    out vec4 o;
    void main() {
      vec3 c = texture(uSrc, vUv + uStep * vec2(-1.0, -1.0)).rgb + texture(uSrc, vUv + uStep * vec2(1.0, -1.0)).rgb
        + texture(uSrc, vUv + uStep * vec2(-1.0, 1.0)).rgb + texture(uSrc, vUv + uStep * vec2(1.0, 1.0)).rgb;
      o = vec4(c * 0.25 * uGain, 1.0);
    }`;

  const FINAL_FS = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uScene, uBloom;
    uniform float uBloomGain;
    out vec4 o;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      // Water: the page's own near-black at depth, a little light arriving from above.
      vec3 deep = vec3(0.0196, 0.0353, 0.0510), high = vec3(0.030, 0.072, 0.105);
      vec3 water = mix(deep, high, pow(vUv.y, 1.7));
      float shaft = exp(-pow((vUv.x - 0.56 + (1.0 - vUv.y) * 0.10) * 2.3, 2.0));
      water += vec3(0.020, 0.045, 0.060) * pow(vUv.y, 2.6) * shaft;
      vec3 light = texture(uScene, vUv).rgb + texture(uBloom, vUv).rgb * uBloomGain;
      vec3 col = water + (1.0 - exp(-light * 1.55));
      col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
      o = vec4(col, 1.0);
    }`;

  /* ---------- GL plumbing ---------- */
  let res = null;

  function compile(vs, fs) {
    const make = (type, source) => {
      const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw Error(log); }
      return s;
    };
    const a = make(gl.VERTEX_SHADER, vs), b = make(gl.FRAGMENT_SHADER, fs), program = gl.createProgram();
    gl.attachShader(program, a); gl.attachShader(program, b); gl.linkProgram(program);
    gl.deleteShader(a); gl.deleteShader(b);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    const cache = {};
    return { program, u: name => (name in cache ? cache[name] : (cache[name] = gl.getUniformLocation(program, name))) };
  }

  function mesh(layout, data, indices, usage) {
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    const stride = layout.reduce((sum, n) => sum + n, 0) * 4;
    let offset = 0;
    layout.forEach((size, location) => {
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset); offset += size * 4;
    });
    let elements = null;
    if (indices) { elements = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elements); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW); }
    gl.bindVertexArray(null);
    return { vao, buffer, elements, count: indices ? indices.length : data.length / (stride / 4) };
  }

  function gridIndices(rows, cols, strips) {
    // strips blocks of a rows x cols vertex grid, joined into triangles.
    const out = [];
    for (let s = 0; s < strips; s++) for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const i = s * rows * cols + r * cols + c;
      out.push(i, i + 1, i + cols, i + 1, i + cols + 1, i + cols);
    }
    return new Uint16Array(out);
  }

  function target(width, height, format) {
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, width, height };
  }

  function freeTargets() {
    if (!res || !res.scene) return;
    for (const t of [res.scene, ...res.bloom]) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
    if (res.multi) { gl.deleteRenderbuffer(res.multi.rbo); gl.deleteFramebuffer(res.multi.fbo); }
    res.scene = null; res.bloom = []; res.multi = null;
  }

  function makeTargets() {
    freeTargets();
    const w = canvas.width, h = canvas.height, format = res.hdr ? gl.RGBA16F : gl.RGBA8;
    res.scene = target(w, h, format);
    res.bloom = [];
    for (let i = 1; i <= BLOOM_LEVELS; i++) res.bloom.push(target(Math.max(2, w >> i), Math.max(2, h >> i), format));
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
    if (samples > 1) {
      const rbo = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rbo);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, format, w, h);
      const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rbo);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) res.multi = { rbo, fbo };
      else { gl.deleteRenderbuffer(rbo); gl.deleteFramebuffer(fbo); }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function glyphAtlas() {
    // Printable ASCII, 16 columns by 6 rows, with mipmaps so small text stays calm.
    const cellW = 40, cellH = 64, sheet = document.createElement('canvas');
    sheet.width = cellW * 16; sheet.height = cellH * 6;
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, sheet.width, sheet.height);
    ctx.fillStyle = '#fff'; ctx.font = '600 46px ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let c = 32; c < 127; c++) ctx.fillText(String.fromCharCode(c), ((c - 32) % 16) * cellW + cellW / 2, Math.floor((c - 32) / 16) * cellH + cellH / 2 + 2);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sheet);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  let sourceText = 'export class JellyfishSchool { advance(elapsed) { this.accumulator += elapsed; while (this.accumulator >= STEP) this.step(STEP); } } ';
  function textTexture() {
    const bytes = new Uint8Array(4096), clean = sourceText.replace(/\s+/g, ' ');
    for (let i = 0; i < bytes.length; i++) { const c = clean.charCodeAt(i % clean.length); bytes[i] = c >= 32 && c < 127 ? c : 32; }
    const tex = res.text || gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 64, 64, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return tex;
  }

  const strandData = new Float32Array(FINE * TS * 2 * 10);
  const armData = new Float32Array(ORAL * AS * AL * 6);

  function build() {
    res = { scene: null, bloom: [], multi: null, text: null };
    res.hdr = !!gl.getExtension('EXT_color_buffer_float');
    res.bellProgram = compile(BELL_VS, BELL_FS);
    res.strandProgram = compile(STRAND_VS, STRAND_FS);
    res.armProgram = compile(ARM_VS, ARM_FS);
    res.snowProgram = compile(SNOW_VS, SNOW_FS);
    res.blurProgram = compile(SCREEN_VS, BLUR_FS);
    res.finalProgram = compile(SCREEN_VS, FINAL_FS);

    // Bell: three layers (outer surface, underside, manubrium) on one angle-by-meridian grid.
    const AROUND = 128, DOWN = 44, bell = [];
    for (let layer = 0; layer < 3; layer++) for (let r = 0; r <= DOWN; r++) for (let c = 0; c <= AROUND; c++) bell.push(c / AROUND * TAU, r / DOWN, layer);
    res.bell = mesh([3], new Float32Array(bell), gridIndices(DOWN + 1, AROUND + 1, 3), gl.STATIC_DRAW);
    res.strands = mesh([3, 3, 4], strandData, gridIndices(TS, 2, FINE), gl.DYNAMIC_DRAW);
    res.arms = mesh([3, 3], armData, gridIndices(AS, AL, ORAL), gl.DYNAMIC_DRAW);

    let seed = 90211; const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
    res.snow = mesh([4], Float32Array.from({ length: SNOW * 4 }, random), null, gl.STATIC_DRAW);
    res.screen = gl.createVertexArray();
    res.atlas = glyphAtlas();
    res.text = textTexture();
    state.alive = true;
    resize();
  }

  /* ---------- per-frame geometry from the model ---------- */
  const P = new Float64Array(3), T = new Float64Array(3);

  function fillStrands() {
    let k = 0;
    for (let j = 0; j < FINE; j++) {
      const chain = animal.chains[j];
      for (let i = 0; i < TS; i++) {
        const d = i / (TS - 1);
        school.sampleChain(chain, d, P, T);
        const length = Math.hypot(T[0], T[1], T[2]) || 1, width = 0.013 * animal.scale * (1 - 0.72 * d);
        for (let side = -1; side <= 1; side += 2) {
          strandData[k++] = P[0]; strandData[k++] = P[1]; strandData[k++] = P[2];
          strandData[k++] = T[0] / length; strandData[k++] = T[1] / length; strandData[k++] = T[2] / length;
          strandData[k++] = side; strandData[k++] = d; strandData[k++] = chain.seed; strandData[k++] = width;
        }
      }
    }
  }

  function fillArms() {
    let k = 0;
    const time = school.time, scale = animal.scale;
    for (let j = 0; j < ORAL; j++) {
      const chain = animal.chains[FINE + j];
      for (let i = 0; i < AS; i++) {
        const d = i / (AS - 1);
        school.sampleChain(chain, d, P, T);
        const length = Math.hypot(T[0], T[1], T[2]) || 1, tx = T[0] / length, ty = T[1] / length, tz = T[2] / length;
        // A frame around the strand: n lies in the picture plane, b completes it.
        const planar = Math.hypot(tx, ty) || 1, nx = -ty / planar, ny = tx / planar;
        const bx = -tz * ny, by = tz * nx, bz = tx * ny - ty * nx;
        const taper = Math.sin(Math.PI * Math.min(1, d) * 0.97) ** 0.7;
        const width = chain.ribbonWidth * 1.25 * taper * (0.82 + 0.18 * Math.sin(d * 9.2 - time * 0.34 * chain.response + chain.phase));
        const twist = 0.9 * Math.sin(d * 3.8 - time * 0.18 + chain.seed) + 0.45 * Math.sin(d * 7.5 + time * 0.13 + chain.phase);
        const c = Math.cos(twist), s = Math.sin(twist);
        const ax = nx * c + bx * s, ay = ny * c + by * s, az = bz * s;       // across the ribbon
        const ux = -nx * s + bx * c, uy = -ny * s + by * c, uz = bz * c;      // out of the ribbon
        for (let l = 0; l < AL; l++) {
          const lane = l / (AL - 1) * 2 - 1;
          const across = width * lane * scale;
          // Frilled edges: the ruffle grows toward each margin and travels down the arm.
          const ruffle = width * 0.55 * lane * lane * scale * (0.3 + 0.7 * d)
            * Math.sin(d * 30 - time * 0.9 + chain.seed + Math.sign(lane) * 1.4) * (0.6 + 0.4 * Math.sin(d * 11 + chain.phase));
          armData[k++] = P[0] + ax * across + ux * ruffle;
          armData[k++] = P[1] + ay * across + uy * ruffle;
          armData[k++] = P[2] + az * across + uz * ruffle;
          armData[k++] = lane; armData[k++] = d; armData[k++] = chain.seed;
        }
      }
    }
  }

  /* ---------- drawing ---------- */
  function camera(p) {
    gl.uniform1f(p.u('uAspect'), school.aspect); gl.uniform1f(p.u('uZoom'), state.zoom);
    gl.uniform2f(p.u('uFocus'), state.focus[0], state.focus[1]);
    const lean = reduced.matches ? 0 : state.hover * 0.07;
    gl.uniform2f(p.u('uParallax'), -state.pointer[0] * lean, -state.pointer[1] * lean);
  }

  function blur(from, to, gain, spread) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo); gl.viewport(0, 0, to.width, to.height);
    gl.bindTexture(gl.TEXTURE_2D, from.tex);
    gl.uniform2f(res.blurProgram.u('uStep'), spread / from.width, spread / from.height);
    gl.uniform1f(res.blurProgram.u('uGain'), gain);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function draw() {
    if (!state.alive) return;
    const pulseAge = Math.max(0, school.time - state.pulse), px = canvas.height / 2;
    fillStrands(); fillArms();

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.multi ? res.multi.fbo : res.scene.fbo);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.activeTexture(gl.TEXTURE0);

    let p = res.snowProgram; gl.useProgram(p.program); camera(p);
    gl.uniform1f(p.u('uTime'), school.time); gl.uniform1f(p.u('uPx'), px); gl.uniform1f(p.u('uDpr'), state.dpr);
    gl.bindVertexArray(res.snow.vao); gl.drawArrays(gl.POINTS, 0, SNOW);

    p = res.bellProgram; gl.useProgram(p.program); camera(p);
    gl.uniform1f(p.u('uC'), animal.contraction); gl.uniform1f(p.u('uTime'), school.time);
    gl.uniform1f(p.u('uSeed'), animal.seed); gl.uniform1f(p.u('uScale'), animal.scale);
    gl.uniform2f(p.u('uOrigin'), animal.x, animal.y);
    gl.uniform2f(p.u('uHead'), Math.sin(animal.heading), Math.cos(animal.heading));
    gl.uniform4f(p.u('uRot'), Math.sin(animal.yaw), Math.cos(animal.yaw), Math.sin(animal.pitch), Math.cos(animal.pitch));
    gl.uniform1f(p.u('uPulseAge'), pulseAge); gl.uniform1f(p.u('uCode'), state.code); gl.uniform1f(p.u('uLens'), state.hover);
    gl.uniform2f(p.u('uPointerPx'), state.pointerPx[0], state.pointerPx[1]);
    gl.uniform1f(p.u('uLensRadius'), 190 * state.dpr); gl.uniform1f(p.u('uTextLength'), 4096);
    gl.bindTexture(gl.TEXTURE_2D, res.atlas); gl.uniform1i(p.u('uAtlas'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, res.text); gl.uniform1i(p.u('uText'), 1); gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(res.bell.vao); gl.drawElements(gl.TRIANGLES, res.bell.count, gl.UNSIGNED_SHORT, 0);

    p = res.armProgram; gl.useProgram(p.program); camera(p);
    gl.uniform1f(p.u('uPulseAge'), pulseAge); gl.uniform1f(p.u('uTime'), school.time);
    gl.bindVertexArray(res.arms.vao); gl.bindBuffer(gl.ARRAY_BUFFER, res.arms.buffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, armData);
    gl.drawElements(gl.TRIANGLES, res.arms.count, gl.UNSIGNED_SHORT, 0);

    p = res.strandProgram; gl.useProgram(p.program); camera(p);
    gl.uniform1f(p.u('uPx'), px); gl.uniform1f(p.u('uDpr'), state.dpr); gl.uniform1f(p.u('uPulseAge'), pulseAge);
    gl.bindVertexArray(res.strands.vao); gl.bindBuffer(gl.ARRAY_BUFFER, res.strands.buffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, strandData);
    gl.drawElements(gl.TRIANGLES, res.strands.count, gl.UNSIGNED_SHORT, 0);

    if (res.multi) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, res.multi.fbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, res.scene.fbo);
      gl.blitFramebuffer(0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }

    // Glow: shrink the lit scene step by step, then add the steps back together.
    gl.bindVertexArray(res.screen); gl.useProgram(res.blurProgram.program); gl.uniform1i(res.blurProgram.u('uSrc'), 0);
    gl.disable(gl.BLEND);
    let from = res.scene;
    for (const level of res.bloom) { blur(from, level, 1, 1); from = level; }
    gl.enable(gl.BLEND);
    for (let i = res.bloom.length - 1; i > 0; i--) blur(res.bloom[i], res.bloom[i - 1], 0.9, 0.5);
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
    p = res.finalProgram; gl.useProgram(p.program);
    gl.bindTexture(gl.TEXTURE_2D, res.scene.tex); gl.uniform1i(p.u('uScene'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, res.bloom[0].tex); gl.uniform1i(p.u('uBloom'), 1); gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(p.u('uBloomGain'), 0.42 * state.bloom);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    canvas.classList.add('is-live');
  }

  function resize() {
    if (!state.alive) return;
    const rect = canvas.getBoundingClientRect();
    state.dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(rect.width * state.dpr)), h = Math.max(2, Math.round(rect.height * state.dpr));
    state.width = rect.width; state.height = rect.height;
    if (canvas.width !== w || canvas.height !== h || !res.scene) { canvas.width = w; canvas.height = h; makeTargets(); }
    school.resize(Math.max(0.1, rect.width / Math.max(1, rect.height)));
    draw();
  }

  function ease(from, to, rate, dt) { return from + (to - from) * (1 - Math.exp(-dt * rate)); }

  function frame(now) {
    if (!state.alive) return;
    const elapsed = Math.max(0, (now - state.last) / 1000), dt = Math.min(elapsed, 0.0667); state.last = now;
    const began = performance.now();
    state.hover = ease(state.hover, now - state.lastMove < 2500 ? 1 : 0, 3, dt);
    state.zoom = ease(state.zoom, state.zoomTarget, 2.5, dt);
    state.code = ease(state.code, state.codeTarget, 4, dt);
    state.bloom = ease(state.bloom, state.bloomTarget, 5, dt);
    if (state.playing) {
      school.pointer[0] = state.pointer[0] * school.aspect / state.zoom + state.focus[0];
      school.pointer[1] = state.pointer[1] / state.zoom + state.focus[1];
      school.attention = state.hover;
      school.advance(dt);
      // The camera trails the animal, so the snow streaming past shows it is travelling.
      state.focus[0] = ease(state.focus[0], animal.x, 0.9, dt);
      state.focus[1] = ease(state.focus[1], animal.y - 0.12 * animal.scale / 0.29, 0.9, dt);
    }
    draw();
    state.cpu += performance.now() - began; state.interval += elapsed; state.frames++;
    if (state.frames === 45) {
      if (stats) stats.textContent = `${(state.cpu / 45).toFixed(1)} ms of script per frame, ${Math.round(45 / state.interval)} frames per second`;
      state.cpu = state.interval = state.frames = 0;
    }
    state.raf = requestAnimationFrame(frame);
  }

  function refresh() {
    cancelAnimationFrame(state.raf); state.raf = 0;
    if (!state.alive || document.hidden) return;
    state.last = performance.now(); state.raf = requestAnimationFrame(frame);
  }

  /* ---------- input ---------- */
  function locate(e) {
    const r = canvas.getBoundingClientRect();
    state.pointer = [(e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2];
    state.pointerPx = [(e.clientX - r.left) * state.dpr, (r.height - (e.clientY - r.top)) * state.dpr];
    state.lastMove = performance.now();
  }
  function startle(e) {
    if (e.target.closest('a,button')) return;
    locate(e);
    if (!state.playing) return;
    // A touch starts a stroke at once and sends light down the canals.
    animal.phase = Math.floor(animal.phase) + 0.16;
    state.pulse = school.time;
  }
  function press(button, on) { button.setAttribute('aria-pressed', String(on)); }

  const events = new AbortController(), listen = (t, name, fn) => t && t.addEventListener(name, fn, { signal: events.signal });
  listen(stage, 'pointermove', locate);
  listen(stage, 'pointerdown', startle);
  listen(stage, 'pointerleave', () => { state.lastMove = -1e9; });
  listen(buttons.motion, 'click', () => { state.playing = !state.playing; press(buttons.motion, state.playing); });
  listen(buttons.code, 'click', () => { state.codeTarget = state.codeTarget ? 0 : 1; press(buttons.code, !!state.codeTarget); });
  listen(buttons.glow, 'click', () => { state.bloomTarget = state.bloomTarget ? 0 : 1; press(buttons.glow, !!state.bloomTarget); });
  listen(buttons.closer, 'click', () => { state.zoomTarget = Math.min(3, state.zoomTarget * 1.3); });
  listen(buttons.farther, 'click', () => { state.zoomTarget = Math.max(0.8, state.zoomTarget / 1.3); });
  listen(document, 'visibilitychange', refresh);
  listen(canvas, 'webglcontextlost', e => { e.preventDefault(); state.alive = false; cancelAnimationFrame(state.raf); });
  listen(canvas, 'webglcontextrestored', () => { try { build(); refresh(); } catch (_) { fail(); } });
  listen(window, 'pagehide', () => cancelAnimationFrame(state.raf));
  listen(window, 'pageshow', refresh);

  function fail() {
    state.alive = false; cancelAnimationFrame(state.raf);
    stage.classList.add('is-unsupported'); if (fallback) fallback.hidden = false;
  }

  try {
    build();
    if (buttons.motion) press(buttons.motion, state.playing);
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas); else listen(window, 'resize', resize);
    refresh();
    // The text on the bell is this simulation's own source.
    fetch('/js/jellyfish-model.js?v=3').then(r => (r.ok ? r.text() : '')).then(text => {
      if (text && state.alive) { sourceText = text; res.text = textTexture(); }
    }).catch(() => { /* the short built-in excerpt stays */ });
  } catch (_) { fail(); }
}
