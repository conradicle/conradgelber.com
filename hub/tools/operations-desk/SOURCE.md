# Operations Desk 3D viewer

The viewer uses Three.js 0.187.0 (MIT), already pinned in `play-src/package.json`.
Upstream: https://github.com/mrdoob/three.js/tree/r187
License: `THREE-LICENSE.txt` in this folder.

Local scene source: `play-src/src/operations-desk/scene.js`.
Rebuild with `npm run build:desk` from `play-src/`.
The bundled `scene.js` contains library and rendering code only, with no runtime data.
`model.js` defines exact containment and documented-reference relationships.
The page remains usable through HTML lists if WebGL is unavailable or the context is lost.

Scene limits: 40 fleet destinations, 15 immediate folder entries per page,
4 workflow definitions and 12 runs in the overview, or 6 jobs and 5 steps per
job for a selected run. Retrieved workflow details remain available in the
inspector and list. Rendering is capped at 30 frames per second, pauses in
hidden tabs, and stops ambient animation for reduced motion or Pause motion.
