import {onRequest as aspenPolicy} from '../aspen/_middleware.js';

// Keep satellite access scoped to this explorer; Aspen's policy is unchanged.
export async function onRequest(context) {
 const response=await aspenPolicy(context);
 const policy=response.headers.get('Content-Security-Policy');
 response.headers.set('Content-Security-Policy',policy
  .replace("connect-src 'self'", "connect-src 'self' https://services.arcgisonline.com")
  .replace("img-src 'self'", "img-src 'self' https://services.arcgisonline.com"));
 return response;
}
