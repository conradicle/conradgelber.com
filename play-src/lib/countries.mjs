// The country model for /flight-path/, shared by scripts/build-routes.mjs
// and the game itself.
//
// Natural Earth's admin-0 features (world-atlas countries-10m and -50m) are
// mapped to the names the game shows and accepts. A few features are folded
// into another country, a few are ignored, and routes over Siachen Glacier
// are left out of the game.

// Natural Earth name -> game name, where they differ. Every other feature
// keeps its Natural Earth name.
export const RENAME = {
  'Antigua and Barb.': 'Antigua and Barbuda',
  'Bosnia and Herz.': 'Bosnia and Herzegovina',
  'Br. Indian Ocean Ter.': 'British Indian Ocean Territory',
  'British Virgin Is.': 'British Virgin Islands',
  'Cayman Is.': 'Cayman Islands',
  'Central African Rep.': 'Central African Republic',
  'Congo': 'Republic of the Congo',
  'Cook Is.': 'Cook Islands',
  'Dem. Rep. Congo': 'Democratic Republic of the Congo',
  'Dominican Rep.': 'Dominican Republic',
  'Eq. Guinea': 'Equatorial Guinea',
  'eSwatini': 'Eswatini',
  'Faeroe Is.': 'Faroe Islands',
  'Falkland Is.': 'Falkland Islands',
  'Fr. Polynesia': 'French Polynesia',
  'Fr. S. Antarctic Lands': 'French Southern and Antarctic Lands',
  'Heard I. and McDonald Is.': 'Heard Island and McDonald Islands',
  'Indian Ocean Ter.': 'Christmas Island and Cocos Islands',
  'Macedonia': 'North Macedonia',
  'Marshall Is.': 'Marshall Islands',
  'N. Mariana Is.': 'Northern Mariana Islands',
  'Pitcairn Is.': 'Pitcairn Islands',
  'S. Geo. and the Is.': 'South Georgia and the South Sandwich Islands',
  'S. Sudan': 'South Sudan',
  'Solomon Is.': 'Solomon Islands',
  'St-Barthélemy': 'Saint Barthélemy',
  'St-Martin': 'Saint Martin',
  'St. Kitts and Nevis': 'Saint Kitts and Nevis',
  'St. Pierre and Miquelon': 'Saint Pierre and Miquelon',
  'St. Vin. and Gren.': 'Saint Vincent and the Grenadines',
  'São Tomé and Principe': 'São Tomé and Príncipe',
  'Turks and Caicos Is.': 'Turks and Caicos Islands',
  'U.S. Minor Outlying Is.': 'US Minor Outlying Islands',
  'U.S. Virgin Is.': 'US Virgin Islands',
  'United States of America': 'United States',
  'W. Sahara': 'Western Sahara',
  'Wallis and Futuna Is.': 'Wallis and Futuna',
  'Åland': 'Åland Islands',
};

// Features that count as part of another country.
export const FOLD = {
  'Akrotiri': 'Cyprus',
  'Dhekelia': 'Cyprus',
  'Cyprus U.N. Buffer Zone': 'Cyprus',
  'N. Cyprus': 'Cyprus',
  'Baikonur': 'Kazakhstan',
  'Somaliland': 'Somalia',
  'USNB Guantanamo Bay': 'Cuba',
};

// Features that never count: uninhabited reefs and banks, and Antarctica.
export const IGNORE = new Set([
  'Antarctica',
  'Ashmore and Cartier Is.',
  'Bajo Nuevo Bank',
  'Clipperton I.',
  'Coral Sea Is.',
  'Scarborough Reef',
  'Serranilla Bank',
  'Spratly Is.',
]);

// Routes over these features are left out of the game.
export const EXCLUDE_ROUTES = new Set(['Siachen Glacier']);

// Where two Natural Earth features overlap, the stretch over both counts
// for the first one only. Morocco's polygon includes Western Sahara.
export const CARVE = [['Western Sahara', 'Morocco']];

// Game name for a Natural Earth feature name, or null if it never counts.
export function gameName(neName) {
  if (IGNORE.has(neName) || EXCLUDE_ROUTES.has(neName)) return null;
  if (FOLD[neName]) return FOLD[neName];
  return RENAME[neName] || neName;
}

