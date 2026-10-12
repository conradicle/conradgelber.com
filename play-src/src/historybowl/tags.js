// Era and region tags for questions that arrive without them (QB Reader has
// categories and subcategories only). Both are estimates from the question
// text, and the stats screen labels them that way.

export const ERAS = [
  { key: 'ancient', label: 'Ancient (to 500)', to: 500 },
  { key: 'medieval', label: 'Medieval (500 to 1450)', to: 1450 },
  { key: 'early-modern', label: 'Early modern (1450 to 1750)', to: 1750 },
  { key: 'revolutions', label: '1750 to 1900', to: 1900 },
  { key: 'world-wars', label: '1900 to 1945', to: 1945 },
  { key: 'cold-war', label: '1945 to 2000', to: 2000 },
  { key: 'recent', label: 'Since 2000', to: Infinity },
];
export const ERA_LABEL = Object.fromEntries([...ERAS.map((e) => [e.key, e.label]), ['unknown', 'Era unclear']]);

export function eraOfYear(y) {
  for (const e of ERAS) if (y < e.to) return e.key;
  return 'recent';
}

const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20 };

/** Every year the text mentions: 4-digit years, "the 1840s", centuries, and BC dates (as negatives). */
export function yearsIn(text) {
  const t = String(text || '');
  const out = [];
  for (const m of t.matchAll(/\b(\d{1,4})\s*(?:BCE|BC|B\.C\.E?\.?)(?![a-z])/g)) out.push(-Number(m[1]));
  for (const m of t.matchAll(/\b(1\d{3}|20[0-2]\d)s?\b(?!\s*(?:km|kilometers|miles|meters|feet|people|men|soldiers|troops|BC|BCE|B\.C))/g)) out.push(Number(m[1]));
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)[\s-]+century(\s*(?:BCE|BC|B\.C))?/gi)) {
    const c = Number(m[1]);
    out.push(m[2] ? -(c * 100 - 50) : c * 100 - 50);
  }
  for (const m of t.matchAll(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)[\s-]+century(\s*(?:BCE|BC|B\.C))?/gi)) {
    const c = ORD[m[1].toLowerCase()];
    out.push(m[2] ? -(c * 100 - 50) : c * 100 - 50);
  }
  if (/\btwenty-first century\b/i.test(t)) out.push(2010);
  return out;
}

/** The estimated era of a question: the median year it mentions. */
export function estimateEra(text, subcategory) {
  const ys = yearsIn(text).sort((a, b) => a - b);
  if (ys.length) return eraOfYear(ys[Math.floor((ys.length - 1) / 2)]);
  if (subcategory === 'Ancient History') return 'ancient';
  return 'unknown';
}

