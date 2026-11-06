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
  const PARTICLE_COUNT = 65000;     // Laptop and desktop screens
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
  const PARTICLE_ORBIT = 0.2;       // Top speed of the circling around the cursor, field units per second
  const PARTICLE_GATHER = 0.06;      // Pull toward the ring they gather on.
  const PARTICLE_RING = 85;         // Radius of that ring
  const CURSOR_GLOW_INK = 0.5;      // Dots print this many times darker close to the cursor.
  const CURSOR_FOLLOW_TIME = 0.09;  // The effect point catches up to the cursor quickly.
  const CURSOR_RISE_TIME = 0.8;     // The effect itself swells in slowly...
  const CURSOR_RELAX_TIME = 1.7;    // ...and relaxes back to ambient more slowly still.
  const CURSOR_IDLE_AFTER = 2.5;    // Idle time before relaxing

  // Photo island: a permanent peak on the chart, centered on the photo
  const ISLAND_SELECTOR = ".portrait img";
  const ISLAND_SIZE = 1.7;          // How far the peak reaches past the photo's edge, in photo radii
  const ISLAND_RINGS = 12;          // Main contour lines the peak adds between its foot and the photo
  const ISLAND_RING_TIGHTNESS = 2.6; // Bigger = rings pack tighter at the photo and loosen faster.
  const ISLAND_FRAME_WIDTH = 1.5;   // Width of the ink frame. Keep it equal to the box-shadow in style.css.
  const ISLAND_MARGIN = 14;         // Clean paper between the frame and the nearest ink
  const ISLAND_MARGIN_FADE = 8;     // Soft fade at the margin's outer edge
  const ISLAND_FLOW_REACH = 220;    // How far out the current starts bending around the island

  // The name in particles
  const LETTER_SHARE = 0.4;         // Share of all particles that build the name
  const INTRO_DURATION = 2.5;       // From load until the real headline fades in
  const SPRING_STRENGTH = 40;       // Pull toward home. Bigger = snappier, tighter letters.
  const SCATTER_STRENGTH = 0.22;    // How hard the cursor's motion throws particles
  const REASSEMBLE_TIME = 2;        // From the cursor leaving until the real headline fades in
  const SCATTER_RADIUS = 44;        // Width of the cursor's path through the letters
  const SCATTER_MIN_PUSH = 0.12;    // Push from even a slow cursor, field units per second
  const SCATTER_SPREAD = 1.1;       // Fan of throw directions around the cursor's path, radians
  const LETTER_FREE_DAMPING = 1.4;  // How quickly a thrown particle slows into the current
  const LETTER_MAX_SPEED = 1.8;     // Speed limit for letter particles, field units per second
  const LETTER_INK = 0.26;          // How dark one letter dot prints
  const LETTER_TRAIL_FADE = 0.07;   // Trail length for letter dots. Short keeps the letters crisp.
  const INTRO_LANDING = 0.65;       // Share of the intro spent flying in. The rest is the settled name.
  const LETTER_MAX_OPACITY = 0.96;  // Ceiling where letter dots overlap
  const LETTER_SHIMMER = 0.45;      // How far settled particles wander from home
  const LETTER_FLOW = 0.03;         // Share of the current settled particles still feel
  const THIN_STROKE_BOOST = 1.1;    // Bigger = more particles on hairlines and serifs
  const LETTER_FADE_IN = 0.07;      // Fade times for the letter ink
  const LETTER_FADE_OUT = 0.35;
  const FONT_WAIT = 1500;           // Milliseconds to wait for the web font before showing the headline
  const INTRO_STORAGE_KEY = "inkfield-intro-played";

  // Finish
  const GRAIN = 0.011;             // Paper grain strength. Keep this tiny.
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
  // of the hero with y running down. A letter particle uses the third channel
  // for looseness instead of life: 0 is held at home, 1 is free in the current.
  // Velocity is only used by letter particles. Home is (x, y, isLetter, unused)
  // and never changes between layouts.
  const SIM_FS = HEADER + `
uniform sampler2D uState;
uniform sampler2D uVelocity;
uniform sampler2D uHome;
uniform float uHold;      // 1 keeps thrown particles loose while the cursor is in the headline
uniform float uLooseTime; // Seconds for a loose particle to come back under the spring
uniform vec4 uPushPath;   // Cursor's path this frame: start xy, end xy, field units
uniform vec3 uPush;       // Cursor's direction xy and push strength; strength 0 = no push
uniform vec2 uExtent;     // hero size in field units
uniform vec2 uCursor;     // field units
uniform float uCursorAmt;
uniform float uTime;
uniform float uDt;
uniform int uFrame;
layout(location = 0) out vec4 outState;
layout(location = 1) out vec4 outVelocity;
${TERRAIN}
uniform vec3 uIsland;     // photo center and radius in field units; radius 0 = no photo
const float ISLAND_WALL = ${f((ISLAND_FRAME_WIDTH + ISLAND_MARGIN + ISLAND_MARGIN_FADE) / FIELD_SCALE)};
float islandGap(vec2 p){ return length(p - uIsland.xy) - uIsland.z - ISLAND_WALL; }
float potential(vec2 p){
  float flow = terrain(p, uTime, 2) + ${f(FLOW_SWIRL)} * vnoise(vec3(p * 1.7 + 40.0, uTime * 1.4));
  // The orbit around the cursor is part of the potential, so like the current
  // it is a curl: particles can circle without bunching up anywhere.
  vec2 fromCursor = (p - uCursor) / ${f(PARTICLE_PULL_RADIUS / FIELD_SCALE)};
  flow -= uCursorAmt * exp(-dot(fromCursor, fromCursor))
        * ${f(PARTICLE_ORBIT * (PARTICLE_PULL_RADIUS / FIELD_SCALE) / (0.858 * FLOW_SPEED))};
  // Scaling the potential to zero at the island's edge turns that edge into a
  // streamline: the curl below runs along it and never through it. This ramp
  // has a real slope at zero, so particles keep sliding along the edge. A
  // smoothstep would stall them there, and stalled particles pile up.
  if (uIsland.z > 0.0){
    float r = clamp(islandGap(p) / ${f(ISLAND_FLOW_REACH / FIELD_SCALE)}, 0.0, 1.0);
    flow *= r * (1.875 + r * r * (0.375 * r * r - 1.25));
  }
  return flow;
}
// Near the island's edge, cancel inward motion and keep the sideways part.
vec2 slideOffIsland(vec2 vel, vec2 p){
  if (uIsland.z <= 0.0) return vel;
  vec2 away = p - uIsland.xy;
  away /= max(length(away), 1e-4);
  return vel - away * min(dot(vel, away), 0.0) * (1.0 - smoothstep(0.0, ISLAND_WALL, islandGap(p)));
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

  vec4 home = texelFetch(uHome, texel, 0);
  if (home.z > 0.5){
    vec2 v = texelFetch(uVelocity, texel, 0).xy;
    float loose = s.z;

    // The cursor throws particles along its own direction of travel, fanned
    // out a little. Particles near its path also come loose from their home.
    if (uPush.z > 0.0){
      vec2 ab = uPushPath.zw - uPushPath.xy;
      float along = clamp(dot(p - uPushPath.xy, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
      vec2 off = (p - uPushPath.xy - ab * along) / ${f(SCATTER_RADIUS / FIELD_SCALE)};
      float hit = exp(-dot(off, off));
      float fan = (fract(seed * 53.71) - 0.5) * ${f(SCATTER_SPREAD)};
      float c = cos(fan), n = sin(fan);
      v += vec2(c * uPush.x - n * uPush.y, n * uPush.x + c * uPush.y) * uPush.z * hit * (0.5 + seed);
      loose = max(loose, smoothstep(0.05, 0.45, hit));
    }
    if (uHold < 0.5) loose = max(0.0, loose - uDt / (uLooseTime * (0.55 + 0.45 * seed)));

    // A spring toward home that strengthens as the particle comes back, plus
    // the current, which settled particles barely feel. The small circle added
    // to home is the shimmer.
    float tight = (1.0 - loose) * (1.0 - loose);
    float clock = uTime / ${f(EVOLVE_SPEED)};
    vec2 target = home.xy * uExtent + vec2(sin(clock * (2.0 + seed * 3.0) + seed * 80.0),
                                           cos(clock * (1.5 + seed * 3.0) + seed * 50.0))
                                    * ${f(LETTER_SHIMMER / FIELD_SCALE)};
    v += (target - p) * ${f(SPRING_STRENGTH)} * tight * uDt;
    v *= exp(-mix(${f(2 * Math.sqrt(SPRING_STRENGTH))}, ${f(LETTER_FREE_DAMPING)}, loose) * uDt);
    // Each particle has its own limit, mostly slow with a few fast. A shared limit
    // lines thrown particles up into a hard-edged arc, and so does tying the limit
    // to the throw angle above, so the two come from different digits of the seed.
    float limit = fract(seed * 97.13);
    v *= min(1.0, ${f(LETTER_MAX_SPEED)} * (0.12 + 0.88 * limit * limit) / max(length(v), 1e-4));

    vec2 move = slideOffIsland(v + vel * mix(${f(LETTER_FLOW)}, 1.0, loose), p);
    outState = vec4(clamp(pos + move * uDt / uExtent, -0.2, 1.2), loose, seed);
    outVelocity = vec4(v, 0.0, 0.0);
    return;
  }
  outVelocity = vec4(0.0);

  // Gather toward a ring around the cursor. The orbit is in potential().
  if (uCursorAmt > 0.001){
    vec2 toCursor = uCursor - p;
    float r = max(length(toCursor), 1e-3);
    vec2 inward = toCursor / r;
    float reach = r / ${f(PARTICLE_PULL_RADIUS / FIELD_SCALE)};
    float fall = uCursorAmt * exp(-reach * reach);
    // Let go close to the island, or the pull piles particles up against it.
    if (uIsland.z > 0.0) fall *= smoothstep(0.0, ${f(ISLAND_FLOW_REACH * 0.65 / FIELD_SCALE)}, islandGap(p));
    float ring = ${f(PARTICLE_RING / FIELD_SCALE)};
    vel += fall * ${f(PARTICLE_GATHER)} * inward * clamp((r - ring) / ring, -1.0, 1.0);
  }

  // The cursor's pull isn't a curl, so it could still drag particles onto the
  // island.
  bool onIsland = uIsland.z > 0.0 && islandGap(p) < 0.0;
  vel = slideOffIsland(vel, p);

  pos += vel * uDt / uExtent;
  float life = s.z - uDt / (${f(PARTICLE_LIFE)} * (0.6 + 0.8 * seed));

  if (life <= 0.0 || onIsland || pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0){
    pos = vec2(hash(ivec3(texel, uFrame)), hash(ivec3(texel.yx, uFrame + 7919)));
    life = 1.0;
  }
  outState = vec4(pos, life, seed);
}`;

  // Pass 2a: fade the trails.
  const FADE_FS = HEADER + `
uniform sampler2D uTrail;
uniform vec2 uFade;       // Red is the teal current, green is the letters.
in vec2 vUv;
out vec4 outColor;
void main(){ outColor = vec4(texture(uTrail, vUv).rg * uFade, 0.0, 1.0); }`;

  // Pass 2b: add the particles as dots. No vertex buffers: each point reads
  // its position straight out of the state texture. Current particles print
  // teal into the red channel and letter particles print ink into the green.
  const POINTS_VS = HEADER + `
uniform sampler2D uState;
uniform sampler2D uHome;
uniform float uLetterDeposit;
uniform vec2 uSize;       // hero size in CSS pixels
uniform vec2 uCursorPx;
uniform float uCursorAmt;
uniform float uPointPx;
uniform float uDeposit;
out vec2 vInk;
void main(){
  int side = textureSize(uState, 0).x;
  ivec2 texel = ivec2(gl_VertexID % side, gl_VertexID / side);
  vec4 s = texelFetch(uState, texel, 0);
  float seed = s.w;
  gl_PointSize = uPointPx * (0.8 + 0.5 * seed);
  gl_Position = vec4(s.x * 2.0 - 1.0, 1.0 - s.y * 2.0, 0.0, 1.0);
  if (texelFetch(uHome, texel, 0).z > 0.5){
    vInk = vec2(0.0, uLetterDeposit * (0.7 + 0.6 * seed));
    return;
  }
  float born = smoothstep(0.0, 0.14, 1.0 - s.z);
  float dying = smoothstep(0.0, 0.14, s.z);
  // Most particles print faintly and a few print darker, so currents show
  // as threads rather than an even teal haze.
  float tier = mix(0.2, 3.4, pow(seed, 7.0));
  vec2 d = (s.xy * uSize - uCursorPx) / ${f(PARTICLE_PULL_RADIUS * 0.8)};
  float near = uCursorAmt * exp(-dot(d, d));
  vInk = vec2(uDeposit * tier * born * dying * (1.0 + near * ${f(CURSOR_GLOW_INK)}), 0.0);
}`;
  const POINTS_FS = HEADER + `
in vec2 vInk;
out vec4 outColor;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;
  outColor = vec4(vInk * (1.0 - smoothstep(0.35, 1.0, r)), 0.0, 1.0);
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
uniform vec3 uIsland;      // photo center and radius in CSS pixels; radius 0 = no photo
uniform float uLetterInk;  // 0 hides the letter particles, 1 prints them in full
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

  // The island's slope is steepest at the photo and eases to nothing at its
  // foot, so its rings start tight and loosen with distance. It adds to the
  // terrain and the cursor bump, so the cursor still works beside the photo.
  float islandEdge = uIsland.z > 0.0 ? length(css - uIsland.xy) - uIsland.z : 1e6;
  float islandFoot = clamp(1.0 - max(islandEdge, 0.0) / (uIsland.z * ${f(ISLAND_SIZE)} + 1e-3), 0.0, 1.0);
  float islandHeight = ${f(ISLAND_RINGS / LINE_DENSITY)} * pow(islandFoot, ${f(ISLAND_RING_TIGHTNESS)});

  float h = terrain(css / ${f(FIELD_SCALE)}, uTime, ${NOISE_OCTAVES})
          + glow * ${f(CURSOR_STRENGTH)} + islandHeight;
  float v = h * ${f(LINE_DENSITY)};

  float weight = 1.0 + near * ${f(CURSOR_LINE_BOOST)};
  float major = iso(v / ${f(MAJOR_EVERY)}, ${f(MAJOR_WIDTH)} * weight * uPixel, 2.5 / ${f(MAJOR_EVERY)});
  float main_ = iso(v, ${f(MAIN_WIDTH)} * weight * uPixel, 1.0);
  float fine = iso(v * ${f(FINE_PER_MAIN)}, ${f(FINE_WIDTH)} * uPixel, 1.0);

  float edge = edgeFade(css);
  float mask = edge * mix(1.0, ${f(TEXT_QUIET)}, textQuiet(css));
  // Clean paper around the photo: no lines, particles or cursor wash.
  float islandClear = smoothstep(${f(ISLAND_FRAME_WIDTH + ISLAND_MARGIN)},
                                 ${f(ISLAND_FRAME_WIDTH + ISLAND_MARGIN + ISLAND_MARGIN_FADE)}, islandEdge);
  mask *= islandClear;
  float strong = min(1.0, weight);

  vec3 lineInk = mix(uInk, uAccent, near * ${f(CURSOR_TINT)});
  vec3 softInk = mix(uInkSoft, uAccent, near * ${f(CURSOR_TINT)});
  vec3 col = mix(uPaper, uAccent, near * ${f(CURSOR_WASH)} * mask);
  col = mix(col, softInk, fine * ${f(FINE_OPACITY)} * mask);
  col = mix(col, lineInk, main_ * min(1.0, ${f(MAIN_OPACITY)} * weight) * mask);
  col = mix(col, lineInk, major * min(1.0, ${f(MAJOR_OPACITY)} * weight) * mask * strong);

  // Particles multiply onto what is printed, so they only ever darken.
  vec2 printed = texture(uTrail, vUv).rg;
  float ink = (1.0 - exp(-printed.r)) * ${f(PARTICLE_MAX_OPACITY)} * mask;
  // Dividing by the paper means full ink on bare paper lands exactly on teal.
  col *= mix(vec3(1.0), uAccent / uPaper, ink);

  // The name prints in ink. It skips the text and edge fades, since it has to
  // show right where the headline sits, but it still keeps off the island and
  // fades out just before the canvas ends.
  vec2 fromEdge = min(css, uSize - css);
  float letterInk = (1.0 - exp(-printed.g)) * ${f(LETTER_MAX_OPACITY)} * uLetterInk * islandClear
                  * smoothstep(0.0, 12.0, min(fromEdge.x, fromEdge.y));
  col *= mix(vec3(1.0), uInk / uPaper, letterInk);

  // Grain stays fixed to the page so it can't shimmer, and goes to nothing at
  // the edges so the canvas meets the page's paper with no seam.
  col += (hash(ivec3(ivec2(gl_FragCoord.xy), 7)) - 0.5) * ${f(GRAIN)} * edge;

  outColor = vec4(col, 1.0);
}`;

  /* --------------------------------------------------------------- GL STATE */

  let gl, programs, vao;
  let stateTex, stateFbo, velocityTex, homeTex, trailTex, trailFbo, particleCount, stateSide;
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

  function makeTexture(width, height, internal, format, type, filter, data) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data || null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function makeTarget(width, height, internal, format, type, filter, data) {
    const tex = makeTexture(width, height, internal, format, type, filter, data);
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

  // A particle state target: position in attachment 0, velocity in attachment 1.
  function makeState(data) {
    const target = makeTarget(stateSide, stateSide, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, data);
    const velocity = makeTexture(stateSide, stateSide, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, velocity, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("inkfield: render target unsupported");
    }
    target.velocity = velocity;
    return target;
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
    const a = makeState(data);
    const b = makeState();
    stateTex = [a.tex, b.tex];
    stateFbo = [a.fbo, b.fbo];
    velocityTex = [a.velocity, b.velocity];
    // All zeros means no letter particles until the name's shape is ready.
    homeTex = makeTexture(stateSide, stateSide, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
    lettersOn = false;
    letterState = "off";
    letterCount = 0;
    letterInk = letterInkTarget = 0;
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
      gl.uniform2f(programs.fade.uniforms.uFade, 1, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.deleteTexture(trailTex[0]);
      gl.deleteTexture(trailTex[1]);
      gl.deleteFramebuffer(trailFbo[0]);
      gl.deleteFramebuffer(trailFbo[1]);
    }
    trailTex = [a.tex, b.tex];
    trailFbo = [a.fbo, b.fbo];
  }

  // The island follows the photo wherever the layout puts it.
  let islandX = 0, islandY = 0, islandR = 0;
  function measureIsland() {
    const photo = hero.querySelector(ISLAND_SELECTOR);
    const r = photo && photo.getBoundingClientRect();
    if (!r || !r.width) {
      islandR = 0;
      return;
    }
    const box = hero.getBoundingClientRect();
    islandX = r.left - box.left + r.width / 2;
    islandY = r.top - box.top + r.height / 2;
    islandR = r.width / 2;
  }

  function measureLayout() {
    measureQuiet();
    measureIsland();
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
    bindTexture(1, homeTex, su.uHome);
    bindTexture(2, velocityTex[0], su.uVelocity);
    gl.uniform1f(su.uHold, letterState === "scattered" ? 1 : 0);
    gl.uniform1f(su.uLooseTime, letterState === "intro" ? INTRO_DURATION * INTRO_LANDING : REASSEMBLE_TIME * 0.8);
    gl.uniform4f(su.uPushPath, pushFromX / FIELD_SCALE, pushFromY / FIELD_SCALE, pushToX / FIELD_SCALE, pushToY / FIELD_SCALE);
    gl.uniform3f(su.uPush, pushDirX, pushDirY, pushStrength);
    pushStrength = 0;
    gl.uniform2f(su.uExtent, cssW / FIELD_SCALE, cssH / FIELD_SCALE);
    gl.uniform2f(su.uCursor, cursorX / FIELD_SCALE, cursorY / FIELD_SCALE);
    gl.uniform1f(su.uCursorAmt, cursorAmt);
    gl.uniform3f(su.uIsland, islandX / FIELD_SCALE, islandY / FIELD_SCALE, islandR / FIELD_SCALE);
    gl.uniform1f(su.uTime, time);
    gl.uniform1f(su.uDt, dt);
    gl.uniform1i(su.uFrame, frameIndex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    stateTex.reverse();
    stateFbo.reverse();
    velocityTex.reverse();

    // Trails: fade the last frame...
    const fade = programs.fade;
    useProgram(fade);
    gl.bindFramebuffer(gl.FRAMEBUFFER, trailFbo[1]);
    gl.viewport(0, 0, canvas.width, canvas.height);
    bindTexture(0, trailTex[0], fade.uniforms.uTrail);
    gl.uniform2f(fade.uniforms.uFade, Math.exp(-dt / TRAIL_FADE), Math.exp(-dt / LETTER_TRAIL_FADE));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ...then add the dots. One dot's ink scales with the area per particle,
    // so a phone with fewer particles and a big screen look about the same,
    // and with the time step so the frame rate doesn't change the darkness.
    const pts = programs.points, pu = pts.uniforms;
    const area = Math.min(1.6, (cssW * cssH) / (particleCount - letterCount) / 14);
    useProgram(pts);
    bindTexture(0, stateTex[0], pu.uState);
    bindTexture(1, homeTex, pu.uHome);
    gl.uniform1f(pu.uLetterDeposit, LETTER_INK * dt * 60);
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
    gl.uniform3f(u.uIsland, islandX, islandY, islandR);
    gl.uniform1f(u.uLetterInk, letterInk);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /* ----------------------------------------------------------------- CURSOR */

  let pointerX = 0, pointerY = 0, lastMove = -Infinity;
  let fingerLifted = false; // The finger is off the glass, so it can't be in the headline.

  function notePointer(x, y) {
    pointerX = x;
    pointerY = y;
    lastMove = performance.now();
    fingerLifted = false;
  }
  function noteFingerLifted() {
    fingerLifted = true;
  }
  window.addEventListener("touchend", noteFingerLifted, { passive: true });
  window.addEventListener("touchcancel", noteFingerLifted, { passive: true });
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

  /* ------------------------------------------------------- THE NAME IN PARTICLES

     letterState runs intro -> rest -> scattered -> returning -> rest, and stays
     "off" when reduced motion is on or the name can't be built. The h1 only ever
     gets a class that sets its opacity, so it stays real, clickable text the
     whole time, and any failure path puts it straight back. */

  const headline = hero.querySelector("h1");
  let lettersOn = false, letterState = "off", letterRows = 0, letterCount = 0;
  let letterInk = 0, letterInkTarget = 0, stateUntil = 0, homesKey = "", headBox = null, lastHomes = null;
  let pushFromX = 0, pushFromY = 0, pushToX = 0, pushToY = 0, pushDirX = 0, pushDirY = 0, pushStrength = 0;
  let prevPointerX = 0, prevPointerY = 0, pointerSeen = false, wasInHeadline = false;

  function hideHeadline(instantly) {
    if (headline) headline.classList.add(instantly ? "ink-intro" : "ink-hidden");
  }
  function showHeadline() {
    if (headline) headline.classList.remove("ink-intro", "ink-hidden");
  }

  function introPlayed() {
    try {
      return sessionStorage.getItem(INTRO_STORAGE_KEY) === "1";
    } catch (err) {
      return false;
    }
  }
  function markIntroPlayed() {
    try {
      sessionStorage.setItem(INTRO_STORAGE_KEY, "1");
    } catch (err) {
      // Private modes can refuse storage. The intro just plays again next time.
    }
  }

  // Where each glyph really sits, read from the live h1. Measuring one letter
  // at a time means kerning, letter-spacing and line breaks all come from the
  // browser's own layout and can't drift from the real text.
  function measureGlyphs() {
    const glyphs = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(headline, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (let i = 0; i < node.length; i++) {
        const ch = node.data[i];
        if (!ch.trim()) continue;
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getBoundingClientRect();
        if (r.width) glyphs.push({ ch, left: r.left, top: r.top, height: r.height });
      }
    }
    return glyphs;
  }

  // Draws the name offscreen with the h1's exact font and glyph positions, then
  // places one home per particle on the filled pixels. Thin strokes get extra
  // weight, because plain sampling by area would leave hairlines and serifs
  // too sparse to read. Returns false if there is nothing to sample.
  function sampleHomes() {
    const glyphs = measureGlyphs();
    if (!glyphs.length) return false;
    const box = hero.getBoundingClientRect();
    const cs = getComputedStyle(headline);
    const size = parseFloat(cs.fontSize);
    const key = [box.width, box.height, glyphs[0].left - box.left, glyphs[0].top - box.top, size, cs.fontFamily].join();
    if (key === homesKey) return true;

    const SCALE = 3, PAD = Math.ceil(size * 0.3);
    const left = Math.min(...glyphs.map((g) => g.left)) - PAD;
    const top = Math.min(...glyphs.map((g) => g.top)) - PAD;
    const right = Math.max(...glyphs.map((g) => g.left + size)) + PAD;
    const bottom = Math.max(...glyphs.map((g) => g.top + g.height)) + PAD;
    const w = Math.ceil((right - left) * SCALE), h = Math.ceil((bottom - top) * SCALE);
    const scratch = document.createElement("canvas");
    scratch.width = w;
    scratch.height = h;
    const ctx = scratch.getContext("2d", { willReadFrequently: true });
    ctx.scale(SCALE, SCALE);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#000";
    const metrics = ctx.measureText("C");
    for (const g of glyphs) {
      // A glyph's rect is its font box, so center that box to find the baseline.
      const ascent = metrics.fontBoundingBoxAscent || g.height * 0.8;
      const descent = metrics.fontBoundingBoxDescent || g.height * 0.2;
      ctx.fillText(g.ch, g.left - left, g.top - top + (g.height - ascent - descent) / 2 + ascent);
    }
    const alpha = ctx.getImageData(0, 0, w, h).data;

    // A running sum over the pixels, so any box's fill can be read in one step.
    const sums = new Uint32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += alpha[(y * w + x) * 4 + 3] > 127 ? 1 : 0;
        sums[(y + 1) * (w + 1) + x + 1] = sums[y * (w + 1) + x + 1] + row;
      }
    }
    // A pixel's weight rises as the area around it gets emptier, which is what
    // a thin stroke looks like up close.
    const reach = Math.max(2, Math.round(size * 0.055 * SCALE));
    const weights = new Float32Array(w * h);
    let total = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (alpha[(y * w + x) * 4 + 3] <= 127) continue;
        const x0 = Math.max(0, x - reach), x1 = Math.min(w, x + reach + 1);
        const y0 = Math.max(0, y - reach), y1 = Math.min(h, y + reach + 1);
        const filled = sums[y1 * (w + 1) + x1] - sums[y0 * (w + 1) + x1] - sums[y1 * (w + 1) + x0] + sums[y0 * (w + 1) + x0];
        const weight = Math.pow(((x1 - x0) * (y1 - y0)) / filled, THIN_STROKE_BOOST);
        weights[y * w + x] = weight;
        total += weight;
      }
    }
    if (!total) return false;

    // Evenly spaced picks along the weights give even coverage with no clumps.
    const homes = new Float32Array(letterCount * 4);
    const stride = total / letterCount;
    let next = Math.random() * stride, running = 0, placed = 0;
    for (let i = 0; i < weights.length && placed < letterCount; i++) {
      if (!weights[i]) continue;
      running += weights[i];
      while (running > next && placed < letterCount) {
        const px = (i % w + Math.random()) / SCALE + left - box.left;
        const py = (Math.floor(i / w) + Math.random()) / SCALE + top - box.top;
        homes.set([px / box.width, py / box.height, 1, 0], placed * 4);
        placed++;
        next += stride;
      }
    }
    if (placed < letterCount) return false;
    // Shuffled, so a particle's slot says nothing about which letter it builds.
    for (let i = letterCount - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      for (let c = 0; c < 2; c++) {
        const t = homes[i * 4 + c];
        homes[i * 4 + c] = homes[j * 4 + c];
        homes[j * 4 + c] = t;
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, homeTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, stateSide, letterRows, gl.RGBA, gl.FLOAT, homes);
    lastHomes = homes;
    homesKey = key;

    const range = document.createRange();
    range.selectNodeContents(headline);
    const r = range.getBoundingClientRect();
    headBox = { left: r.left - box.left, top: r.top - box.top, right: r.right - box.left, bottom: r.bottom - box.top };
    return true;
  }

  // Turns the first rows of particles into letter particles, starting either at
  // the hero's edges for the intro or already at home.
  function buildLetters(playIntro) {
    letterRows = Math.round(LETTER_SHARE * stateSide);
    letterCount = letterRows * stateSide;
    homesKey = "";
    if (!sampleHomes()) throw new Error("inkfield: no letter shapes");

    const box = hero.getBoundingClientRect();
    const data = new Float32Array(letterCount * 4);
    for (let i = 0; i < letterCount; i++) {
      let x = lastHomes[i * 4], y = lastHomes[i * 4 + 1];
      if (playIntro) {
        // A random spot just inside the hero's outline.
        const along = Math.random() * 2 * (box.width + box.height);
        const inset = Math.random() * 24;
        if (along < box.width) { x = along; y = inset; }
        else if (along < box.width + box.height) { x = box.width - inset; y = along - box.width; }
        else if (along < 2 * box.width + box.height) { x = along - box.width - box.height; y = box.height - inset; }
        else { x = inset; y = along - 2 * box.width - box.height; }
        x /= box.width;
        y /= box.height;
      }
      data.set([x, y, playIntro ? 1 : 0, Math.random()], i * 4);
    }
    gl.bindTexture(gl.TEXTURE_2D, stateTex[0]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, stateSide, letterRows, gl.RGBA, gl.FLOAT, data);

    lettersOn = true;
    pointerSeen = false;
    wasInHeadline = false;
    if (playIntro) {
      markIntroPlayed();
      letterState = "intro";
      letterInk = letterInkTarget = 1;
      stateUntil = performance.now() + INTRO_DURATION * 1000;
      // Even if frames stop (a hidden tab, say), the name still comes back.
      setTimeout(finishAssembling, INTRO_DURATION * 1000 + 400);
    } else {
      letterState = "rest";
      letterInk = letterInkTarget = 0;
      showHeadline();
    }
  }

  // The real headline takes over from the particles.
  function finishAssembling() {
    if (letterState !== "intro" && letterState !== "returning" && letterState !== "scattered") return;
    letterState = "rest";
    letterInkTarget = 0;
    showHeadline();
  }

  function lettersOff() {
    lettersOn = false;
    letterState = "off";
    letterInk = letterInkTarget = 0;
    showHeadline();
  }

  // Runs every frame: follows the pointer through the headline and moves between states.
  function updateLetters(elapsed, now) {
    if (!lettersOn) return;
    const box = hero.getBoundingClientRect();
    const x = pointerX - box.left, y = pointerY - box.top;
    const inHeadline = !fingerLifted && headBox
      && now - lastMove < CURSOR_IDLE_AFTER * 1000
      && x >= headBox.left && x <= headBox.right && y >= headBox.top && y <= headBox.bottom;
    const moved = pointerSeen && (pointerX !== prevPointerX || pointerY !== prevPointerY);

    if (letterState !== "intro" && moved && !fingerLifted && (inHeadline || wasInHeadline)) {
      if (inHeadline && letterState !== "scattered") {
        letterState = "scattered";
        letterInkTarget = 1;
        hideHeadline(false);
      }
      const dx = pointerX - prevPointerX, dy = pointerY - prevPointerY;
      const length = Math.hypot(dx, dy);
      pushFromX = x - dx;
      pushFromY = y - dy;
      pushToX = x;
      pushToY = y;
      pushDirX = dx / length;
      pushDirY = dy / length;
      pushStrength = Math.max(SCATTER_MIN_PUSH, (length / FIELD_SCALE) * 60 * SCATTER_STRENGTH);
    }
    if (letterState === "scattered" && !inHeadline) {
      letterState = "returning";
      stateUntil = now + REASSEMBLE_TIME * 1000;
    }
    if ((letterState === "intro" || letterState === "returning") && now >= stateUntil) finishAssembling();

    pointerSeen = !fingerLifted && now - lastMove < CURSOR_IDLE_AFTER * 1000;
    prevPointerX = pointerX;
    prevPointerY = pointerY;
    wasInHeadline = inHeadline;

    // Real time, not the capped simulation step: on a slow device the text has
    // already come back, so the ink has to clear even if the particles lag.
    const tau = letterInkTarget > letterInk ? LETTER_FADE_IN : LETTER_FADE_OUT;
    letterInk += (letterInkTarget - letterInk) * (1 - Math.exp(-Math.min(elapsed / 1000, 1) / tau));
  }

  // Called once WebGL is confirmed working. For the intro the h1 hides right away
  // so it can't flash, and it comes back if the font takes too long.
  function prepareLetters() {
    if (!headline || motionQuery.matches) return;
    const box = hero.getBoundingClientRect();
    const playIntro = !introPlayed() && !document.hidden && box.bottom > 0 && box.top < window.innerHeight;
    if (playIntro) {
      hideHeadline(true);
      canvas.classList.add("is-quick");
    }
    let late = false;
    const fontTimer = setTimeout(() => {
      late = true;
      showHeadline();
    }, FONT_WAIT);
    const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    fontsReady.then(() => {
      clearTimeout(fontTimer);
      if (!alive || motionQuery.matches) return showHeadline();
      try {
        buildLetters(playIntro && !late);
      } catch (err) {
        lettersOff();
      }
    });
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
    updateLetters(elapsed, now);
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
      // With no frames the particles can't finish, so hand back to the text now.
      finishAssembling();
    }
  }

  // A resize wipes the canvas, so a stopped canvas needs one fresh frame.
  function layoutChanged() {
    if (!alive) return;
    sizeCanvas();
    measureLayout();
    if (lettersOn && !sampleHomes()) lettersOff();
    if (motionQuery.matches) renderStill();
    else if (!running) drawField();
  }

  function start() {
    try {
      initGL();
      sizeCanvas();
      measureLayout();
      if (motionQuery.matches) {
        alive = true;
        renderStill();
      } else {
        for (let i = 0; i < WARM_UP_STEPS; i++) step(1 / 60);
        alive = true;
        prepareLetters();
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
    lettersOff();
    canvas.remove();
  }

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    alive = false;
    running = false;
    cancelAnimationFrame(rafId);
    canvas.classList.remove("is-live");
    lettersOff();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    drawnFrames = 0;
    start();
  });

  document.addEventListener("visibilitychange", refresh);
  motionQuery.addEventListener("change", () => {
    if (motionQuery.matches) lettersOff();
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
