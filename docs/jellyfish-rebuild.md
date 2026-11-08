# Anatomical animation rebuild

## Audit of checkpoint 5f0369e

The supplied 4.5-second capture shows small, tall bells with nearly parallel
appendages. Across the sampled frames the silhouettes change very little.
The renderer itself is reusable; the representation driving it is the problem.

- The bell is a hemisphere sampled randomly, with a 20% sinusoidal rim squeeze.
  Most upper-bell characters barely move. The long half-cycle at zero contraction
  and dense rim make it read as a rigid cap.
- CPU strand anchors duplicate shader geometry. Their XZ and YZ rotation signs
  differ from GLSL's column-major matrices, so roots do not exactly follow the
  rendered bell. Strand depth and shading are then computed from unrelated
  shader geometry, although their final XY positions come from the CPU.
- Seven spring nodes per strand chase offsets along the *current* body heading.
  Every node is continually instructed to straighten parallel to that heading.
  There are no length constraints or persistent world-space bending dynamics.
  Linear interpolation exposes angular bends; randomly coincident glyphs leave
  other parts of a strand empty.
- Eight oral strands share the same narrow center radius, and the shader's oral
  frills are discarded when the CPU XY strand positions replace them.
- Thrust follows contraction amplitude, including the hold/expansion, rather
  than the contracting change in bell volume. Heading is clamped to ±1.18
  radians, so it cannot swim freely downward. A vertical restoring force then
  fights continuous upward thrust near the top.
- Point sizes do not track organism scale, making distant bells dense and
  glyph-heavy. Initial placement favors the upper canvas; pointwise edge fading
  can dissolve animals rather than keep their anatomy inside the scene.

## Implementation direction

Use one continuous bell profile for both glyphs and attachments. Change its
curvature, shoulder width, rim aperture and rim lift during a short power stroke
and a longer refill. Derive thrust from the positive contraction derivative.
Simulate appendages in world coordinates with damped Verlet integration, local
water drag and inextensible segment constraints; only roots follow the bell.
Interpolate those chains with smooth curves and give oral arms actual ribbon
width. Distribute glyphs along anatomical coordinates instead of random strand
distances. Smooth bounded angular velocity can turn through a full circle.
Use whole-body margins and gentle boundary steering to preserve composition.

Retain one atlas, one batched WebGL point draw, existing CSS/theme/portrait,
desk clipping and explorer suspension, adaptive resolution, reduced motion,
visibility pauses, fallback, context recovery and cleanup. Validate an enlarged
single organism before enabling the group. Captures and local QA scripts live
outside the repository.


## Final implementation

`js/jellyfish-model.js` owns the invisible bell surface, stroke timing, steering,
world-space chains and fixed 1/90-second integration. `js/jellyfish.js` samples
that model into one dynamic position buffer. Static glyph metadata and the
16-cell local atlas are uploaded once per context. The two existing HTML script
references now load the shared renderer as an ES module; no CSS or layout changed.

The bell's aperture contracts by about 36%, its crown becomes taller, its lower
shoulder changes curvature and its rim lifts. Small lobes and asymmetry persist
through the cycle. The same surface function computes marginal tentacle roots,
so the CPU/shader attachment disagreement is eliminated. Thrust uses only the
positive change of contraction; the longer refill produces no thrust.

Sixteen fine tentacles and four oral arms each have nineteen nodes. Damped
Verlet integration preserves world-space history while six distance-constraint
passes and a final length projection transfer root motion without stretching.
Cubic interpolation smooths the curves. Oral arms carry five lanes of glyphs
across a twisting, frilled ribbon; fine strands carry evenly spaced glyphs.
Only anchors turn with the bell. Independent water currents and settling act
on the free nodes rather than forcing them toward the body's latest axis.

The homepage uses four organisms on desktop, three on compact devices; the desk
uses three. Rhythms, dimensions, chain lengths, strengths, headings and depth
vary independently. Soft boundary steering and nearby-animal avoidance replace
the upright heading restriction. Mobile organisms are smaller and dimmer.
Reduced-motion resizing translates chain history with its organism, preserving
exact root alignment without advancing the simulation.

The existing desk canvases remain confined to the overview and repository
heading. The latter is still a 2D copy, not another WebGL renderer. Explorer
source, controls, CSS, theme, portrait and foreground markup are unchanged.
An AbortController now removes listeners during cleanup, and canvas removal
is observed on both pages. Adaptive resolution measures the actual frame
interval independently of the bounded simulation time step.

## Validation and evidence

Local QA artifacts are outside the repository at
`jellyfish-review-2026-11-08/ (local review folder)`.

