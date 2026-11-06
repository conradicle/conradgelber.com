import {build} from 'esbuild';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const source=fileURLToPath(new URL('../../src/miami-beach/main.js',import.meta.url));
const output=fileURLToPath(new URL('../../../miami-beach/viewer.js',import.meta.url));
await build({entryPoints:[source],bundle:true,minify:true,format:'iife',target:'es2020',outfile:output});
// Three.js embeds multiline GLSL strings. Normalize their irrelevant whitespace
// so the generated artifact also passes the repository's whitespace check.
const text=(await fs.readFile(output,'utf8')).replace(/[ \t]+$/gm,'').replace(/^[ \t]+/gm,indent=>indent.replaceAll('\t','  '));
new vm.Script(text);
await fs.writeFile(output,text);
console.log('Built Miami Beach viewer');
