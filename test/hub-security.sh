#!/usr/bin/env bash
# Checks the two hub security fixes, with no session cookie:
#   1. No spelling of a private path serves its content (path normalization):
#      /hub, /hurricanes and /observatory, assets and data included.
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

# Text that appears only in private files: tile list, tool registry, hub
# script, hurricane page and data, Observatory page and stylesheet.
HUB_MARKERS='id="tiles"|"tools"\s*:|daily-tasks|toolStore|tools\.json|A city in their path|createScene|HURDAT2|displayName|closestMiles|Foreign Influence|obs-head|obs-kicker'

check_path() { # raw path
  local res code
  res=$(curl -s --path-as-is -o "$BODY" -w '%{http_code} %{redirect_url}' "$BASE$1")
  code=${res%% *}
  if [ "$code" = 000 ] || grep -qE "$HUB_MARKERS" "$BODY" || [ "$code" = 200 ]; then
    echo "FAIL  $1 -> $res (no answer, private content or 200)"; fail=1
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

for f in hurricanes:hurricanes.js observatory:observatory.css; do
  name=${f%%:*}; file=${f##*:}; first=$(printf '%s' "$name" | cut -c1)
  rest=$(printf '%s' "$name" | cut -c2-); upper=$(printf '%s' "$name" | tr a-z A-Z)
  hex=$(printf '%x' "'$first")
  echo "-- signed-out $name"
  for p in "/$name" "/$name/" "//$name/" "/$name%2f" "/$name%2F" "/$name//" "/$name/./" "/$name/x/../" \
           "///$name/$file" "/$upper/" "/%$hex$rest/" "/$name%252f" "//$name/$file" "/$name%2f$file" \
           "/$name/$file" "/$name/$file?v=2" "/$name/index.html" "/$name/icon.svg" "/$name.html" "/$name;x" \
           "/$name\\" "/a/../$name/" "/fonts/..%2f$name/" "/$name/README.md"; do
    check_path "$p"
  done
done
for p in /hurricanes/hurricanes.css /hurricanes/model.js /hurricanes/viewer.js /hurricanes/data/index.json \
         /hurricanes/data/source.json /hurricanes/data/AL011851.json /hurricanes%2fdata%2findex.json \
         //hurricanes/data/AL011851.json; do
  check_path "$p"
done

echo "-- public pages no longer link to them"
for p in /built/ /games/ /work/ /next/ / /sitemap.xml; do
  if curl -s "$BASE$p" | grep -qE '/hurricanes/|/observatory/'; then echo "FAIL  $p links a private folder"; fail=1; else echo "ok    $p"; fi
done

echo "-- public pages still public"
for p in / /play/ /login/ /style.css /built/ /aspen/ /aspen/viewer.js; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$p")
  if [ "$code" = 200 ]; then echo "ok    $p -> 200"; else echo "FAIL  $p -> $code"; fail=1; fi
done

if [ "$LIMIT" = "--limit" ]; then
  echo "-- PIN rate limit"
  case "$BASE" in
    http://127.0.0.1*|http://localhost*) ;;
    *) echo "refusing --limit against $BASE (local dev only)"; exit 1 ;;
  esac
  # The test PIN is never committed: HUB_TEST_PIN from the environment, or from
  # the git-ignored .dev.vars at the repo root.
  TEST_PIN=${HUB_TEST_PIN:-$(sed -n 's/^HUB_TEST_PIN=//p' "$(dirname "$0")/../.dev.vars" 2>/dev/null)}
  [ -n "$TEST_PIN" ] || { echo "set HUB_TEST_PIN or add it to .dev.vars (see ADDING_TOOLS.md)"; exit 1; }
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
  st=$(post "$TEST_PIN" | head -1 | awk '{print $2}')
  if [ "$st" = 429 ]; then echo "ok    right PIN refused while locked -> 429"; else echo "FAIL  right PIN while locked -> $st"; fail=1; fi
  loc=$(curl -s -o /dev/null -w '%{redirect_url}' -H "Origin: $BASE" -H "CF-Connecting-IP: 198.51.100.254" --data-urlencode "pin=1234" "$BASE/login/")
  case "$loc" in *e=short) echo "ok    PIN under 8 characters refused" ;; *) echo "FAIL  short PIN -> $loc"; fail=1 ;; esac
fi

rm -f "$BODY"
[ $fail = 0 ] && echo "all passed" || echo "SOME CHECKS FAILED"
exit $fail
