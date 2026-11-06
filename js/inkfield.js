/* Inkfield: the homepage hero background. Living ink on paper, a slowly
   moving contour chart with currents running along it. WebGL2, no libraries.

   Three passes each frame:
     1. Particle state (a float texture, ping-ponged): moves every particle
        along a curl-noise flow derived from the same height function the
        contours are drawn from, so the currents follow the chart.
     2. Trails (a half-float texture, ping-ponged): fades the last frame and
        adds the particles as small dots.
     3. The canvas: draws the contour lines and multiplies the trails onto
        the paper.

   If anything is missing (WebGL2, float targets, a shader) the canvas is
   removed and the page keeps its plain paper background. */
(function () {
  "use strict";

  /* ---------------------------------------------------------------- TUNING
     Sizes are CSS pixels and times are seconds unless a comment says otherwise. */

  // Contour lines
  const FIELD_SCALE = 460;          // Size of the biggest landforms. Bigger = broader, calmer shapes.
  const LINE_DENSITY = 11;          // Main contour lines per unit of height. Bigger = more lines.
  const MAJOR_EVERY = 5;            // Every Nth main line is heavy, as on a topo map.
  const FINE_PER_MAIN = 3;          // Divisions between main lines. 3 draws 2 fine lines in each gap.
  const MAJOR_WIDTH = 1.5;          // Line widths
  const MAIN_WIDTH = 0.8;
  const FINE_WIDTH = 0.5;
  const MAJOR_OPACITY = 0.72;       // Ink strength of each kind of line, 0 to 1
  const MAIN_OPACITY = 0.52;
  const FINE_OPACITY = 0.3;
  const NOISE_OCTAVES = 3;          // More = wigglier lines, slower to draw.
  const DOMAIN_WARP = 0.42;         // How much the shapes curl and stretch.

  // Motion
  const EVOLVE_SPEED = 0.028;       // How fast the terrain changes shape.
  const DRIFT_X = 0.006;            // Slow sideways slide of the whole chart, field units per second
  const DRIFT_Y = -0.003;

  // Particles
  const PARTICLE_COUNT = 52000;     // Laptop and desktop screens
  const PARTICLE_COUNT_SMALL = 30000; // Screens narrower than SMALL_SCREEN_WIDTH
  const SMALL_SCREEN_WIDTH = 760;
  const FLOW_SPEED = 0.05;          // How fast particles ride the current.
  const FLOW_SWIRL = 0.22;          // Extra curl-noise on top of the contour-following flow.
  const PARTICLE_LIFE = 11;         // Average life before a particle respawns elsewhere
  const PARTICLE_SIZE = 1.5;        // Dot diameter
  const PARTICLE_INK = 0.05;        // How dark one dot prints. Bigger = more teal overall.
  const PARTICLE_MAX_OPACITY = 0.8; // Ceiling where many dots pile up
  const TRAIL_FADE = 0.2;           // Trail length, as a fade time. Bigger = longer trails.

  // Cursor
  const CURSOR_RADIUS = 125;        // Width of the bump in the terrain
  const CURSOR_STRENGTH = 0.95;     // Height of the bump. Bigger = more rings around the cursor.
  const CURSOR_LINE_BOOST = 0.8;    // Extra line weight and darkness near the cursor
  const CURSOR_TINT = 0.75;         // How far lines near the cursor shift from ink to teal, 0 to 1
  const CURSOR_WASH = 0.035;        // Faint teal wash on the paper near the cursor, 0 to 1
  const PARTICLE_PULL_RADIUS = 260; // How far away particles feel the cursor
  const PARTICLE_ORBIT = 0.2;       // Sideways push, makes particles circle the cursor.
  const PARTICLE_GATHER = 0.06;      // Pull toward the ring they gather on.
  const PARTICLE_RING = 85;         // Radius of that ring
  const CURSOR_GLOW_INK = 0.5;      // Dots print this many times darker close to the cursor.
  const CURSOR_FOLLOW_TIME = 0.09;  // The effect point catches up to the cursor quickly.
  const CURSOR_RISE_TIME = 0.8;     // The effect itself swells in slowly...
  const CURSOR_RELAX_TIME = 1.7;    // ...and relaxes back to ambient more slowly still.
  const CURSOR_IDLE_AFTER = 2.5;    // Idle time before relaxing

  // Finish
  const GRAIN = 0.011;              // Paper grain strength. Keep this tiny.
  const EDGE_FADE_SIDES = 0.13;     // Fade zones as a share of the hero's width or height
  const EDGE_FADE_TOP = 0.08;
  const EDGE_FADE_BOTTOM = 0.11;
  const TEXT_QUIET = 0.1;           // Ink left behind text: 0 = none, 1 = no fade at all
  const TEXT_QUIET_SOFTNESS = 54;   // How softly the quiet zone blends out from the text
  const TEXT_QUIET_PADDING = 8;     // Extra room kept clear around the text
  const QUIET_SELECTORS = ["h1", ".standfirst", ".stamp", ".tabs"];

  // Performance
  const MAX_DPR = 2;                // devicePixelRatio cap
  const RENDER_SCALE = 0.8;         // Starting resolution, as a share of the capped DPR
  const RENDER_SCALE_MIN = 0.6;     // Lowest it will drop to if frames run slow
  const RENDER_SCALE_STEP = 0.9;    // Multiplier for each drop
  const SLOW_FRAME_MS = 21;         // Average frame time that counts as slow
  const SLOW_CHECK_FRAMES = 40;     // Frames to average before deciding
  const MAX_STEP = 1 / 30;          // Longest simulated step, so a stall can't make particles jump
  const WARM_UP_STEPS = 45;         // Simulation steps run before the first visible frame
  const STILL_STEPS = 260;          // Steps behind the single frame for reduced motion
  const FADE_IN_DELAY_FRAMES = 2;   // Frames drawn before the canvas starts to fade in

  /* ------------------------------------------------------------------ SETUP */

  const canvas = document.getElementById("inkfield");
  const hero = canvas && canvas.closest(".hero");
  if (!canvas || !hero) return;

  const f = (n) => {
    const s = String(n);
    return /[.e]/.test(s) ? s : s + ".0";
  };

  // Every color comes from the tokens in style.css. A shade of ink that can't be
  // read means the page isn't styled as expected, so the effect stays off.
  function token(name) {
    const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("inkfield: bad color token " + name);
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  }

  /* ---------------------------------------------------------------- SHADERS */

  const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

  // Draws one triangle that covers the target, with no vertex buffers.
  const FULLSCREEN_VS = HEADER + `
out vec2 vUv;
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  // 3D value noise and the height function, shared by the contours and the
  // particle flow.
  const TERRAIN = `
float hash(ivec3 c){
  uvec3 v = uvec3(c) * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z;
  return float(v.x) / 4294967295.0;
}
float vnoise(vec3 p){
  vec3 fl = floor(p);
  ivec3 i = ivec3(fl);
  vec3 r = p - fl;
  vec3 u = r * r * r * (r * (r * 6.0 - 15.0) + 10.0);
  return mix(
    mix(mix(hash(i), hash(i + ivec3(1,0,0)), u.x),
        mix(hash(i + ivec3(0,1,0)), hash(i + ivec3(1,1,0)), u.x), u.y),
    mix(mix(hash(i + ivec3(0,0,1)), hash(i + ivec3(1,0,1)), u.x),
        mix(hash(i + ivec3(0,1,1)), hash(i + ivec3(1,1,1)), u.x), u.y),
    u.z) * 2.0 - 1.0;
}
const mat2 TURN = mat2(0.8, 0.6, -0.6, 0.8);
// p is in field units, t is evolved time. Each octave runs on its own clock
// so the lattice steps in time never line up into a visible pulse.
float terrain(vec2 p, float t, int octaves){
  p += vec2(${f(DRIFT_X)}, ${f(DRIFT_Y)}) * t / ${f(EVOLVE_SPEED)};
  vec2 warp = vec2(vnoise(vec3(p * 0.7 + 11.3, t * 0.6)),
                   vnoise(vec3(p * 0.7 - 7.9, t * 0.6 + 31.0)));
  p += warp * ${f(DOMAIN_WARP)};
  float h = 0.0, a = 0.62;
  for (int i = 0; i < octaves; i++){
    h += a * vnoise(vec3(p, t * (1.0 + float(i) * 0.37) + float(i) * 17.3));
    p = TURN * p * 2.03 + vec2(3.1, 1.7);
    a *= 0.42;
  }
  return h;
}
`;

  // Pass 1: move the particles. State is (x, y, life, seed), x and y in 0..1
  // of the hero with y running down.
  const SIM_FS = HEADER + `
uniform sampler2D uState;
uniform vec2 uExtent;     // hero size in field units
uniform vec2 uCursor;     // field units
uniform float uCursorAmt;
uniform float uTime;
uniform float uDt;
uniform int uFrame;
out vec4 outState;
${TERRAIN}
float potential(vec2 p){
  return terrain(p, uTime, 2) + ${f(FLOW_SWIRL)} * vnoise(vec3(p * 1.7 + 40.0, uTime * 1.4));
}
void main(){
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, texel, 0);
  vec2 pos = s.xy;
  float seed = s.w;

  // Curl of the potential: at right angles to its slope, so particles run
  // along the contours. These must stay central differences with a small
  // step. Value noise has a sharp third derivative on its lattice lines, and
  // one-sided differences there leak enough divergence to drain particles
  // into visible straight streaks.
  vec2 p = pos * uExtent;
  const float E = 0.005;
  float dx = potential(p + vec2(E, 0.0)) - potential(p - vec2(E, 0.0));
  float dy = potential(p + vec2(0.0, E)) - potential(p - vec2(0.0, E));
  vec2 vel = vec2(dy, -dx) / (2.0 * E) * ${f(FLOW_SPEED)};

  // Orbit and gather around the cursor.
  if (uCursorAmt > 0.001){
    vec2 toCursor = uCursor - p;
    float r = max(length(toCursor), 1e-3);
    vec2 inward = toCursor / r;
    float reach = r / ${f(PARTICLE_PULL_RADIUS / FIELD_SCALE)};
    float fall = uCursorAmt * exp(-reach * reach);
    float ring = ${f(PARTICLE_RING / FIELD_SCALE)};
    vel += fall * ${f(PARTICLE_ORBIT)} * vec2(-inward.y, inward.x);
    vel += fall * ${f(PARTICLE_GATHER)} * inward * clamp((r - ring) / ring, -1.0, 1.0);
  }

  pos += vel * uDt / uExtent;
  float life = s.z - uDt / (${f(PARTICLE_LIFE)} * (0.6 + 0.8 * seed));

  if (life <= 0.0 || pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0){
    pos = vec2(hash(ivec3(texel, uFrame)), hash(ivec3(texel.yx, uFrame + 7919)));
    life = 1.0;
  }
  outState = vec4(pos, life, seed);
}`;

  // Pass 2a: fade the trails.
  const FADE_FS = HEADER + `
uniform sampler2D uTrail;
uniform float uFade;
in vec2 vUv;
out vec4 outColor;
void main(){ outColor = texture(uTrail, vUv) * uFade; }`;

  // Pass 2b: add the particles as dots. No vertex buffers: each point reads
  // its position straight out of the state texture.
  const POINTS_VS = HEADER + `
uniform sampler2D uState;
uniform vec2 uSize;       // hero size in CSS pixels
uniform vec2 uCursorPx;
uniform float uCursorAmt;
uniform float uPointPx;
uniform float uDeposit;
out float vInk;
void main(){
  int side = textureSize(uState, 0).x;
  vec4 s = texelFetch(uState, ivec2(gl_VertexID % side, gl_VertexID / side), 0);
  float seed = s.w;
  float born = smoothstep(0.0, 0.14, 1.0 - s.z);
  float dying = smoothstep(0.0, 0.14, s.z);
  // Most particles print faintly and a few print darker, so currents show
  // as threads rather than an even teal haze.
  float tier = mix(0.2, 3.4, pow(seed, 7.0));
  vec2 d = (s.xy * uSize - uCursorPx) / ${f(PARTICLE_PULL_RADIUS * 0.8)};
  float near = uCursorAmt * exp(-dot(d, d));
  vInk = uDeposit * tier * born * dying * (1.0 + near * ${f(CURSOR_GLOW_INK)});
  gl_PointSize = uPointPx * (0.8 + 0.5 * seed);
  gl_Position = vec4(s.x * 2.0 - 1.0, 1.0 - s.y * 2.0, 0.0, 1.0);
}`;
  const POINTS_FS = HEADER + `
in float vInk;
out vec4 outColor;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;
  outColor = vec4(vInk * (1.0 - smoothstep(0.35, 1.0, r)));
}`;

  // Pass 3: the chart.
  const QUIET_MAX = 8;
  const FIELD_FS = HEADER + `
