// Map labels are stored in capitals; prose and screen readers get them in
// title case ("EMPIRE OF BRAZIL" to "Empire of Brazil").
const SMALL = new Set(['and', 'of', 'the', 'de', 'du', 'la']);
const KEEP = new Map([['u.s.s.r.', 'U.S.S.R.'], ['u.s.', 'U.S.'], ['uae', 'UAE'], ['un', 'UN']]);

export function titleCase(label) {
  return label.toLowerCase().split(' ').map((word, i) => {
    const bare = word.replace(/[()]/g, '');
    if (KEEP.has(bare)) return word.replace(bare, KEEP.get(bare));
    if (i > 0 && SMALL.has(word)) return word;
    if (/^d'./.test(word)) return "d'" + word.charAt(2).toUpperCase() + word.slice(3);
    return word.replace(/(^|[-(.'])([a-zà-ÿ])/g, (m, p, c) => p + c.toUpperCase());
  }).join(' ');
}