// Keyword lists for regions. A question gets the region with the most hits;
// ties and no hits fall back on its subcategory.
const REGION_WORDS = {
  'United States': ['united states', 'american', 'congress', 'senate', 'supreme court', 'president', 'confedera', 'union army', 'new york', 'virginia', 'massachusetts', 'pennsylvania', 'texas', 'california', 'chicago', 'washington', 'lincoln', 'jefferson', 'roosevelt', 'civil war', 'new deal', 'reconstruction', 'u.s.'],
  Europe: ['france', 'french', 'england', 'english', 'britain', 'british', 'german', 'prussia', 'austria', 'habsburg', 'spain', 'spanish', 'portug', 'ital', 'rome', 'venice', 'florence', 'russia', 'tsar', 'czar', 'poland', 'polish', 'hungar', 'sweden', 'swedish', 'denmark', 'danish', 'norw', 'dutch', 'netherlands', 'belgi', 'greece', 'greek', 'athens', 'sparta', 'byzantin', 'balkan', 'serbia', 'pope', 'papal', 'holy roman', 'napoleon', 'parliament', 'ireland', 'irish', 'scotland', 'scottish', 'ukrain', 'soviet'],
  'Latin America': ['mexico', 'mexican', 'aztec', 'maya', 'inca', 'peru', 'brazil', 'argentin', 'chile', 'colombia', 'venezuela', 'bolivia', 'cuba', 'haiti', 'caribbean', 'latin america', 'conquistador', 'bolivar', 'paraguay', 'uruguay', 'ecuador', 'guatemala', 'nicaragua', 'panama', 'el salvador', 'honduras', 'dominican', 'puerto rico', 'jamaica'],
  Africa: ['africa', 'egypt', 'ethiopia', 'nigeria', 'ghana', 'mali', 'songhai', 'zulu', 'kenya', 'congo', 'sudan', 'morocco', 'algeria', 'tunisia', 'carthage', 'apartheid', 'mandela', 'rwanda', 'zimbabwe', 'rhodesia', 'boer', 'senegal', 'angola', 'mozambique', 'somali', 'libya', 'tanzania', 'uganda', 'swahili', 'great zimbabwe', 'kush', 'axum', 'aksum', 'benin', 'dahomey', 'ashanti'],
  'Middle East': ['ottoman', 'persia', 'iran', 'iraq', 'baghdad', 'syria', 'damascus', 'israel', 'palestin', 'jerusalem', 'arab', 'caliph', 'umayyad', 'abbasid', 'saudi', 'turkey', 'turkish', 'istanbul', 'constantinople', 'mesopotamia', 'babylon', 'assyria', 'sumer', 'lebanon', 'jordan', 'yemen', 'safavid', 'achaemenid', 'sasanian', 'muhammad', 'kurd', 'gulf'],
  'South Asia': ['india', 'indian national', 'mughal', 'delhi', 'bengal', 'pakistan', 'bangladesh', 'sri lanka', 'ceylon', 'nepal', 'gandhi', 'nehru', 'maurya', 'gupta', 'ashoka', 'raj', 'sikh', 'punjab', 'afghan'],
  'East Asia': ['china', 'chinese', 'dynasty', 'qing', 'ming', 'tang', 'song dynasty', 'han dynasty', 'mongol', 'japan', 'japanese', 'shogun', 'samurai', 'meiji', 'tokugawa', 'korea', 'taiwan', 'beijing', 'tokyo', 'mao', 'kuomintang', 'emperor of china', 'hong kong', 'tibet', 'manchu'],
  'Southeast Asia and Oceania': ['vietnam', 'cambodia', 'khmer', 'laos', 'thailand', 'siam', 'burma', 'myanmar', 'indonesia', 'java', 'philippine', 'malaya', 'malaysia', 'singapore', 'australia', 'new zealand', 'maori', 'pacific island', 'hawaii', 'polynesia'],
};
export const REGIONS = Object.keys(REGION_WORDS);
// Each keyword must start a word, so "mali" matches Malian and skips Somalia.
const REGION_RES = Object.entries(REGION_WORDS).map(([region, words]) => [region, words.map((w) => new RegExp('\\b' + w.replace(/\./g, '\\.')))]);

const SUB_REGION = {
  'American History': 'United States',
  'European History': 'Europe',
};

export function estimateRegion(text, category, subcategory) {
  if (category === 'Geography') return 'Geography';
  // The question writer's own tag beats a keyword count.
  if (SUB_REGION[subcategory]) return SUB_REGION[subcategory];
  const t = String(text || '').toLowerCase();
  let best = null;
  let bestHits = 0;
  let tie = false;
  for (const [region, res] of REGION_RES) {
    let hits = 0;
    for (const re of res) if (re.test(t)) hits++;
    // European powers turn up in most colonial questions, so their words count half.
    if (region === 'Europe') hits /= 2;
    if (hits > bestHits) {
      best = region;
      bestHits = hits;
      tie = false;
    } else if (hits === bestHits && hits > 0) tie = true;
  }
  if (best && !tie) return best;
  return SUB_REGION[subcategory] || (subcategory === 'Ancient History' ? 'Ancient world' : 'Region unclear');
}