uniform sampler2D uTrail;
uniform vec2 uSize;        // hero size in CSS pixels
uniform float uPixel;      // drawing-buffer pixels per CSS pixel
uniform float uTime;
uniform vec2 uCursorPx;
uniform float uCursorAmt;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uInkSoft;
uniform vec3 uAccent;
uniform vec4 uQuiet[${QUIET_MAX}]; // text boxes: x0, y0, x1, y1 in CSS pixels
uniform int uQuietCount;
in vec2 vUv;
out vec4 outColor;
${TERRAIN}
// Coverage of the nearest line of v = integer. v's rate of change per pixel
// comes from the screen-space derivatives, so a line holds the same width at
// any size and any slope. This is fwidth measured as a true length: plain
// fwidth reads about 1.4x high on diagonals and would thin them out.
float iso(float v, float widthPx, float slopeWeight){
  float w = max(length(vec2(dFdx(v), dFdy(v))), 1e-5);
  float d = abs(fract(v - 0.5) - 0.5) / w;
  float half_ = max(widthPx, 1.0) * 0.5;
  float line = 1.0 - smoothstep(half_ - 0.5, half_ + 0.5, d);
  // A line thinner than a pixel prints lighter instead of thinner.
  line *= min(widthPx, 1.0);
  // Where lines crowd closer than a few pixels, fade them out before they
  // alias into solid bands. Heavier lines hold on longer.
  return line * (1.0 - smoothstep(0.16 * slopeWeight, 0.42 * slopeWeight, w));
}
float edgeFade(vec2 css){
  vec2 side = uSize * vec2(${f(EDGE_FADE_SIDES)}, 1.0);
  return smoothstep(0.0, side.x, css.x) * smoothstep(0.0, side.x, uSize.x - css.x)
       * smoothstep(0.0, uSize.y * ${f(EDGE_FADE_TOP)}, css.y)
       * smoothstep(0.0, uSize.y * ${f(EDGE_FADE_BOTTOM)}, uSize.y - css.y);
}
float textQuiet(vec2 css){
  float q = 0.0;
  for (int i = 0; i < uQuietCount; i++){
    vec4 b = uQuiet[i];
    vec2 c = (b.xy + b.zw) * 0.5;
    vec2 d = max(abs(css - c) - (b.zw - b.xy) * 0.5, 0.0);
    q = max(q, 1.0 - smoothstep(0.0, ${f(TEXT_QUIET_SOFTNESS)}, length(d)));
  }
  return q;
}
void main(){
  vec2 css = vec2(vUv.x, 1.0 - vUv.y) * uSize;
  vec2 fromCursor = (css - uCursorPx) / ${f(CURSOR_RADIUS)};
  float bump = exp(-dot(fromCursor, fromCursor));
  float glow = uCursorAmt * bump;
  float near = uCursorAmt * exp(-dot(fromCursor, fromCursor) * 0.28);

  float h = terrain(css / ${f(FIELD_SCALE)}, uTime, ${NOISE_OCTAVES})
          + glow * ${f(CURSOR_STRENGTH)};
  float v = h * ${f(LINE_DENSITY)};

  float weight = 1.0 + near * ${f(CURSOR_LINE_BOOST)};
  float major = iso(v / ${f(MAJOR_EVERY)}, ${f(MAJOR_WIDTH)} * weight * uPixel, 2.5 / ${f(MAJOR_EVERY)});
  float main_ = iso(v, ${f(MAIN_WIDTH)} * weight * uPixel, 1.0);
  float fine = iso(v * ${f(FINE_PER_MAIN)}, ${f(FINE_WIDTH)} * uPixel, 1.0);

  float edge = edgeFade(css);
  float mask = edge * mix(1.0, ${f(TEXT_QUIET)}, textQuiet(css));
  float strong = min(1.0, weight);

  vec3 lineInk = mix(uInk, uAccent, near * ${f(CURSOR_TINT)});
  vec3 softInk = mix(uInkSoft, uAccent, near * ${f(CURSOR_TINT)});
  vec3 col = mix(uPaper, uAccent, near * ${f(CURSOR_WASH)} * mask);
  col = mix(col, softInk, fine * ${f(FINE_OPACITY)} * mask);
  col = mix(col, lineInk, main_ * min(1.0, ${f(MAIN_OPACITY)} * weight) * mask);
  col = mix(col, lineInk, major * min(1.0, ${f(MAJOR_OPACITY)} * weight) * mask * strong);

  // Particles multiply onto what is printed, so they only ever darken.
  float ink = (1.0 - exp(-texture(uTrail, vUv).r)) * ${f(PARTICLE_MAX_OPACITY)} * mask;
  // Dividing by the paper means full ink on bare paper lands exactly on teal.
  col *= mix(vec3(1.0), uAccent / uPaper, ink);

  // Grain stays fixed to the page so it can't shimmer, and goes to nothing at
  // the edges so the canvas meets the page's paper with no seam.
  col += (hash(ivec3(ivec2(gl_FragCoord.xy), 7)) - 0.5) * ${f(GRAIN)} * edge;

  outColor = vec4(col, 1.0);
}`;

  /* --------------------------------------------------------------- GL STATE */

  let gl, programs, vao;
  let stateTex, stateFbo, trailTex, trailFbo, particleCount, stateSide;
  let colors;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error("inkfield: " + gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  function program(vsSource, fsSource) {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSource));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error("inkfield: " + gl.getProgramInfoLog(prog));
    }
    const uniforms = {};
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const name = gl.getActiveUniform(prog, i).name.replace(/\[0\]$/, "");
      uniforms[name] = gl.getUniformLocation(prog, name);
    }
    return { prog, uniforms };
  }

  function makeTarget(width, height, internal, format, type, filter, data) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data || null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("inkfield: render target unsupported");
    }
    return { tex, fbo };
  }

  function makeTrail(width, height) {
    return makeTarget(width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
  }

  function deleteTarget(t) {
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fbo);
  }

  // Everything GPU-side. Throws if this device can't run the effect.
  function initGL() {
    gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      failIfMajorPerformanceCaveat: true,
      powerPreference: "default",
    });
    if (!gl) throw new Error("inkfield: no WebGL2");
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("inkfield: no float targets");

    colors = {
      uPaper: token("--paper"),
      uInk: token("--ink"),
      uInkSoft: token("--ink-soft"),
      uAccent: token("--accent"),
    };

    programs = {
      sim: program(FULLSCREEN_VS, SIM_FS),
      fade: program(FULLSCREEN_VS, FADE_FS),
      points: program(POINTS_VS, POINTS_FS),
      field: program(FULLSCREEN_VS, FIELD_FS),
    };

    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    particleCount = window.innerWidth < SMALL_SCREEN_WIDTH ? PARTICLE_COUNT_SMALL : PARTICLE_COUNT;
    stateSide = Math.ceil(Math.sqrt(particleCount));
    particleCount = stateSide * stateSide;

    const data = new Float32Array(particleCount * 4);
    for (let i = 0; i < particleCount; i++) {
      data[i * 4] = Math.random();
      data[i * 4 + 1] = Math.random();
      data[i * 4 + 2] = Math.random();
      data[i * 4 + 3] = Math.random();
    }
    const a = makeTarget(stateSide, stateSide, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, data);
    const b = makeTarget(stateSide, stateSide, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
    stateTex = [a.tex, b.tex];
    stateFbo = [a.fbo, b.fbo];
    trailTex = null;
    trailFbo = null;
  }

  /* --------------------------------------------------------- SIZE AND TEXT */

  let cssW = 0, cssH = 0, pixel = 1, renderScale = RENDER_SCALE;
  const quiet = new Float32Array(QUIET_MAX * 4);
  let quietCount = 0;

  function sizeCanvas() {
    const box = hero.getBoundingClientRect();
    cssW = Math.max(1, box.width);
    cssH = Math.max(1, box.height);
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    pixel = Math.min(dpr, Math.max(1, dpr * renderScale));
    const w = Math.max(1, Math.round(cssW * pixel));
    const h = Math.max(1, Math.round(cssH * pixel));
    if (canvas.width === w && canvas.height === h && trailTex) return;
    canvas.width = w;
    canvas.height = h;

    // New trail buffers, carrying over what was already printed so a resize
    // or a quality drop doesn't make the teal blink.
    const a = makeTrail(w, h);
    const b = makeTrail(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (trailTex) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
      useProgram(programs.fade);
      bindTexture(0, trailTex[0], programs.fade.uniforms.uTrail);
      gl.uniform1f(programs.fade.uniforms.uFade, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.deleteTexture(trailTex[0]);
      gl.deleteTexture(trailTex[1]);
      gl.deleteFramebuffer(trailFbo[0]);
      gl.deleteFramebuffer(trailFbo[1]);
    }
    trailTex = [a.tex, b.tex];
    trailFbo = [a.fbo, b.fbo];
  }

  // Measures the words themselves (a Range hugs the text, where the block
  // box would run the full column width), so the quiet zones fit the text.
  function measureQuiet() {
    const box = hero.getBoundingClientRect();
    const range = document.createRange();
    quietCount = 0;
    for (const selector of QUIET_SELECTORS) {
      const el = hero.querySelector(selector);
      if (!el || quietCount >= QUIET_MAX) continue;
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      quiet.set([
        r.left - box.left - TEXT_QUIET_PADDING,
        r.top - box.top - TEXT_QUIET_PADDING,
        r.right - box.left + TEXT_QUIET_PADDING,
        r.bottom - box.top + TEXT_QUIET_PADDING,
      ], quietCount * 4);
      quietCount++;
    }
  }

  /* ---------------------------------------------------------------- DRAWING */

  let time = Math.random() * 200;
  let frameIndex = 0;
  let cursorX = 0, cursorY = 0, cursorAmt = 0;

  function useProgram(p) {
    gl.useProgram(p.prog);
  }
  function bindTexture(unit, tex, location) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(location, unit);
  }

  // One simulation step: move the particles, then print them onto the trails.
  function step(dt) {
    time += dt * EVOLVE_SPEED;
    frameIndex = (frameIndex + 1) % 1000000;

    // Particles
    const sim = programs.sim, su = sim.uniforms;
    useProgram(sim);
    gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[1]);
    gl.viewport(0, 0, stateSide, stateSide);
    bindTexture(0, stateTex[0], su.uState);
    gl.uniform2f(su.uExtent, cssW / FIELD_SCALE, cssH / FIELD_SCALE);
    gl.uniform2f(su.uCursor, cursorX / FIELD_SCALE, cursorY / FIELD_SCALE);
    gl.uniform1f(su.uCursorAmt, cursorAmt);
    gl.uniform1f(su.uTime, time);
    gl.uniform1f(su.uDt, dt);
    gl.uniform1i(su.uFrame, frameIndex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    stateTex.reverse();
    stateFbo.reverse();

    // Trails: fade the last frame...
    const fade = programs.fade;
    useProgram(fade);
    gl.bindFramebuffer(gl.FRAMEBUFFER, trailFbo[1]);
    gl.viewport(0, 0, canvas.width, canvas.height);
    bindTexture(0, trailTex[0], fade.uniforms.uTrail);
    gl.uniform1f(fade.uniforms.uFade, Math.exp(-dt / TRAIL_FADE));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ...then add the dots. One dot's ink scales with the area per particle,
    // so a phone with fewer particles and a big screen look about the same,
    // and with the time step so the frame rate doesn't change the darkness.
    const pts = programs.points, pu = pts.uniforms;
    const area = Math.min(1.6, (cssW * cssH) / particleCount / 14);
    useProgram(pts);
    bindTexture(0, stateTex[0], pu.uState);
    gl.uniform2f(pu.uSize, cssW, cssH);
    gl.uniform2f(pu.uCursorPx, cursorX, cursorY);
    gl.uniform1f(pu.uCursorAmt, cursorAmt);
    gl.uniform1f(pu.uPointPx, Math.max(1, PARTICLE_SIZE * pixel));
    gl.uniform1f(pu.uDeposit, PARTICLE_INK * area * dt * 60);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, particleCount);
    gl.disable(gl.BLEND);
    trailTex.reverse();
    trailFbo.reverse();
  }

  function drawField() {
    const field = programs.field, u = field.uniforms;
    useProgram(field);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    bindTexture(0, trailTex[0], u.uTrail);
    gl.uniform2f(u.uSize, cssW, cssH);
    gl.uniform1f(u.uPixel, pixel);
    gl.uniform1f(u.uTime, time);
    gl.uniform2f(u.uCursorPx, cursorX, cursorY);
    gl.uniform1f(u.uCursorAmt, cursorAmt);
    gl.uniform3fv(u.uPaper, colors.uPaper);
    gl.uniform3fv(u.uInk, colors.uInk);
    gl.uniform3fv(u.uInkSoft, colors.uInkSoft);
    gl.uniform3fv(u.uAccent, colors.uAccent);
    gl.uniform4fv(u.uQuiet, quiet);
    gl.uniform1i(u.uQuietCount, quietCount);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /* ----------------------------------------------------------------- CURSOR */

  let pointerX = 0, pointerY = 0, lastMove = -Infinity;

  function notePointer(x, y) {
    pointerX = x;
    pointerY = y;
    lastMove = performance.now();
  }
  window.addEventListener("pointermove", (e) => notePointer(e.clientX, e.clientY), { passive: true });
  window.addEventListener("pointerdown", (e) => notePointer(e.clientX, e.clientY), { passive: true });
  // A finger that starts a scroll ends its pointer events, so follow touches too.
  window.addEventListener("touchmove", (e) => {
    if (e.touches[0]) notePointer(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  // A mouse leaving the window relaxes at once. A finger lifting also counts as
  // a leave, but a tap should hold for the idle time like any other movement.
  document.documentElement.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") lastMove = -Infinity;
  });

  function updateCursor(dt, now) {
    const box = hero.getBoundingClientRect();
    const x = pointerX - box.left;
    const y = pointerY - box.top;
    const active = now - lastMove < CURSOR_IDLE_AFTER * 1000
      && x >= 0 && x <= box.width && y >= 0 && y <= box.height;

    if (active) {
      // Arriving from nothing: start at the cursor rather than sweeping to it.
      const follow = cursorAmt < 0.01 ? 1 : 1 - Math.exp(-dt / CURSOR_FOLLOW_TIME);
      cursorX += (x - cursorX) * follow;
      cursorY += (y - cursorY) * follow;
    }
    const tau = active ? CURSOR_RISE_TIME : CURSOR_RELAX_TIME;
    cursorAmt += ((active ? 1 : 0) - cursorAmt) * (1 - Math.exp(-dt / tau));
  }

  /* ------------------------------------------------------------------- LOOP */

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let running = false, rafId = 0, lastNow = 0, onScreen = true, alive = false;
  let slowSum = 0, slowCount = 0, drawnFrames = 0;

  function show() {
    if (++drawnFrames >= FADE_IN_DELAY_FRAMES) canvas.classList.add("is-live");
  }

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const elapsed = now - lastNow;
    lastNow = now;
    const dt = Math.min(elapsed / 1000, MAX_STEP);
    updateCursor(dt, now);
    step(dt);
    drawField();
    show();
    watchFrameRate(elapsed);
  }

  // Trades resolution for frame rate, one small drop at a time. Only ever
  // goes down, so it can't oscillate.
  function watchFrameRate(elapsed) {
    if (renderScale <= RENDER_SCALE_MIN || elapsed > 200) return;
    slowSum += elapsed;
    if (++slowCount < SLOW_CHECK_FRAMES) return;
    if (slowSum / slowCount > SLOW_FRAME_MS) {
      renderScale = Math.max(RENDER_SCALE_MIN, renderScale * RENDER_SCALE_STEP);
      sizeCanvas();
    }
    slowSum = 0;
    slowCount = 0;
  }

  function renderStill() {
    cursorAmt = 0;
    for (let i = 0; i < STILL_STEPS; i++) step(1 / 30);
    drawField();
    canvas.classList.add("is-live");
  }

  function refresh() {
    if (!alive) return;
    const shouldRun = onScreen && !document.hidden && !motionQuery.matches;
    if (shouldRun && !running) {
      running = true;
      lastNow = performance.now();
      slowSum = 0;
      slowCount = 0;
      rafId = requestAnimationFrame(frame);
    } else if (!shouldRun && running) {
      running = false;
      cancelAnimationFrame(rafId);
    }
  }

  // A resize wipes the canvas, so a stopped canvas needs one fresh frame.
  function layoutChanged() {
    if (!alive) return;
    sizeCanvas();
    measureQuiet();
    if (motionQuery.matches) renderStill();
    else if (!running) drawField();
  }

  function start() {
    try {
      initGL();
      sizeCanvas();
      measureQuiet();
      if (motionQuery.matches) {
        alive = true;
        renderStill();
      } else {
        for (let i = 0; i < WARM_UP_STEPS; i++) step(1 / 60);
        alive = true;
        refresh();
      }
    } catch (err) {
      giveUp();
    }
  }

  // The plain paper background is already behind the canvas.
  function giveUp() {
    alive = false;
    running = false;
    cancelAnimationFrame(rafId);
    canvas.remove();
  }

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    alive = false;
    running = false;
    cancelAnimationFrame(rafId);
    canvas.classList.remove("is-live");
  });
  canvas.addEventListener("webglcontextrestored", () => {
    drawnFrames = 0;
    start();
  });

  document.addEventListener("visibilitychange", refresh);
  motionQuery.addEventListener("change", () => {
    refresh();
    if (alive && motionQuery.matches) renderStill();
  });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      onScreen = entries[entries.length - 1].isIntersecting;
      refresh();
    }).observe(hero);
  }
  if ("ResizeObserver" in window) {
    let pending = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(layoutChanged);
    }).observe(hero);
  }
  // Web fonts change where the text sits.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
    if (alive) layoutChanged();
  });

  start();
})();
