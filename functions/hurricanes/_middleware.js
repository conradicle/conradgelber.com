import {onRequest as aspenPolicy} from '../aspen/_middleware.js';
import {hasSession,signedOut,privatize} from '../_lib/auth.js';

// Second check behind functions/_middleware.js. Keeps satellite access scoped
// to this explorer; Aspen's policy is unchanged.
export async function onRequest(context) {
 if(!(await hasSession(context.request,context.env))) return signedOut(new URL(context.request.url).pathname);
 const response=await aspenPolicy(context);
 const policy=response.headers.get('Content-Security-Policy');
 return privatize(response,policy
  .replace("connect-src 'self'", "connect-src 'self' https://services.arcgisonline.com")
  .replace("img-src 'self'", "img-src 'self' https://services.arcgisonline.com"));
}
