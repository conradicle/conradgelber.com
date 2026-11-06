import json
import math
import pathlib
import numpy as np
import shapely
from scipy.spatial import cKDTree

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / 'miami-beach/data/realism'
RAW = ROOT / 'play-src/data/miami-beach/raw/realism'
SX = 111320 * math.cos(math.radians(25.815))
manifest = json.loads((OUT / 'manifest.json').read_text())
inventory = json.loads((ROOT / 'play-src/data/miami-beach/raw/trees.json').read_text())['features']
reports = []
for region in manifest['regions']:
    points = np.load(RAW / f"{region['id']}-points.npy")
    xz = points[:, [0, 2]]
    spatial = cKDTree(xz)
    ground = points[points[:, 3] == 2]
    ground_spatial = cKDTree(ground[:, [0, 2]])
    records = json.loads((OUT / region['records']).read_text())
    for record in records:
        if not record['polygons']:
            continue
        shape = shapely.MultiPolygon([(p[0], p[1:]) for p in record['polygons']])
        a, b, c, d = shape.bounds
        center = np.array([(a+c)/2, (b+d)/2])
        candidates = spatial.query_ball_point(center, math.hypot(c-a, d-b)/2 + 1)
        sample = points[candidates]
        inside = shapely.contains_xy(shape, sample[:, 0], sample[:, 2])
        building = sample[inside & np.isin(sample[:, 3], [1, 6])]
        classified = sample[inside & (sample[:, 3] == 6)]
        neighbors = ground_spatial.query(center, k=min(30, len(ground)))[1]
        ground_z = float(np.median(ground[neighbors, 1]))
        if len(classified) < 10:
            continue
        top = float(np.percentile(classified[:, 1], 99.5))
        record['laser'] = {'ground': round(ground_z, 2), 'classifiedRoofP995': round(top, 2), 'classifiedHeight': round(top-ground_z, 2), 'classifiedPoints': len(classified), 'allReturnMax': round(float(building[:, 1].max()), 2), 'difference': round(top-record['sourceTop'], 2), 'year': 2021}
    (OUT / region['records']).write_text(json.dumps(records, separators=(',', ':')))
    diffs = [r['laser']['difference'] for r in records if 'laser' in r]
    report = {'id': region['id'], 'checked': len(diffs), 'within2m': sum(abs(d) <= 2 for d in diffs), 'medianAbsDifference': float(np.median(np.abs(diffs))), 'largest': sorted([{'id':r['id'],'height':round(r['height'],2),'geo':r['geo'],'laser':r['laser']} for r in records if 'laser' in r], key=lambda r:r['height'], reverse=True)[:6]}
    reports.append(report)
    print(json.dumps(report, indent=2), flush=True)
    # Terrain grid and canopy estimates preserve the source vertical reference.
    w, s, e, n = region['bbox']
    width = 49
    xmin, zmin = (w+80.135)*SX, (25.815-n)*111320
    xmax, zmax = (e+80.135)*SX, (25.815-s)*111320
    xx, zz = np.meshgrid(np.linspace(xmin, xmax, width), np.linspace(zmin, zmax, width))
    locations = np.column_stack([xx.ravel(), zz.ravel()])
    distance, near = ground_spatial.query(locations, k=8)
    weights = 1 / np.maximum(distance, .5)**2
    heights = (ground[near, 1]*weights).sum(axis=1) / weights.sum(axis=1)
    terrain = {'bbox': region['bbox'], 'size': width, 'elevations': np.round(heights, 2).tolist(), 'datum': 'NAVD88', 'renderOffset': 1}
    trees = []
    for feature in inventory:
        lon, lat = feature['geometry']['coordinates'][:2]
        if not (w <= lon <= e and s <= lat <= n) or feature['properties']['CONDITION'] == 'Dead':
            continue
        p = np.array([(lon+80.135)*SX, (25.815-lat)*111320])
        indices = spatial.query_ball_point(p, 3.5)
        sample = points[indices]
        vegetation = sample[np.isin(sample[:, 3], [3,4,5])]
        ground_z = float(np.median(ground[ground_spatial.query(p,k=8)[1], 1]))
        height = float(np.percentile(vegetation[:,1],95)-ground_z) if len(vegetation)>8 else None
        trees.append({'p':np.round(p,2).tolist(),'palm':any(v in (feature['properties']['TREE_SPECI'] or '').lower() for v in ['palm','coconut']),'height':round(min(25,max(3,height)),2) if height else None,'ground':round(ground_z,2),'species':feature['properties']['TREE_SPECI'] or 'Unknown','heightSource':'nearby-laser-canopy' if height else 'generic'})
    (OUT / f"{region['id']}-environment.json").write_text(json.dumps({'terrain':terrain,'trees':trees},separators=(',',':')))
(OUT / 'validation.json').write_text(json.dumps({'method':'2021 classified building roof P99.5 compared with 2015 county mesh top; different roof definitions and survey years can disagree. Unclassified maxima are diagnostic only.','regions':reports,'reference':{'name':'Blue Diamond Tower','architecturalHeight':170.4,'occupiedHeight':130.3,'url':'https://www.skyscrapercenter.com/miami-beach/blue-diamond-tower/2708/','note':'Architectural top includes the crown. An occupied-floor or sampled roof height is not equivalent.'}},indent=2))
