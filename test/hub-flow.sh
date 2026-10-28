#!/usr/bin/env bash
# End-to-end check of the private hub's auth, against a local `wrangler pages
# dev` or the live site. Usage:
#   test/hub-flow.sh http://127.0.0.1:8788 [right-pin]
# Without a right PIN it checks only the signed-out and wrong-PIN paths.
# It locks out the IP it runs from; clear that afterwards with
#   wrangler d1 execute conradgelber-hub [--remote|--local] --command "DELETE FROM login_failures"
# (and, on the live site, it uses 6 of the 30 failures allowed a day).
set -u
BASE=${1:?base url}
PIN=${2:-}
JAR=$(mktemp)
fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "FAIL  $1 (expected $2, got $3)"; fail=1; fi
}
code() { curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$@"; }
post_pin() { curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -c "$JAR" -b "$JAR" \
  -H "Origin: $BASE" --data-urlencode "username=conrad" --data-urlencode "pin=$1" "$BASE/login/"; }

echo "-- signed out"
check "/hub/ redirects to login"        "303 $BASE/login/" "$(code "$BASE/hub/")"
check "tool page redirects to login"    "303 $BASE/login/" "$(code "$BASE/hub/tools/daily-tasks/")"
check "tool script says 401"            "401 " "$(code "$BASE/hub/tools/daily-tasks/tasks.js")"
check "tools.json says 401"             "401 " "$(code "$BASE/hub/tools.json")"
check "//hub/ redirects to login"       "303 $BASE/login/" "$(code --path-as-is "$BASE//hub/")"
check "storage API says 401"            "401 " "$(code "$BASE/hub/api/store/daily-tasks/state")"
check "storage write says 401"          "401 " "$(code -X PUT -H "Origin: $BASE" -d '{}' "$BASE/hub/api/store/daily-tasks/state")"
check "forged cookie rejected"          "401 " "$(code -b "__Host-hub=9999999999999.abc.def" "$BASE/hub/api/store/daily-tasks/state")"
check "login page is served"            "200 " "$(code "$BASE/login/")"
check "login page has noindex header"   "1" "$(curl -sI "$BASE/login/" | grep -ci '^x-robots-tag: noindex')"
check "cross-origin login post refused" "403 " "$(code -H "Origin: https://evil.example" -d pin=1 "$BASE/login/")"

echo "-- wrong PIN and lockout"
check "short PIN refused"               "303 $BASE/login/?e=short" "$(post_pin 1234)"
for i in 1 2 3 4 5; do
  check "wrong PIN $i rejected" "303 $BASE/login/?e=wrong" "$(post_pin 0000000000)"
done
check "wrong PIN 6 gets 429"            "429 " "$(post_pin 0000000000)"
if [ -n "$PIN" ]; then
  check "right PIN refused while locked" "429 " "$(post_pin "$PIN")"
fi
check "locked message shown" "1" "$(curl -s "$BASE/login/?e=locked&m=15" | grep -c 'Too many tries. Try again in 15 minutes.')"
check "still no session" "401 " "$(code -b "$JAR" "$BASE/hub/api/store/daily-tasks/state")"

[ -z "$PIN" ] && { echo "(no right PIN given: stopping here)"; rm -f "$JAR"; exit $fail; }

echo "-- clear the lockout, then the right PIN"
eval "${CLEAR_CMD:-true}"
check "right PIN signs in"              "303 $BASE/hub/" "$(post_pin "$PIN")"
check "cookie flags" "1" "$(grep -c '#HttpOnly_.*__Host-hub' "$JAR")"
check "hub loads with session"          "200 " "$(code -b "$JAR" "$BASE/hub/")"
check "tool page loads"                 "200 " "$(code -b "$JAR" "$BASE/hub/tools/daily-tasks/")"
check "hub page is no-store" "1" "$(curl -sI -b "$JAR" "$BASE/hub/" | grep -ci '^cache-control: private, no-store')"
check "/login/ bounces to hub when signed in" "303 $BASE/hub/" "$(code -b "$JAR" "$BASE/login/")"

echo "-- storage API"
api="$BASE/hub/api/store/flow-test/k1"
check "create"        "200" "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X PUT -H "Origin: $BASE" -H 'If-None-Match: *' -d '{"n":1}' "$api")"
check "create again refused" "412" "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X PUT -H "Origin: $BASE" -H 'If-None-Match: *' -d '{"n":1}' "$api")"
check "read back"     '{"value":{"n":1},"version":1' "$(curl -s -b "$JAR" "$api" | cut -c1-28)"
check "stale write refused" "412" "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X PUT -H "Origin: $BASE" -H 'If-Match: "7"' -d '{"n":2}' "$api")"
check "versioned write" "200" "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X PUT -H "Origin: $BASE" -H 'If-Match: "1"' -d '{"n":2}' "$api")"
check "cross-origin write refused" "403" "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X PUT -H "Origin: https://evil.example" -d '{}' "$api")"
check "list keys" "1" "$(curl -s -b "$JAR" "$BASE/hub/api/store/flow-test/" | grep -c '"key":"k1"')"
check "delete" "204" "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X DELETE -H "Origin: $BASE" "$api")"

echo "-- logout"
check "logout redirects to login" "303 $BASE/login/" "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -c "$JAR" -b "$JAR" -X POST -H "Origin: $BASE" "$BASE/logout")"
check "hub blocked after logout" "303 $BASE/login/" "$(code -b "$JAR" "$BASE/hub/")"

rm -f "$JAR"
exit $fail
