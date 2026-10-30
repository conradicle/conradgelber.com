// This is a public browser token, not a server credential. Restrict it in ion.
export function onRequestGet({env}) {
 const token=env.CESIUM_ION_TOKEN?.trim();
 return Response.json(token?{token}:{error:'Cesium is not configured'}, {status:token?200:503,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