- Inspected the supplied video as time-separated frames. The external Capricorn
  reference could not be retrieved; no source code or assets were copied.
- Recorded an enlarged single jellyfish through more than three cycles. Captured
  twelve frames plus `single.mp4` and `single-contact.jpg`. The contraction,
  refill, propulsion and trailing curved appendages are visible in the sequence.
- Observed the full group for more than sixty seconds and saved
  `group-60-seconds.mp4`, thirteen frames and motion samples. Checked deformation,
  independent headings, forward strokes, silhouettes, smooth turns and edges.
- Compared checkpoint and revised desktop (1440×1000), tablet (768×1024) and
  mobile (390×844) layouts. Portrait bounds are identical: 220px on desktop and
  tablet, 160px on mobile. No horizontal overflow. No content masks or CSS changes.
- Browser checks cover reduced motion/resume, light-theme pause, simulated hidden
  document events, offscreen pause, forced WebGL loss/restoration, forced fallback,
  all six primary navigation destinations, keyboard skip link and navigation.
  Canvas removal stops drawing and releases two buffers, a texture and a program.
- With local API fixtures, the desk retains its WebGL explorer, repository cards,
  file list, zoom/reset controls and orbit drag. Decorative rendering pauses on
  explorer pointer entry and keyboard focus and resumes after leaving. Neither
  decorative canvas is inside the explorer. Tablet/mobile show no overflow.
- All 295 Node tests pass (57 root, 205 games, 27 pool worker, 6 history worker),
  including six new anatomical/integration regression tests. Both Python tests
  pass. Syntax checks and `git diff --check` pass. Games initially lacked installed
  dependencies; installing the existing lockfile resolved those test failures.

These are local Chromium observations, not authenticated production end-to-end
checks or physical-device battery measurements. The smallest distant glyphs
read as texture, and transparent side-on bells can still look flatter than the
large specimen. Visual approval remains subjective. The stash and excluded
untracked items were not modified, and nothing was pushed or deployed.

## Targeted tentacle refinement

The follow-up retains the same world-space Verlet chains, bell surface, stroke,
steering, rendering and page integrations. Changes are confined to appendage
state and `stepChain`, plus regression tests, asset cache versions and changelog.
No character placement, ribbon geometry, bell geometry or organism forces changed.

- Reduced independent sideways-current components by roughly 70–75% and reduced
  their frequency. Damping is stronger near attachments and for broader oral
  arms; fine tips retain more inertia.
- Added a compliant guide for the first three links. Its influence falls away
  before the free filament; existing world-space points are never rotated with
  the body.
- A filtered wake combines the swimming axis and relative water motion, with a
  longer response delay for fine tentacles. A generous angular envelope widens
  toward the tips and limits only excessive folds. It does not assign every
  node a heading-aligned target position.
- Local bending relaxation smooths short zigzags. Oral arms have more resistance
  to sharp bends and a narrower envelope; their separate roots and ribbon lanes
  are retained. Segment lengths and exact root attachment remain constrained.
- Constraint corrections adjust position history to avoid injecting a sideways
  impulse when a folding limit is reached.

The side-by-side close-up uses the saved previous model and current model with
identical timesteps. It spans approximately 31 seconds, seven complete strokes,
and a roughly 56-degree net turn. Both sides render the same bell and follow
exactly the same path. Frames show steadier necks, broader continuous curves,
less flicking and looping, independent fine filaments, and smoother distinct
oral ribbons. Tips continue to lag the turn instead of rotating with the bell.
The refined school was also recorded for more than sixty seconds and compared
with the previous 61-second group recording.

A separate deterministic sixty-second comparison found all organism position,
velocity, heading, contraction, scale and thrust samples exactly equal. Links
pointing forward relative to the bell fell from 13.6% to 1.7%, and sharp local
bends over 40 degrees from 5.5% to 0.6%. These diagnostics support the observed
fold reduction; they are not a visual-quality verdict. Straightening loops also
lengthens the projected strands, so their average lateral tip offset is not
uniformly smaller. The intended improvement is calmer deformation, not a narrow
or rigid bundle.

Artifacts are outside the repository in
`jellyfish-tentacle-review-2026-11-08/ (local review folder)`:
`refined-closeup.mp4`, `closeup-comparison.mp4`, `group-60-seconds.mp4`, sampled
frames, `dynamics-comparison.json`, browser results and test logs. The earlier
recording and prior model are preserved for comparison.

