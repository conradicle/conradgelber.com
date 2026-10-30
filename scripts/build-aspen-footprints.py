"""Build ski-area footprints for the Aspen explorer from the checked-in OSM snapshots.

Each footprint is the union of a mountain's runs and lifts, each widened by a
buffer, with small gaps filled and the result simplified. Neighboring mountains
are kept from overlapping. Output is aspen/data/footprints.json.

Maintenance only (needs `pip install shapely`). Run from the repo root:
    python3 scripts/build-aspen-footprints.py
"""
import json
import math
from pathlib import Path

from shapely.geometry import LineString, Polygon, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "aspen" / "data"
IDS = ["snowmass", "buttermilk", "aspen-highlands", "aspen-mountain"]
BUFFER_M = 140   # how far the outline sits outside the outermost trail
CLOSE_M = 320    # gaps narrower than about twice this get filled in
SIMPLIFY_M = 25
LAT0 = 39.18
KX = 111_320 * math.cos(math.radians(LAT0))
KY = 111_320


def to_xy(lon, lat):
    return (lon * KX, lat * KY)


def to_lonlat(x, y):
    return [round(x / KX, 6), round(y / KY, 6)]


def area(mountain_id):
    data = json.loads((DATA / f"{mountain_id}.geojson").read_text())
    lines = []
    for f in data["features"]:
        p = f["properties"]
        if p.get("piste:type") == "downhill" or p.get("aerialway"):
            lines.append(LineString([to_xy(*c) for c in f["geometry"]["coordinates"]]))
    shape = unary_union([l.buffer(BUFFER_M) for l in lines])
    # Close small gaps between trail pods, then keep the biggest piece without holes.
    shape = shape.buffer(CLOSE_M).buffer(-CLOSE_M)
    if shape.geom_type == "MultiPolygon":
        shape = max(shape.geoms, key=lambda g: g.area)
    return Polygon(shape.exterior)


shapes = {m: area(m) for m in IDS}
# Where two footprints overlap, split the overlap between them along the gap.
for i, a in enumerate(IDS):
    for b in IDS[i + 1:]:
        overlap = shapes[a].intersection(shapes[b])
        if overlap.is_empty:
            continue
        ca, cb = shapes[a].centroid, shapes[b].centroid
        shapes[a] = shapes[a].difference(overlap.buffer(1))
        shapes[b] = shapes[b].difference(overlap.buffer(1))
        for m in (a, b):
            if shapes[m].geom_type == "MultiPolygon":
                shapes[m] = max(shapes[m].geoms, key=lambda g: g.area)
        print(f"split overlap {a} / {b}: {overlap.area / 1e6:.2f} km²")

out = {}
for m, shape in shapes.items():
    shape = shape.simplify(SIMPLIFY_M)
    ring = [to_lonlat(x, y) for x, y in list(shape.exterior.coords)[:-1]]
    c = shape.representative_point()
    out[m] = {"ring": ring, "center": to_lonlat(c.x, c.y)}
    print(m, len(ring), "vertices", f"{shape.area / 1e6:.1f} km²")
(DATA / "footprints.json").write_text(json.dumps(out, separators=(",", ":")))
