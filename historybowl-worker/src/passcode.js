// The team passcode check for IAC packets, kept apart from the Workers runtime so it can be tested in Node.

const enc = new TextEncoder();

async function digest(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

/** Compare as SHA-256 digests, in constant time, so length and timing give nothing away. */
export async function passcodeMatches(given, secret) {
  if (typeof given !== 'string' || !given || typeof secret !== 'string' || !secret) return false;
  const a = await digest(given.trim());
  const b = await digest(secret.trim());
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