Validation: all 298 Node tests and both Python tests pass. The three additional
regressions cover unfolding a reversed filament, tip lag after a turn, and oral
arm resistance to sharp local bends. Browser safeguards cover reduced motion,
context restoration, visibility suspension, cleanup, navigation and the desk
explorer with local repository fixtures. Render logic, foreground markup, CSS,
explorer source and theme match the preceding rebuild; the only loader edits
are cache-version increments. No deployment, push, stash changes or changes to
excluded untracked files were made. Physical-device performance remains unmeasured.

## Final appendage asymmetry polish

This focused pass retains the refined Verlet integration, stable collar, exact
root/length constraints, damping structure and fold guards. A deterministic
profile derived from each existing organism/strand seed now varies drag,
response, distal flexibility, tip delay, current sensitivity, frequency and
phase. Small bounded attachment-angle and length differences break the evenly
spaced fan. Trait generation consumes no additional swimming RNG values.

Only the final third receives additional slow local flow. Two differently phased,
incommensurate components differ per strand, and a second filtered wake provides
independent tip follow-through. Additional distal smoothing keeps those changes
continuous. The upper collar is unchanged; whole-strand sideways forcing was not
increased. Root angle and average lateral extent stay close to the preceding
refinement. Occasional tip bending remains, especially through broad turns.

Oral arms retain the existing five glyph lanes and draw budget. Their glyphs now
span a broader, gently varying ribbon cross-section perpendicular to the smooth
chain tangent. Low-frequency twist and soft edge undulation replace the tighter
cord-like frills. Separate roots remain; natural overlaps are possible. The
ribbons are entirely characters, with no opaque surface or visible solid mesh.

The previous close-up and group recordings were retained and reviewed. The new
side-by-side close-up uses both the saved previous renderer/model and current
renderer/model with identical timesteps. It spans approximately 41 seconds,
nine swimming cycles and a turn exceeding 100 degrees. A separate 62-second group
capture checks the less regular fan, smooth turn response, independent tips,
oral-arm silhouettes and bounded spreading. These are local visual observations;
small distant ribbons still read as glyph texture and overlapping ribbons can
merge briefly in projection.

All organism position, velocity, heading, phase, contraction, scale and thrust
samples match the previous model exactly over sixty simulated seconds. Bell and
stroke code, propulsion/steering code, CSS, theme and explorer source match the
prior version. Rendering outside appendage sampling is unchanged. Loader cache
versions were incremented; the atlas, shaders, organism counts, glyph budget,
quality adaptation, reduced-motion behavior and lifecycle safeguards remain.

All 301 Node tests (63 root, 205 games, 27 pool, 6 history worker) and both Python
tests pass. Three added regressions verify reproducible per-strand variation and
motion across refresh rates, distinct tip follow-through with stable roots, and
the ribbon tangent following the interpolated curve. Browser safeguards pass
with no page errors, including reduced motion, fallback/context restoration,
visibility suspension, cleanup, navigation and the desk explorer using local
repository fixtures. Syntax checks and `git diff --check` pass.

Artifacts live outside the repository at
`jellyfish-asymmetry-review-2026-11-08/ (local review folder)`:
`updated-closeup.mp4`, `closeup-comparison.mp4`, `group-60-seconds.mp4`, comparison
frames, motion samples, preservation checks and test/browser logs. Previous
recordings, the stash and excluded untracked files were preserved. Nothing was
committed, pushed or deployed. Physical-device performance remains unmeasured.

## Production checkpoint review

The final review compared the latest close-up and group recordings with the
preceding tentacle refinement. Tentacle follow-through, softer oral-arm ribbons
and pulse-driven swimming remain visually convincing; no material regression
was found. Natural overlaps can briefly merge ribbon silhouettes, and distant
characters remain textured rather than individually legible.

All 301 Node tests and both Python tests were rerun successfully. Fresh desktop,
tablet and mobile browser checks preserve the exact portrait bounds and show no
horizontal overflow. Homepage navigation, keyboard entry, reduced motion,
visibility/offscreen suspension, WebGL fallback and context recovery, and resource
cleanup pass. Desk repository/file fixtures and explorer orbit/zoom/reset work;
decoration remains outside the explorer and pauses during pointer/focus use.
A further sixty-second homepage observation completed without page errors.

Animation, theme, portrait, layout and explorer implementation files were
verified unchanged during this review. Only documentation was prepared for the
local checkpoint, including removal of personal absolute paths from these notes.
Captures, logs and temporary QA scripts remain outside the repository; excluded
untracked files and the existing stash are preserved.

The checkpoint is ready for production testing. Remaining checks are real
mobile hardware/battery behavior, other browser engines, and the authenticated
Operations Desk API in its configured environment; local desk checks used fixtures.
No push or deployment is part of this checkpoint.
