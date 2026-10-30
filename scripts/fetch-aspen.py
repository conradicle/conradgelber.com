"""Maintenance-only OSM snapshot refresh. Default: Overpass. --direct: OSM API fallback."""
import json, pathlib, datetime, subprocess, sys
root=pathlib.Path(__file__).resolve().parents[1]/'aspen/data'
boxes={'aspen-mountain':[39.135,-106.840,39.190,-106.800], 'aspen-highlands':[39.115,-106.902,39.185,-106.850], 'buttermilk':[39.175,-106.895,39.215,-106.850], 'snowmass':[39.150,-107.010,39.220,-106.914]}
direct='--direct' in sys.argv
for name,box in boxes.items():
 if "--missing" in sys.argv and (root/(name+".geojson")).exists(): continue
 q='[out:json][timeout:90];(way["piste:type"="downhill"](%s);way["aerialway"](%s););out geom;'%(','.join(map(str,box)),','.join(map(str,box)))
 endpoint='https://overpass.private.coffee/api/interpreter'
 args=['--get','--data-urlencode','data='+q]
 if direct:
  s,w,n,e=box;endpoint=f'https://api.openstreetmap.org/api/0.6/map.json?bbox={w},{s},{e},{n}';args=[]
 endpoints=[endpoint]
 if direct and name=='snowmass':
  s,w,n,e=box;mid=(s+n)/2;mx=(w+e)/2
  endpoints=[f'https://api.openstreetmap.org/api/0.6/map.json?bbox={x},{a},{y},{b}' for a,b in [(s,mid),(mid,n)] for x,y in [(w,mx),(mx,e)]]
 elements={}
 for url in endpoints:
  response=json.loads(subprocess.check_output(['curl','--fail','--silent','--show-error','--max-time','120','-A','ConradGelberAspenExplorer/1.0',url,*args]))
  for item in response['elements']: elements[(item['type'],item['id'])]=item
 data={'elements':list(elements.values())}
 nodes={e['id']:[e['lon'],e['lat']] for e in data['elements'] if e['type']=='node'}
 features=[]
 for e in data['elements']:
  tags=e.get('tags',{})
  if e['type']!='way' or not(tags.get('piste:type')=='downhill' or 'aerialway' in tags): continue
  if tags.get('area')=='yes': continue
  coords=[nodes[n] for n in e['nodes'] if n in nodes] if direct else [[p['lon'],p['lat']] for p in e.get('geometry',[])]
  if len(coords)<2 or len(set(map(tuple,coords)))<2: continue
  # Adjacent resort bounding boxes overlap; assign by the local ridge divide.
  avg_lat=sum(c[1] for c in coords)/len(coords)
  if name=='aspen-highlands' and avg_lat>=39.180: continue
  if name=='buttermilk' and avg_lat<39.180: continue
  features.append({'type':'Feature','id':e['id'],'properties':{'osm_id':e['id'],**tags},'geometry':{'type':'LineString','coordinates':coords}})
 if not features: raise RuntimeError('Refusing to overwrite snapshot with empty result: '+name)
 out={'type':'FeatureCollection','source':'© OpenStreetMap contributors, ODbL 1.0','fetched_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'bbox_query':box,'query':q,'retrieval_method':'OSM map API fallback (Overpass endpoints unavailable)' if direct else 'Overpass','endpoint':endpoint,'features':features}
 (root/(name+'.geojson')).write_text(json.dumps(out,separators=(',',':'))+'\n')
 print(name,len(features),flush=True)