// Dependent territories and the country they belong to. Guessing the
// sovereign counts for the territory when only the territory is on the
// route.
export const SOVEREIGN = {
  'American Samoa': 'United States',
  'Anguilla': 'United Kingdom',
  'Aruba': 'Netherlands',
  'Bermuda': 'United Kingdom',
  'British Indian Ocean Territory': 'United Kingdom',
  'British Virgin Islands': 'United Kingdom',
  'Cayman Islands': 'United Kingdom',
  'Christmas Island and Cocos Islands': 'Australia',
  'Cook Islands': 'New Zealand',
  'Curaçao': 'Netherlands',
  'Falkland Islands': 'United Kingdom',
  'Faroe Islands': 'Denmark',
  'French Polynesia': 'France',
  'French Southern and Antarctic Lands': 'France',
  'Gibraltar': 'United Kingdom',
  'Greenland': 'Denmark',
  'Guam': 'United States',
  'Guernsey': 'United Kingdom',
  'Heard Island and McDonald Islands': 'Australia',
  'Hong Kong': 'China',
  'Isle of Man': 'United Kingdom',
  'Jersey': 'United Kingdom',
  'Macao': 'China',
  'Montserrat': 'United Kingdom',
  'New Caledonia': 'France',
  'Niue': 'New Zealand',
  'Norfolk Island': 'Australia',
  'Northern Mariana Islands': 'United States',
  'Pitcairn Islands': 'United Kingdom',
  'Puerto Rico': 'United States',
  'Saint Barthélemy': 'France',
  'Saint Helena': 'United Kingdom',
  'Saint Martin': 'France',
  'Saint Pierre and Miquelon': 'France',
  'Sint Maarten': 'Netherlands',
  'South Georgia and the South Sandwich Islands': 'United Kingdom',
  'Turks and Caicos Islands': 'United Kingdom',
  'US Minor Outlying Islands': 'United States',
  'US Virgin Islands': 'United States',
  'Wallis and Futuna': 'France',
  'Åland Islands': 'Finland',
};

// Places the game lists on their own that another country claims. If the
// player names the claimant on a route that crosses the place but not the
// claimant, the guess is neither right nor wrong; the results say why.
// Crimea is not a separate feature: Natural Earth draws it inside Russia,
// so the build script flags routes that cross it.
export const DISPUTED = {
  'Kosovo': 'Serbia',
  'Taiwan': 'China',
  'Palestine': 'Israel',
  'Western Sahara': 'Morocco',
  'Crimea': 'Ukraine',
};

export function disputedNote(place) {
  return place === 'Crimea'
    ? 'This game\'s map data counts Crimea as part of Russia.'
    : `${place} is listed separately in this game.`;
}

