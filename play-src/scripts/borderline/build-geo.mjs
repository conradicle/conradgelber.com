// Turns the raw sources into one simplified TopoJSON (build/geo.json) with
// three layers that share arcs, so a border common to two records or two
// datasets is simplified once and lands on the same points everywhere:
//
//   cs    CShapes 2.0 records, 1886 to 2019
//   eu    CShapes-Europe records, 1816 to 1885 (cut at the 1886 seam)
//   land  the union of every CShapes record: the one coastline all eras use
//
// CShapes-Europe is clipped to that land, so its coarser coast never shows.
//
//   node scripts/borderline/build-geo.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import mapshaper from 'mapshaper';
import * as topojson from 'topojson-client';
import { BUILD_DIR, RAW_DIR, CS_FIRST, EU_FIRST_YEAR, SIMPLIFY_M } from './config.mjs';


mkdirSync(BUILD_DIR, { recursive: true });
const tmp = (f) => path.join(BUILD_DIR, f);

// CShapes 2.0 from the R package.
const topo = JSON.parse(readFileSync(path.join(RAW_DIR, 'cshapes_2_gw.topojson'), 'utf8'));
const cs = topojson.feature(topo, topo.objects.cshapes_2_gw);
for (const f of cs.features) {
  const p = f.properties;
  f.properties = {
    rid: 'c' + p.fid, unit: 'g' + p.gwcode, start: p.start, end: p.end,
    status: p.status, owner: String(p.owner), name: p.country_name,
  };
}
writeFileSync(tmp('cs-in.json'), JSON.stringify(cs));

// CShapes-Europe, only the years before CShapes 2.0 begins. Its records
// are the borders as of 1 January of each year, so a record runs from
// 1 January of From to 31 December of To here; the real dates of the
// changes that become tells come from eu-dates.json.
const eu = JSON.parse(readFileSync(path.join(RAW_DIR, 'CShapes-Europe.geojson'), 'utf8'));
const seamYear = Number(CS_FIRST.slice(0, 4));
eu.features = eu.features
  .filter((f) => f.properties.From < seamYear && f.properties.To >= EU_FIRST_YEAR)
  .map((f, i) => {
    const p = f.properties;
    const from = Math.max(p.From, EU_FIRST_YEAR);
    const to = Math.min(p.To, seamYear - 1);
    return {
      type: 'Feature', geometry: f.geometry,
      properties: {
        rid: 'e' + i, unit: 'g' + p.Id, start: from + '-01-01', end: to + '-12-31',
        status: p.Status, owner: String(p.Holder), name: p.Name,
      },
    };
  });
// Seam fix. CShapes-Europe folds Bosnia and Herzegovina into
// Austria-Hungary from the Treaty of Berlin on; CShapes 2.0 keeps them as
// two occupied territories until the 1908 annexation. So the seam does not
// show a change that never happened on 1 January 1886, the 1879-1885
// records follow CShapes 2.0: the two territories take their 1886 shapes
// and are cut out of Austria-Hungary.
const isAH = (f) => f.properties.unit === 'g300' && f.properties.start === '1879-01-01';
const ah = eu.features.filter(isAH);
if (ah.length !== 1) throw new Error('seam fix: expected one Austria-Hungary 1879 record, found ' + ah.length);
eu.features = eu.features.filter((f) => !isAH(f));
const bos = cs.features
  .filter((f) => ['g3461', 'g3462'].includes(f.properties.unit) && f.properties.start === CS_FIRST)
  .map((f) => ({
    type: 'Feature', geometry: f.geometry,
    properties: { ...f.properties, rid: 'e' + f.properties.unit, start: '1879-01-01', end: '1885-12-31' },
  }));
if (bos.length !== 2) throw new Error('seam fix: expected Bosnia and Herzegovina in 1886');
writeFileSync(tmp('eu-in.json'), JSON.stringify(eu));
writeFileSync(tmp('ah-in.json'), JSON.stringify({ type: 'FeatureCollection', features: ah }));
writeFileSync(tmp('bos-in.json'), JSON.stringify({ type: 'FeatureCollection', features: bos }));

const cmd = [
  '-i combine-files', tmp('cs-in.json'), tmp('eu-in.json'), tmp('ah-in.json'), tmp('bos-in.json'),
  '-rename-layers cs,eu,ah,bos',
  '-dissolve2 target=cs + name=land',
  '-erase bos target=ah',
  '-merge-layers target=eu,ah,bos force name=eu',
  '-clip target=eu land',
  '-simplify interval=' + SIMPLIFY_M + ' keep-shapes target=*',
  '-filter-slivers min-area=2km2 target=*',
  '-o', tmp('geo.json'), 'format=topojson target=* quantization=1e6',
].join(' ');
console.log('mapshaper ' + cmd);
await mapshaper.runCommands(cmd);
console.log('wrote ' + tmp('geo.json'));
