// Replace (do not append) the static CSP only for the explorer. Other pages
// retain the site's strict policy. Cesium injects styles and uses blob workers.
export async function onRequest({next}) {
 const original=await next();const response=new Response(original.body,original);
 response.headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self' 'wasm-unsafe-eval' https://cesium.com; style-src 'self' 'unsafe-inline' https://cesium.com; connect-src 'self' https://cesium.com https://api.cesium.com https://assets.cesium.com https://*.cesium.com https://tile.googleapis.com; img-src 'self' data: blob: https://cesium.com https://*.cesium.com https://tile.googleapis.com; worker-src 'self' blob: https://cesium.com; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
 return response;
}