// Other names players use. Each alias can point at more than one country
// ("Congo", "Korea"); a guess counts for whichever of them is on the route.
export const ALIASES = {
  'United States': ['USA', 'US', 'U.S.', 'U.S.A.', 'America', 'United States of America', 'The States'],
  'United Kingdom': ['UK', 'U.K.', 'Britain', 'Great Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland'],
  "Côte d'Ivoire": ['Ivory Coast', 'Cote dIvoire'],
  'Czechia': ['Czech Republic', 'Czech'],
  'Myanmar': ['Burma'],
  'Democratic Republic of the Congo': ['DRC', 'DR Congo', 'DROC', 'Congo-Kinshasa', 'Zaire', 'Dem. Rep. Congo', 'Congo'],
  'Republic of the Congo': ['Congo-Brazzaville', 'Congo Republic', 'Congo'],
  'North Macedonia': ['Macedonia', 'FYROM'],
  'Eswatini': ['Swaziland'],
  'Timor-Leste': ['East Timor'],
  'Cabo Verde': ['Cape Verde'],
  'Turkey': ['Türkiye', 'Turkiye'],
  'Netherlands': ['Holland', 'The Netherlands'],
  'Russia': ['Russian Federation'],
  'South Korea': ['Korea', 'Republic of Korea', 'ROK'],
  'North Korea': ['Korea', 'DPRK', "Democratic People's Republic of Korea"],
  'China': ['PRC', "People's Republic of China", 'Mainland China'],
  'Taiwan': ['Republic of China', 'ROC', 'Chinese Taipei', 'Formosa'],
  'Iran': ['Persia', 'Islamic Republic of Iran'],
  'Syria': ['Syrian Arab Republic'],
  'Laos': ['Lao PDR', 'Lao'],
  'Vietnam': ['Viet Nam'],
  'Moldova': ['Republic of Moldova'],
  'Bosnia and Herzegovina': ['Bosnia', 'BiH', 'Bosnia-Herzegovina'],
  'United Arab Emirates': ['UAE', 'Emirates'],
  'Saudi Arabia': ['KSA', 'Saudi'],
  'Palestine': ['State of Palestine', 'Palestinian Territories', 'West Bank', 'Gaza'],
  'Western Sahara': ['Sahrawi Republic', 'SADR'],
  'Vatican': ['Vatican City', 'Holy See'],
  'Micronesia': ['Federated States of Micronesia', 'FSM'],
  'Gambia': ['The Gambia'],
  'Bahamas': ['The Bahamas'],
  'Central African Republic': ['CAR'],
  'Papua New Guinea': ['PNG'],
  'New Zealand': ['NZ', 'Aotearoa'],
  'Sri Lanka': ['Ceylon'],
  'Kyrgyzstan': ['Kyrgyz Republic', 'Kirghizia'],
  'Trinidad and Tobago': ['Trinidad'],
  'Antigua and Barbuda': ['Antigua'],
  'Saint Kitts and Nevis': ['St Kitts', 'Saint Kitts'],
  'Saint Vincent and the Grenadines': ['St Vincent', 'Saint Vincent'],
  'São Tomé and Príncipe': ['Sao Tome', 'Sao Tome and Principe'],
  'Falkland Islands': ['Falklands', 'Malvinas'],
  'Faroe Islands': ['Faroes', 'Faeroe Islands'],
  'Hong Kong': ['HK'],
  'Macao': ['Macau'],
  'Ireland': ['Republic of Ireland', 'Eire'],
  'Brunei': ['Brunei Darussalam'],
  'Solomon Islands': ['Solomons'],
  'Guinea': ['Guinea-Conakry'],
  'Somalia': ['Somaliland'],
  'Cyprus': ['Northern Cyprus'],
  'US Virgin Islands': ['USVI', 'United States Virgin Islands'],
  'British Virgin Islands': ['BVI'],
  'Christmas Island and Cocos Islands': ['Christmas Island', 'Cocos Islands', 'Cocos (Keeling) Islands', 'Australian Indian Ocean Territories'],
  'South Georgia and the South Sandwich Islands': ['South Georgia'],
  'Heard Island and McDonald Islands': ['Heard Island'],
  'French Southern and Antarctic Lands': ['French Southern Lands', 'Kerguelen'],
  'Pitcairn Islands': ['Pitcairn'],
  'Saint Helena': ['St Helena', 'Saint Helena, Ascension and Tristan da Cunha'],
  'Åland Islands': ['Aland', 'Åland'],
  'Equatorial Guinea': ['Eq. Guinea'],
  'South Sudan': ['S. Sudan'],
  'Dominican Republic': ['Dominican Rep.'],
  'Belarus': ['Byelorussia'],
  'Libya': ['Libyan Arab Jamahiriya'],
  'Tanzania': ['United Republic of Tanzania'],
  'Bolivia': ['Plurinational State of Bolivia'],
  'Venezuela': ['Bolivarian Republic of Venezuela'],
};

// Folds case, accents, punctuation and "the", and spells "St" as "Saint",
// so "cote d'ivoire", "Côte d'Ivoire" and "COTE DIVOIRE" all match.
export function normalize(text) {
  return text
    .replace(/[øØ]/g, 'o').replace(/[æÆ]/g, 'ae').replace(/[łŁ]/g, 'l')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    // Phone keyboards often type a curly apostrophe (U+2019).
    .replace(/['\u2019.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bst\b/g, 'saint')
    .replace(/^the /, '')
    .trim();
}

// Normalized name or alias -> list of game names it can mean, direct names
// first. `names` is every country the game knows.
export function buildLookup(names) {
  const map = new Map();
  const add = (key, name) => {
    const k = normalize(key);
    if (!k) return;
    const list = map.get(k) || [];
    if (!list.includes(name)) list.push(name);
    map.set(k, list);
  };
  for (const name of names) add(name, name);
  for (const [name, aliases] of Object.entries(ALIASES)) {
    if (!names.includes(name)) continue;
    for (const a of aliases) add(a, name);
  }
  return map;
}
