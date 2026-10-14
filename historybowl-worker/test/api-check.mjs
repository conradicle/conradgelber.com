// End-to-end check of a running historybowl Worker over real HTTP.
//   node test/api-check.mjs http://localhost:8801
//   node test/api-check.mjs https://conradgelber.com
// Exits non-zero on any failure. Read-only on purpose: it never posts to
// /report (that writes to the REPORTS KV namespace) and never touches the
// team-only /iac routes. It makes about ten requests, well under the per-IP
// limit. The tossup, bonus and answer checks go through to QB Reader.
const base = new URL(process.argv[2] ?? 'http://localhost:8801');
const api = `${base.origin}/historybowl/api`;
const origin = base.origin;
let failed = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) failed++;
};

async function call(path, init = {}) {
  const res = await fetch(api + path, {
    ...init,
    headers: { Origin: origin, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }
  return { status: res.status, headers: res.headers, body };
}

async function run() {
  const t = await call('/tossups?src=qb&cats=History&subs=&level=regional&n=3');
  const list = t.body && t.body.tossups;
  check('tossups answer 200', t.status === 200, `HTTP ${t.status}`);
  check('tossups come back as a list of 1 to 3', Array.isArray(list) && list.length >= 1 && list.length <= 3, list ? `${list.length}` : 'no list');
  check('each tossup has an id, text and answer', Array.isArray(list) && list.every((q) => q.id && q.text && q.answerPlain));
  check('responses carry nosniff and no-store',
    t.headers.get('x-content-type-options') === 'nosniff' && /no-store/.test(t.headers.get('cache-control') || ''));

  const b = await call('/bonuses?cat=History&level=regional&n=2');
  const bl = b.body && b.body.bonuses;
  check('bonuses answer 200', b.status === 200, `HTTP ${b.status}`);
  check('each bonus has parts', Array.isArray(bl) && bl.length >= 1 && bl.every((x) => Array.isArray(x.parts) && x.parts.length));

  const ok = await call('/check', { method: 'POST', body: JSON.stringify({ answerline: 'George Washington', given: 'Washington' }) });
  check('answer check accepts a right answer', ok.status === 200 && ok.body && ok.body.directive === 'accept', ok.body ? ok.body.directive : `HTTP ${ok.status}`);
  const no = await call('/check', { method: 'POST', body: JSON.stringify({ answerline: 'George Washington', given: 'Napoleon' }) });
  check('answer check rejects a wrong answer', no.status === 200 && no.body && no.body.directive === 'reject', no.body ? no.body.directive : `HTTP ${no.status}`);

  const bad = await call('/tossups?src=qb&cats=Astrology&n=3');
  check('a bad query is a 400', bad.status === 400, `HTTP ${bad.status}`);
  const foreign = await call('/check', { method: 'POST', headers: { Origin: 'https://example.com' }, body: JSON.stringify({ answerline: 'a', given: 'a' }) });
  check('another site is turned away with 403', foreign.status === 403, `HTTP ${foreign.status}`);
  const missing = await call('/nope');
  check('an unknown route is a 404', missing.status === 404, `HTTP ${missing.status}`);
}

run()
  .catch((e) => {
    check('the run finished', false, String(e && e.message || e));
  })
  .finally(() => {
    console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
    process.exit(failed ? 1 : 0);
  });
