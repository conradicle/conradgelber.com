// Draws one Borderline map as SVG markup: the same old-atlas style for
// every year, so the style itself never hints at the date. Every colour and
// stroke is a presentation attribute (no style attributes, which the site
// CSP forbids), so the browser and render-puzzle.mjs draw the same picture.
import { geoPath, geoGraticule } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import { makeProjection, FRAME_W as W, FRAME_H as H } from './projection.js';

// Hand-tint fills and the deeper band painted inside each border.
export const TINTS = ['#ead2a4', '#c9d6a8', '#e8bcab', '#bfd0d8', '#dcc8de', '#efdea2'];
const BANDS = ['#c99f5f', '#91a862', '#c98068', '#7f9fb0', '#ad8db3', '#cfae4c'];
const SEA = '#dbe4df';
const WATERLINE = '#9db3b1';
const BLANK = '#f4ecd6';
const INK = '#4a3526';
const BORDER = '#6e5240';
const GRATICULE = '#a9b8b4';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const r1 = (x) => Math.round(x * 10) / 10;

/** Round path coordinates to 0.1 unit to keep the markup small. */
function trim(d) {
  return d ? d.replace(/-?\d+\.\d+/g, (n) => String(r1(Number(n)))) : '';
}

// Hand-inked wobble: every coast and border, on every map, is pushed up to
// about a unit either way by one fixed noise field, so CShapes and
// historical-basemaps lines read as the same engraver's hand.
export const WOBBLE = { frequency: 0.045, octaves: 2, seed: 11, scale: 2.4 };

/**
 * @param {object} puzzle  a bank puzzle (p, draw, labels)
 * @param {object} topo    the puzzle's map file: TopoJSON with object "r"
 *                         (records, each with a rid) and object "land"
 * @param {{idPrefix?: string}} [opts]
 * @returns {string} inner SVG markup for a viewBox of 0 0 W H
 */
