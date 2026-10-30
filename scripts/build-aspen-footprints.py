"""Build ski-area footprints for the Aspen explorer from the checked-in OSM snapshots.

Each footprint is the convex hull of a mountain's runs and lifts, grown by a
small buffer so the outline sits just outside the outermost trails. Output is
aspen/data/footprints.json. Run from the repo root: python3 scripts/build-aspen-footprints.py
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "aspen" / "data"
IDS = ["snowmass", "buttermilk", "aspen-highlands", "aspen-mountain"]
BUFFER_M = 180
LAT0 = 39.18
M_PER_DEG_LAT = 111_320
M_PER_DEG_LON = 111_320 * math.cos(math.radians(LAT0))


def to_xy(lon, lat):
    return (lon * M_PER_DEG_LON, lat * M_PER_DEG_LAT)


def to_lonlat(x, y):
    return (round(x / M_PER_DEG_LON, 6), round(y / M_PER_DEG_LAT, 6))


def hull(points):
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def footprint(mountain_id):
    data = json.loads((DATA / f"{mountain_id}.geojson").read_text())
    pts = []
    for f in data["features"]:
        p = f["properties"]
        if p.get("piste:type") == "downhill" or p.get("aerialway"):
            pts += [to_xy(lon, lat) for lon, lat in f["geometry"]["coordinates"]]
    # Drop stray points far from the mountain's median (bad OSM edits).
    mx = sorted(x for x, _ in pts)[len(pts) // 2]
    my = sorted(y for _, y in pts)[len(pts) // 2]
    pts = [(x, y) for x, y in pts if math.hypot(x - mx, y - my) < 6000]
    core = hull(pts)
    grown = [
        (x + BUFFER_M * math.cos(a), y + BUFFER_M * math.sin(a))
        for x, y in core
        for a in (i * math.pi / 8 for i in range(16))
    ]
    ring = [to_lonlat(x, y) for x, y in hull(grown)]
    cx = sum(x for x, _ in core) / len(core)
    cy = sum(y for _, y in core) / len(core)
    return {"ring": ring, "center": to_lonlat(cx, cy)}


out = {m: footprint(m) for m in IDS}
(DATA / "footprints.json").write_text(json.dumps(out, separators=(",", ":")))
for m, f in out.items():
    print(m, len(f["ring"]), "vertices, center", f["center"])
