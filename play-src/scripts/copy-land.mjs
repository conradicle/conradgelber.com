// Copies land-50m.json from the world-atlas package (Natural Earth, public
// domain) to ../play/land.json, which the game fetches at runtime.
import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = require.resolve('world-atlas/land-50m.json');
copyFileSync(src, new URL('../../play/land.json', import.meta.url));
console.log('copied ' + src + ' -> play/land.json');
