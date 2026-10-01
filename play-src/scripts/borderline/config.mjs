// Shared settings for the Borderline data pipeline. Every number that
// decides what counts as a fair puzzle lives here so it can be tuned in
// one place; the reasons for each value are next to it.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PLAY_SRC = path.resolve(here, '../..');
export const SITE = path.resolve(PLAY_SRC, '..');
export const RAW_DIR = path.join(PLAY_SRC, 'data/borderline/raw');
export const BUILD_DIR = path.join(PLAY_SRC, 'data/borderline/build');
export const HAND_DIR = path.join(PLAY_SRC, 'data/borderline');
export const OUT_DIR = path.join(SITE, 'borderline/data');

// Pinned inputs. fetch-sources.mjs refuses a file whose hash differs, so
// an upstream edit never changes the bank silently.
export const SOURCES = {
  // The cshapes R package on CRAN ships the same 710 CShapes 2.0 records
  // as the ETH download, plus the status and owner columns the ETH files
  // leave out. Owner changes ("Nigeria (Br.)" to "Nigeria") are tells.
  cshapes: {
    file: 'cshapes_2.0.tar.gz',
    urls: [
      'https://cran.r-project.org/src/contrib/cshapes_2.0.tar.gz',
      'https://cran.r-project.org/src/contrib/Archive/cshapes/cshapes_2.0.tar.gz',
    ],
    sha256: '7a269742351b37e6ea6da97fadaa1374e3c2f804a784492afd48dc0d79417830',
  },
  cshapesEurope: {
    file: 'CShapes-Europe.geojson',
    urls: ['https://icr.ethz.ch/data/cshapes/CShapes-Europe.geojson'],
    sha256: '9831764d2ad17e37bc009031829265621534de097f7b3e8d6928d1a828436279',
  },
};

export const HB_COMMIT = 'da7a4b735ecef70aebdc9c73e409d8a2500d50f3';
export const HB_HASHES = {
  1700: 'eb73d6b00e98205fb2082de050c35e4d698224b17849628d82584610186b88a4',
  1715: 'fdf5097dd21c30c9d7bfb1d5c2c2a11a5a39c397e6910116d7173580619f5b5a',
  1783: '7cfa92418a8628dffa41e386394b86fb6f93310e449d8261990f6903160c1060',
  1800: '51fcb6b1f1c361956a3fc24a9c646844ff88754842aa113780428fb4abcd5f2c',
  1815: 'fb654f734583f550904cfa45f361e395c1a488c4960050da2632cb2ac7d1cd1e',
  1878: 'e792520cd24cfb77b117d41533a59b0a5b82fc53a291fff1549ddc73e7f9a8b2',
  1880: '4751e30d881d60d31479f5d016ff4d9c1df47e9bb18efaa3a5086601f68f76dc',
};
for (const [year, sha256] of Object.entries(HB_HASHES)) {
  SOURCES['hb' + year] = {
    file: 'hb_world_' + year + '.geojson',
    urls: ['https://raw.githubusercontent.com/aourednik/historical-basemaps/' +
      HB_COMMIT + '/geojson/world_' + year + '.geojson'],
    sha256,
  };
}

// Visvalingam interval in metres for every layer. The tightest Hard crop
// is about 650 km across 360 px, 1.8 km a pixel, so 700 m stays under half
// a pixel.
export const SIMPLIFY_M = 700;

// Dataset edges. CShapes starts every unit on 1886-01-01 and stops every
// unit on 2019-12-31; neither date is a real change.
export const CS_FIRST = '1886-01-01';
export const CS_LAST = '2019-12-31';
export const EU_FIRST_YEAR = 1816;
// Units still standing at CS_LAST are carried to the present after the
// post-2019 check recorded in names.json ("post2019").
export const PRESENT = 'present';
export const CURRENT_YEAR = 2026;

// The map frame (src/borderline/projection.js) is 360 x 400 SVG units. On
// a phone it is drawn about 340 to 390 CSS pixels wide, so one unit is
// close to one CSS pixel at the size most players see. All pixel
// thresholds below are in these units.
export { FRAME_W, FRAME_H } from '../../src/borderline/projection.js';

// A change counts as visible only if one connected patch of changed
// pixels covers at least VISIBLE_MIN_AREA after an opening with a 3 x 3
// square (which erases anything under 3 px thick). 120 px is about an
// 11 x 11 px patch on a phone, a little larger than one capital letter of
// the smallest label. Smaller patches are not something a player could
// recognize without the other map beside it, and the opening removes long
// thin slivers where two datasets traced the same border slightly apart.
export const VISIBLE_MIN_AREA = 120;

// Labels: smallest and largest font sizes, in frame units.
export const LABEL_MIN = 10;
export const LABEL_MAX = { N: 15, H: 19 };
// Average small-caps advance of Spectral as a fraction of the font size.
export const LABEL_ADVANCE = 0.66;

// Crop rules from the brief.
export const MIN_LABELED = 3;
export const MAX_WINDOW_YEARS = 30;
export const MAX_OCEAN_SHARE = 0.5; // reject when more than half is sea
export const MAX_BLANK_SHARE = 0.2; // land drawn with no unit (unclaimed or uncovered)

// Crop widths in km for each difficulty, and how many labeled units each
// one wants. Hard is a tight crop on exactly three labeled countries.
export const DIFF = {
  N: { widthKm: [2200, 4600], labeled: [5, 12] },
  H: { widthKm: [650, 1900], labeled: [3, 3] },
};
