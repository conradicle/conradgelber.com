export const MIAMI = [-80.1918,25.7617];
export const COLORS = ['#aeb8c6','#56b4e9','#0072b2','#f0e442','#e69f00','#cc79a7','#9467df'];
export function category(w) { return w == null ? null : [64,83,96,113,137].filter(n=>w>=n).length; }
export function level(w) { return w == null || w<34 ? 0 : category(w)+1; }
export function label(w) { return w == null ? 'Unknown' : w<34 ? 'Below TS' : w<64 ? 'TS' : `Cat ${category(w)}`; }
export function distance(lat,lon) {
 const r=Math.PI/180,a=lat*r,b=MIAMI[1]*r;
 return 7917.5226*Math.asin(Math.sqrt(Math.min(1,Math.sin((a-b)/2)**2+Math.cos(a)*Math.cos(b)*Math.sin((lon-MIAMI[0])*r/2)**2)));
}
export function sample(points,time) {
 let i=0; while(i<points.length-2 && points[i+1].time<=time)i++;
 const a=points[i],b=points[i+1]||a,t=Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time)||0));
 const xyz=p=>{const lat=p.lat*Math.PI/180,lon=p.lon*Math.PI/180;return [Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)];};
 const u=xyz(a),v=xyz(b),angle=Math.acos(Math.max(-1,Math.min(1,u.reduce((s,x,j)=>s+x*v[j],0))));
 const w=u.map((x,j)=>angle<1e-8?(1-t)*x+t*v[j]:(Math.sin((1-t)*angle)*x+Math.sin(t*angle)*v[j])/Math.sin(angle));
 return {...(t===1?b:a),time,lat:Math.atan2(w[2],Math.hypot(w[0],w[1]))*180/Math.PI,lon:Math.atan2(w[1],w[0])*180/Math.PI,index:i};
}
