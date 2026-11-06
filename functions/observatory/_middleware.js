// Second check behind functions/_middleware.js, as in functions/hub/.

import { hasSession, signedOut, privatize } from "../_lib/auth.js";

export async function onRequest({ request, env, next }) {
  if (!(await hasSession(request, env))) return signedOut(new URL(request.url).pathname);
  return privatize(await next());
}
