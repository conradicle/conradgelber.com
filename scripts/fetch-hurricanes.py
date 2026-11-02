#!/usr/bin/env python3
"""Refresh static Atlantic HURDAT2 data; Python standard library only."""
import json, math, re, subprocess
from datetime import datetime, timezone
from pathlib import Path
BASE = 'https://www.nhc.noaa.gov/data/hurdat/'
OUT = Path(__file__).resolve().parents[1] / 'hurricanes/data'

def download(url):
    return subprocess.check_output(['curl', '--fail', '--location', '--silent', '--show-error', '--retry', '3', url], text=True)

def latest(html):
    files = set(re.findall(r'hurdat2-(\d{4})-(\d{4})-(\d{6,8})\.txt', html))
    def key(f):
        stamp = datetime.strptime(f[2], '%m%d%Y' if len(f[2]) == 8 else '%m%d%y')
        return int(f[1]), stamp
    return 'hurdat2-%s-%s-%s.txt' % max(files, key=key)

def distance(lat, lon):
    a,b = math.radians(lat), math.radians(25.7617)
    h = math.sin((a-b)/2)**2 + math.cos(a)*math.cos(b)*math.sin(math.radians(lon+80.1918)/2)**2
    return 3958.7613 * 2 * math.asin(math.sqrt(min(1,h)))

def category(w):
    return sum(w >= n for n in [64,83,96,113,137]) if w is not None else None

def closest(points):
    # Minimize distance along each shortest great-circle arc, not just six-hour fixes.
    best = None
    for i,(a,b) in enumerate(zip(points,points[1:])):
        def xyz(p):
            lat,lon = map(math.radians,[p['lat'],p['lon']])
            return [math.cos(lat)*math.cos(lon), math.cos(lat)*math.sin(lon), math.sin(lat)]
        u,v = xyz(a),xyz(b)
        angle = math.acos(max(-1,min(1,sum(x*y for x,y in zip(u,v)))))
        def at(t):
            w = [(1-t)*x+t*y for x,y in zip(u,v)] if angle < 1e-8 else [(math.sin((1-t)*angle)*x+math.sin(t*angle)*y)/math.sin(angle) for x,y in zip(u,v)]
            lat,lon = math.degrees(math.atan2(w[2],math.hypot(w[0],w[1]))),math.degrees(math.atan2(w[1],w[0]))
            return distance(lat,lon),lat,lon
        lo,hi=0.,1.
        for _ in range(40):
            x,y=lo+(hi-lo)/3,hi-(hi-lo)/3
            if at(x)[0]<at(y)[0]: hi=y
            else: lo=x
        t=min([0.,1.,(lo+hi)/2],key=lambda t:at(t)[0])
        d,lat,lon=at(t)
        if best is None or d<best['miles']:
            best=dict(miles=d,lat=lat,lon=lon,time=round(a['time']+t*(b['time']-a['time'])))
    if best is None:
        p=points[0];best=dict(miles=distance(p['lat'],p['lon']),lat=p['lat'],lon=p['lon'],time=p['time'])
    return {k:round(v,4) if isinstance(v,float) else v for k,v in best.items()}

def parse(text):
    lines=iter(text.strip().splitlines());storms=[]
    for line in lines:
        h=[s.strip() for s in line.split(',')]
        if not re.fullmatch(r'AL\d{6}',h[0]): raise ValueError('Invalid Atlantic header')
        points=[]
        for _ in range(int(h[2])):
            f=[s.strip() for s in next(lines).split(',')]
            coord=lambda s:float(s[:-1])*(-1 if s[-1] in 'SW' else 1)
            missing=lambda s:None if int(s)==-999 else int(s)
            points.append(dict(time=int(datetime.strptime(f[0]+f[1],'%Y%m%d%H%M').replace(tzinfo=timezone.utc).timestamp()*1000),record=f[2],status=f[3],lat=coord(f[4]),lon=coord(f[5]),wind=missing(f[6]),pressure=missing(f[7])))
        assert all(a['time']<b['time'] for a,b in zip(points,points[1:]))
        peak=max((p['wind'] for p in points if p['wind'] is not None),default=None)
        storms.append(dict(id=h[0],name=h[1].title(),year=int(h[0][-4:]),peakWind=peak,peakCategory=category(peak),closest=closest(points),points=points))
    return storms

def main():
    filename=latest(download(BASE));storms=parse(download(BASE+filename))
    miami=min((s for s in storms if s['year']==1926 and s['name']=='Unnamed'),key=lambda s:s['closest']['miles'])
    miami['displayName']='Great Miami Hurricane'
    OUT.mkdir(parents=True,exist_ok=True)
    write=lambda name,data:(OUT/name).write_text(json.dumps(data,separators=(',',':'))+'\n')
    for s in storms: write(s['id']+'.json',s)
    write('index.json',[dict(id=s['id'],name=s['name'],year=s['year'],peakWind=s['peakWind'],peakCategory=s['peakCategory'],closestMiles=s['closest']['miles'],**({'displayName':s['displayName']} if 'displayName' in s else {})) for s in storms])
    write('source.json',dict(url=BASE+filename,through=max(s['year'] for s in storms),method='Closest approach along interpolated great-circle tracks; not an observed fix or wind footprint.'))
    print(filename, len(storms),'storms; Great Miami:',miami['id'])
if __name__=='__main__': main()
