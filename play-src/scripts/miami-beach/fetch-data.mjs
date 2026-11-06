// Maintenance only. The published viewer never calls GIS providers.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../..', import.meta.url));
const raw = path.join(root, 'play-src/data/miami-beach/raw');
await fs.mkdir(raw, { recursive: true });
const city = 'https://gis.miamibeachfl.gov/public/rest/services/gc';
export const sources = {
  boundary: `${city}/gc_Cadastral/MapServer/0`,
  buildings: 'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/BuildingFootprint2D_gdb/FeatureServer/0',
  floors: `${city}/gc_Buildings/MapServer/0`,
  roads: `${city}/gc_Cadastral/MapServer/2`,
  neighborhoods: `${city}/gc_Cadastral/MapServer/12`,
  trees: `${city}/gc_TreeInventory/FeatureServer/0`,
  water: 'https://gisweb.miamidade.gov/arcgis/rest/services/EnerGov/MD_LandMgtViewer/MapServer/89',
  parks: 'https://gisweb.miamidade.gov/arcgis/rest/services/CAD911/MapServer/27',
  landuse: 'https://gisweb.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/17',
  zoning: `${city}/gc_Zoning/MapServer/0`,
};
async function get(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const [base,query] = url.split('?');
      const options = url.includes('/query?') ? {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:query} : {};
      const r = await fetch(url.includes('/query?') ? base : url, { ...options, signal: AbortSignal.timeout(90000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${base}`);
      const j = await r.json();
      if (j.error) throw new Error(JSON.stringify(j.error));
      return j;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise(resolve => setTimeout(resolve, 1500 * 2 ** attempt));
    }
  }
}
// County layers are selected by envelope then exactly clipped locally.
const envelope = { geometry: JSON.stringify({ xmin:-80.205, ymin:25.755, xmax:-80.110, ymax:25.885, spatialReference:{wkid:4326} }), geometryType:'esriGeometryEnvelope', inSR:4326, spatialRel:'esriSpatialRelIntersects' };
for (const [name, url] of Object.entries(sources)) {
  const dest = path.join(raw, `${name}.json`);
  if (!process.argv.includes('--refresh')) {
    try { await fs.access(dest); console.log(`${name}: cached`); continue; } catch {}
  }
  const metadata = await get(`${url}?f=json`);
  const selection = ['buildings','water','parks','landuse'].includes(name) ? envelope : {};
  const where=name==='landuse'?"LU IN (510,516,517,518,519,527,530,550,560,561,562,580,540)":'1=1';
  const ids = await get(`${url}/query?${new URLSearchParams({where, ...selection, returnIdsOnly:'true',f:'json'})}`);
  if (!Array.isArray(ids.objectIds)) throw new Error(`${name}: missing IDs`);
  const objectIds = [...ids.objectIds].sort((a,b)=>a-b);
  const features = [];
  // IDs avoid missing records when pagination changes or a server truncates results.
  for (let i = 0; i < objectIds.length; i += 250) {
    const query = new URLSearchParams({objectIds:objectIds.slice(i,i+250).join(','),outFields:'*',outSR:'4326',returnGeometry:'true',f:'geojson'});
    const page = await get(`${url}/query?${query}`);
    if (!Array.isArray(page.features) || page.features.length !== Math.min(250, objectIds.length-i)) throw new Error(`${name}: incomplete batch ${i}`);
    features.push(...page.features);
    if (i % 2000 === 0) console.log(`${name}: ${features.length}/${objectIds.length}`);
  }
  await fs.writeFile(dest, JSON.stringify({type:'FeatureCollection',features}));
  await fs.writeFile(path.join(raw, `${name}.metadata.json`), JSON.stringify({url,retrievedAt:new Date().toISOString(),count:features.length,metadata},null,2));
  console.log(`${name}: saved ${features.length}`);
}
