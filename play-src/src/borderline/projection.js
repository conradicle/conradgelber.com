// One projection for every crop, shared by the browser and the bank
// builder so a puzzle draws exactly where it was judged. Equal-area keeps
// the pixel thresholds fair from the equator to Scandinavia.
import { geoAzimuthalEqualArea } from 'd3-geo';

export const FRAME_W = 360;
export const FRAME_H = 400;

/** @param {{c:[number,number], s:number}} p  centre [lon, lat] and scale */
export function makeProjection(p) {
  return geoAzimuthalEqualArea()
    .rotate([-p.c[0], -p.c[1]])
    .scale(p.s)
    .translate([FRAME_W / 2, FRAME_H / 2])
    .clipAngle(90)
    .clipExtent([[-4, -4], [FRAME_W + 4, FRAME_H + 4]])
    .precision(0.3);
}

/** Scale that fits `km` kilometres across the frame width. */
export const scaleForWidth = (km) => (FRAME_W * 6371.0088) / km;
