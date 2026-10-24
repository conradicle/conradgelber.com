// Matching against ideologies, thinkers and countries on the source's four
// reference dimensions: econ (Equality %), govt (Security %), dipl (Globalist
// %) and scty (Progressive %).
//
// The source compares an ideology's dipl to the Protectionist %, but its
// ideology values put globalist ideologies high (Trotskyism 100, Fascism 10),
// so that comparison runs backwards. Here dipl is compared to the Globalist %.
import { AXIS } from './axes.js';

export const DIMS = ['econ', 'govt', 'dipl', 'scty'];
export const DIM_LABELS = {
  econ: 'Economic equality',
  govt: 'Security',
  dipl: 'Globalist trade',
  scty: 'Social progress',
};
export const MAX_DISTANCE = 200; // sqrt(4 x 100^2)

export function refPoint(scores) {
  return {
    econ: scores[AXIS.economy],
    govt: scores[AXIS.power],
    dipl: 100 - scores[AXIS.trade],
    scty: scores[AXIS.culture],
  };
}

export function distance(a, b) {
  return Math.sqrt(DIMS.reduce((s, d) => s + (a[d] - b[d]) ** 2, 0));
}

export function similarity(a, b) {
  return 100 * (1 - distance(a, b) / MAX_DISTANCE);
}

// Items carry their coordinates in `stats`. Closest first.
export function rank(items, point, n = items.length) {
  return items
    .map((item) => ({ item, distance: distance(point, item.stats), similarity: similarity(point, item.stats) }))
    .sort((x, y) => x.distance - y.distance || x.item.name.localeCompare(y.item.name))
    .slice(0, n);
}
