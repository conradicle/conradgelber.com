// Copies countries-50m.json from the world-atlas package (Natural Earth,
// public domain) to ../flight-path/countries-50m.json, which /flight-path/
// fetches to draw the globe. It holds both the countries and the merged
// land outline.
import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = require.resolve('world-atlas/countries-50m.json');
copyFileSync(src, new URL('../../flight-path/countries-50m.json', import.meta.url));
console.log('copied ' + src + ' -> flight-path/countries-50m.json');
