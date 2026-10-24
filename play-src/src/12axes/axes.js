// The twelve axes, indexed as in the source question file
// (data/12axes/questions.json `axis`). A statement with dir +1 leans to
// `left`; every score is the percentage for `left`, and `right` is 100 minus it.
export const AXES = [
  { key: 'structure', name: 'Structure', left: 'Federal', right: 'Unitary' },
  { key: 'representation', name: 'Representation', left: 'Democratic', right: 'Autocratic' },
  { key: 'intervention', name: 'Intervention', left: 'Internationalist', right: 'Nationalist' },
  { key: 'diplomacy', name: 'Diplomacy', left: 'Militarist', right: 'Pacifist' },
  { key: 'power', name: 'Power', left: 'Security', right: 'Freedom' },
  { key: 'economy', name: 'Economy', left: 'Equality', right: 'Private property' },
  { key: 'religion', name: 'Religion', left: 'Secular', right: 'Religious' },
  { key: 'culture', name: 'Culture', left: 'Progressive', right: 'Traditional' },
  { key: 'immigration', name: 'Immigration', left: 'Assimilationist', right: 'Multiculturalist' },
  { key: 'control', name: 'Control', left: 'Planned', right: 'Laissez-faire' },
  { key: 'trade', name: 'Trade', left: 'Protectionist', right: 'Globalist' },
  { key: 'technology', name: 'Technology', left: 'Accelerationist', right: 'Bioconservative' },
];

// The order the source's results page shows them in.
export const DISPLAY_ORDER = [0, 1, 4, 2, 3, 8, 5, 9, 10, 6, 7, 11];

export const AXIS = Object.fromEntries(AXES.map((a, i) => [a.key, i]));
