"""Subset public NOAA imagery and classified laser points for the realism pilot.
Run with the task's GIS Python environment. Large downloads remain in raw/.
"""
import concurrent.futures
import io
import json
import math
import pathlib
import time
import urllib.request

import laspy
import numpy as np
import pyproj
import rasterio
from rasterio.warp import reproject, Resampling, transform_bounds
from rasterio.transform import from_bounds
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[3]
RAW = ROOT / 'play-src/data/miami-beach/raw/realism'
OUT = ROOT / 'miami-beach/data/realism'
RAW.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)
ORIGIN = (-80.135, 25.815)
SX = 111320 * math.cos(math.radians(ORIGIN[1]))
SY = 111320
EPT = 'https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/entwine/geoid18/10338'
IMAGERY = 'https://coastalimagery.blob.core.windows.net/digitalcoast/MiamiFL_RGBN_2023_9996'

def get(url, name):
    dest = RAW / name
    if dest.exists():
        return dest.read_bytes()
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=75) as r:
                result = r.read()
            dest.write_bytes(result)
            return result
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1.5 * 2 ** attempt)

manifest = json.loads((OUT / 'manifest.json').read_text())
ept = json.loads(get(f'{EPT}/ept.json', 'ept.json'))
to_utm = pyproj.Transformer.from_crs(4326, 6346, always_xy=True)
to_geo = pyproj.Transformer.from_crs(6346, 4326, always_xy=True)

def bounds(key):
    depth, x, y, z = map(int, key.split('-'))
    size = (ept['bounds'][3] - ept['bounds'][0]) / 2 ** depth
    minimum = np.array(ept['bounds'][:3]) + np.array([x, y, z]) * size
    return np.concatenate([minimum, minimum + size])

def intersects(a, b):
    return all(a[i] <= b[i + 3] and a[i + 3] >= b[i] for i in range(3))

def points_for(region):
    w, s, e, n = region['bbox']
    corners = np.array([to_utm.transform(x, y) for x in (w, e) for y in (s, n)])
    requested = [*corners.min(axis=0), -10, *corners.max(axis=0), 220]
    pages = ['0-0-0-0']
    nodes = {}
    while pages:
        key = pages.pop()
        page = json.loads(get(f'{EPT}/ept-hierarchy/{key}.json', f'hierarchy-{key}.json'))
        for node, count in page.items():
            if int(node.split('-')[0]) > 10 or not intersects(bounds(node), requested):
                continue
            if count == -1:
                pages.append(node)
            elif count > 0:
                nodes[node] = count
    print(f"{region['id']}: {len(nodes)} laser point tiles", flush=True)
    def load(key):
        b = get(f'{EPT}/ept-data/{key}.laz', f'points-{key}.laz')
        las = laspy.read(io.BytesIO(b))
        x, y, z = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)
        cls = np.asarray(las.classification)
        keep = (x >= requested[0]) & (x <= requested[3]) & (y >= requested[1]) & (y <= requested[4]) & np.isin(cls, [1, 2, 3, 4, 5, 6])
        return np.column_stack([x[keep], y[keep], z[keep], cls[keep]])
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        points = np.concatenate(list(executor.map(load, nodes)))
    lon, lat = to_geo.transform(points[:, 0], points[:, 1])
    keep = (lon >= w) & (lon <= e) & (lat >= s) & (lat <= n)
    points, lon, lat = points[keep], lon[keep], lat[keep]
    local = np.column_stack([(lon - ORIGIN[0]) * SX, points[:, 2], (ORIGIN[1] - lat) * SY, points[:, 3]])
    np.save(RAW / f"{region['id']}-points.npy", local)
    summary = {'points': len(local), 'classes': {str(int(c)): int(sum(local[:, 3] == c)) for c in np.unique(local[:, 3])}, 'maxElevation': float(local[:, 1].max()), 'depth': 10}
    # A compact public point sample supports visual QA without shipping raw LAZ.
    sample = local[::max(1, len(local) // 45000)]
    (OUT / f"{region['id']}-laser.json").write_text(json.dumps({'source': EPT, 'units': 'metres NAVD88', 'summary': summary, 'points': np.round(sample, 2).tolist()}, separators=(',', ':')))
    print(region['id'], summary, flush=True)
    return local, summary

def imagery_for(region):
    catalog = json.loads(get(f'{IMAGERY}/stac/noaa_imagery_item_collection_m9996.json', 'imagery-stac.json'))
    w, s, e, n = region['bbox']
    sources = []
    for f in catalog['features']:
        a, b, c, d = f['bbox']
        if a <= e and c >= w and b <= n and d >= s:
            sources.append(next(iter(f['assets'].values()))['href'])
    width = 2048
    height = round(width * (n - s) * SY / ((e - w) * SX))
    transform = from_bounds(w, s, e, n, width, height)
    output = np.zeros((3, height, width), dtype='uint8')
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', GDAL_HTTP_MAX_RETRY=3, GDAL_CACHEMAX=128 * 1024 * 1024):
        for url in sources:
            print(f"{region['id']}: reading image window from {url.rsplit('/', 1)[-1]}", flush=True)
            with rasterio.open('/vsicurl/' + url) as src:
                # Windowed reads avoid downloading the county-sized imagery.
                a, b, c, d = transform_bounds(4326, src.crs, w, s, e, n)
                window = rasterio.windows.from_bounds(a, b, c, d, src.transform).round_offsets().round_lengths()
                image = src.read([1, 2, 3], window=window, boundless=True)
                candidate = np.zeros_like(output)
                reproject(image, candidate, src_transform=src.window_transform(window), src_crs=src.crs, dst_transform=transform, dst_crs=4326, resampling=Resampling.bilinear)
                valid = candidate.max(axis=0) > 0
                output[:, valid] = candidate[:, valid]
    valid_fraction = float(np.mean(output.max(axis=0) > 0))
    if valid_fraction < .95:
        print(f"{region['id']}: imagery coverage only {valid_fraction:.1%}; no image published", flush=True)
        return None
    filename = f"{region['id']}-aerial.webp"
    Image.fromarray(output.transpose(1, 2, 0)).save(OUT / filename, quality=90, method=6)
    return {'file': filename, 'bbox': region['bbox'], 'width': width, 'height': height, 'coverage': valid_fraction, 'date': '2023-10-21', 'license': 'CC0-1.0', 'credit': 'NOAA National Geodetic Survey', 'metadata': 'https://www.fisheries.noaa.gov/inport/item/71599', 'sourceFiles': sources}

results = []
for region in manifest['regions']:
    local, summary = points_for(region)
    existing = json.loads((OUT / 'noaa.json').read_text()) if (OUT / 'noaa.json').exists() else None
    previous = next((r for r in existing['regions'] if r['id'] == region['id']), None) if existing else None
    image = previous['imagery'] if previous else imagery_for(region)
    results.append({'id': region['id'], 'laser': summary, 'imagery': image})
(OUT / 'noaa.json').write_text(json.dumps({'lidar': {'year': 2021, 'metadata': 'https://www.fisheries.noaa.gov/inport/item/76028', 'source': EPT}, 'regions': results}, indent=2))
