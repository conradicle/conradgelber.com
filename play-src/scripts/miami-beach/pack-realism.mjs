import fs from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const out=fileURLToPath(new URL('../../../miami-beach/data/realism/',import.meta.url));
const manifest=JSON.parse(await fs.readFile(`${out}manifest.json`,'utf8'));
for(const region of manifest.regions){const bytes=await fs.readFile(out+region.asset);const compressed=gzipSync(bytes,{level:9});region.compressedAsset=region.asset+'.gz';region.compressedBytes=compressed.length;region.sha256=createHash('sha256').update(bytes).digest('hex');await fs.writeFile(out+region.compressedAsset,compressed);console.log(`${region.id}: ${(bytes.length/1e6).toFixed(2)} MB → ${(compressed.length/1e6).toFixed(2)} MB`);}
await fs.writeFile(`${out}manifest.json`,JSON.stringify(manifest,null,2));
