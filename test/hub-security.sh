#!/usr/bin/env bash
# Checks the two hub security fixes, with no session cookie:
#   1. No spelling of a /hub path serves hub content (path normalization).
#   2. The 6th wrong PIN from one client in 15 minutes gets 429 + Retry-After.
# Usage:
#   test/hub-security.sh <base-url>            # path checks only (safe on live)
#   test/hub-security.sh <base-url> --limit    # also the PIN limit (local dev)
# --limit writes 5 failures for the client it runs as. Locally it clears them
# first and sends a made-up CF-Connecting-IP; never run it against the live
# site, where the 30-a-day global cap would count them too.
set -u
BASE=${1:?base url}
LIMIT=${2:-}
fail=0
BODY=$(mktemp)

# Text that appears only in hub files: tile list, tool registry, hub script.
HUB_MARKERS='id="tiles"|"tools"\s*:|daily-tasks|toolStore|tools\.json'

check_path() { # raw path
  local res code
  res=$(curl -s --path-as-is -o "$BODY" -w '%{http_code} %{redirect_url}' "$BASE$1")
  code=${res%% *}
  if grep -qE "$HUB_MARKERS" "$BODY" || [ "$code" = 200 ]; then
    echo "FAIL  $1 -> $res (hub content or 200)"; fail=1
  else
    echo "ok    $1 -> $res"
  fi
}

echo "-- signed-out path variants"
for p in /hub/ //hub/ /hub%2f /hub%2F /hub// /hub/./ /hub/x/../ ///hub/hub.js /HUB/ \
         /%68ub/ /hub%252f //hub/tools.json /hub%2ftools.json //hub/tools/daily-tasks/ \
         //hub/tools/daily-tasks/tasks.js //hub/lib/store.js /hub/index.html '/hub\' /a/../hub/; do
  check_path "$p"
done

echo "-- public pages still public"
for p in / /play/ /login/ /style.css; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$p")
  if [ "$code" = 200 ]; then echo "ok    $p -> 200"; else echo "FAIL  $p -> $code"; fail=1; fi
done

if [ "$LIMIT" = "--limit" ]; then
  echo "-- PIN rate limit"
  case "$BASE" in
    http://127.0.0.1*|http://localhost*) ;;
    *) echo "refusing --limit against $BASE (local dev only)"; exit 1 ;;
  esac
  npx -y wrangler@4.150.0 d1 execute conradgelber-hub --local \
    --command "DELETE FROM login_failures" >/dev/null 2>&1
  IP="198.51.100.$((RANDOM % 250 + 1))"
  post() { curl -s -D - -o /dev/null -H "Origin: $BASE" -H "CF-Connecting-IP: $IP" \
    --data-urlencode "pin=$1" "$BASE/login/"; }
  for i in 1 2 3 4 5; do
    st=$(post wrongwrong$i | head -1 | awk '{print $2}')
    if [ "$st" = 303 ]; then echo "ok    wrong PIN $i -> 303"; else echo "FAIL  wrong PIN $i -> $st"; fail=1; fi
  done
  h=$(post wrongwrong6)
  st=$(echo "$h" | head -1 | awk '{print $2}')
  ra=$(echo "$h" | grep -i '^retry-after:' | tr -d '\r' | awk '{print $2}')
  if [ "$st" = 429 ] && [ -n "$ra" ] && [ "$ra" -gt 0 ]; then
    echo "ok    wrong PIN 6 -> 429, Retry-After: $ra"
  else
    echo "FAIL  wrong PIN 6 -> $st, Retry-After: ${ra:-missing}"; fail=1
  fi
  st=$(post "${HUB_TEST_PIN:-2468013579}" | head -1 | awk '{print $2}')
  if [ "$st" = 429 ]; then echo "ok    right PIN refused while locked -> 429"; else echo "FAIL  right PIN while locked -> $st"; fail=1; fi
  loc=$(curl -s -o /dev/null -w '%{redirect_url}' -H "Origin: $BASE" -H "CF-Connecting-IP: 198.51.100.254" --data-urlencode "pin=1234" "$BASE/login/")
  case "$loc" in *e=short) echo "ok    PIN under 8 characters refused" ;; *) echo "FAIL  short PIN -> $loc"; fail=1 ;; esac
fi

rm -f "$BODY"
[ $fail = 0 ] && echo "all passed" || echo "SOME CHECKS FAILED"
exit $fail