export function mapMarkup(puzzle, topo, opts = {}) {
  const id = opts.idPrefix || 'bl';
  const projection = makeProjection(puzzle.p);
  const path = geoPath(projection);
  const byRid = new Map();
  for (const g of topo.objects.r.geometries) byRid.set(g.properties.rid, g);

  const drawn = [];
  for (const [rid, color] of puzzle.draw) {
    const g = byRid.get(rid);
    if (!g) throw new Error('map data has no record ' + rid);
    drawn.push({ g, color, d: trim(path(feature(topo, g))) });
  }
  const landD = trim(path(feature(topo, topo.objects.land)));
  const borders = trim(path(mesh(topo, { type: 'GeometryCollection', geometries: drawn.map((x) => x.g) }, (a, b) => a !== b)));
  const grat = trim(path(geoGraticule().step([5, 5])()));

  const out = [];
  out.push('<defs>');
  out.push('<clipPath id="' + id + '-frame"><rect x="0" y="0" width="' + W + '" height="' + H + '"/></clipPath>');
  drawn.forEach((x, i) => out.push('<clipPath id="' + id + '-c' + i + '"><path d="' + x.d + '"/></clipPath>'));
  // Paper: fine brown speckle from fractal noise, plus a darker rim.
  out.push('<filter id="' + id + '-paper" x="0" y="0" width="100%" height="100%">' +
    '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/>' +
    '<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.36  0 0 0 0 0.25  0 0 0 0 0.14  0 0 0 -1.1 0.62"/>' +
    '</filter>');
  out.push('<filter id="' + id + '-ink" x="-2%" y="-2%" width="104%" height="104%">' +
    '<feTurbulence type="fractalNoise" baseFrequency="' + WOBBLE.frequency + '" numOctaves="' + WOBBLE.octaves +
    '" seed="' + WOBBLE.seed + '" result="w"/>' +
    '<feDisplacementMap in="SourceGraphic" in2="w" scale="' + WOBBLE.scale + '" xChannelSelector="R" yChannelSelector="G"/>' +
    '</filter>');
  out.push('<radialGradient id="' + id + '-rim" cx="50%" cy="50%" r="72%">' +
    '<stop offset="62%" stop-color="#6b4a2a" stop-opacity="0"/>' +
    '<stop offset="100%" stop-color="#6b4a2a" stop-opacity="0.22"/></radialGradient>');
  out.push('</defs>');

  out.push('<g clip-path="url(#' + id + '-frame)">');
  out.push('<rect width="' + W + '" height="' + H + '" fill="' + SEA + '"/>');
  out.push('<path d="' + grat + '" fill="none" stroke="' + GRATICULE + '" stroke-width="0.5"/>');
  // Engraved water lines: rings stroked outward from the coast, each
  // covered by a slightly narrower ring of sea, then the land on top.
  out.push('<g filter="url(#' + id + '-ink)">');
  for (const off of [7.5, 5, 2.5]) {
    out.push('<path d="' + landD + '" fill="none" stroke="' + WATERLINE + '" stroke-width="' + (2 * off + 0.6) + '" stroke-linejoin="round"/>');
    out.push('<path d="' + landD + '" fill="none" stroke="' + SEA + '" stroke-width="' + (2 * off - 0.6) + '" stroke-linejoin="round"/>');
  }
  out.push('<path d="' + landD + '" fill="' + BLANK + '"/>');
  for (const x of drawn) out.push('<path d="' + x.d + '" fill="' + TINTS[x.color] + '"/>');
  // Hand-tinted bands just inside each border.
  drawn.forEach((x, i) => out.push('<path d="' + x.d + '" fill="none" stroke="' + BANDS[x.color] +
    '" stroke-width="5" stroke-opacity="0.55" clip-path="url(#' + id + '-c' + i + ')"/>'));
  out.push('</g>');
  out.push('<path d="' + grat + '" fill="none" stroke="' + GRATICULE + '" stroke-width="0.4" stroke-opacity="0.6"/>');
  out.push('<g filter="url(#' + id + '-ink)">');
  out.push('<path d="' + borders + '" fill="none" stroke="' + BORDER + '" stroke-width="0.8" stroke-dasharray="3 1.2 0.8 1.2" stroke-linejoin="round"/>');
  out.push('<path d="' + landD + '" fill="none" stroke="' + INK + '" stroke-width="0.9" stroke-linejoin="round"/>');
  out.push('</g>');

  for (const l of puzzle.labels) {
    const lines = l.t;
    const gap = l.s * 1.05;
    const y0 = l.y - ((lines.length - 1) * gap) / 2 + l.s * 0.36;
    lines.forEach((line, k) => {
      out.push('<text x="' + l.x + '" y="' + r1(y0 + k * gap) + '" font-family="Spectral, Georgia, serif" font-weight="500" font-size="' + l.s +
        '" text-anchor="middle" fill="' + INK + '" stroke="' + BLANK + '" stroke-width="2.2" stroke-opacity="0.75" paint-order="stroke" stroke-linejoin="round"' +
        (lines.length === 1 ? ' textLength="' + l.w + '" lengthAdjust="spacing"' : '') + '>' + esc(line) + '</text>');
    });
  }

  out.push('<rect width="' + W + '" height="' + H + '" filter="url(#' + id + '-paper)" opacity="0.5"/>');
  out.push('<rect width="' + W + '" height="' + H + '" fill="url(#' + id + '-rim)"/>');
  out.push('</g>');
  out.push('<rect x="1.5" y="1.5" width="' + (W - 3) + '" height="' + (H - 3) + '" fill="none" stroke="' + INK + '" stroke-width="2"/>');
  out.push('<rect x="5" y="5" width="' + (W - 10) + '" height="' + (H - 10) + '" fill="none" stroke="' + INK + '" stroke-width="0.6"/>');
  return out.join('');
}
