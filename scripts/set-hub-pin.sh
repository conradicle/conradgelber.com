#!/usr/bin/env bash
# Sets a new hub PIN (or passphrase) on the live site: asks for it twice
# without echoing, makes a fresh salt and PBKDF2 hash, and puts both Pages
# secrets. The PIN itself is never written to disk or passed on a command
# line. A secret change takes effect on the next deploy (a push to main, or
# "Retry deployment" on the latest one in the Cloudflare dashboard).
#
#   scripts/set-hub-pin.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export CLOUDFLARE_ACCOUNT_ID=371108a86979f6f53d469d7250e1f924

read -rsp "New PIN or passphrase (8-128 characters): " PIN; echo
read -rsp "Again: " PIN2; echo
[ "$PIN" = "$PIN2" ] || { echo "They don't match."; exit 1; }
[ ${#PIN} -ge 8 ] && [ ${#PIN} -le 128 ] || { echo "Needs 8 to 128 characters."; exit 1; }

# Same parameters as pinMatches() in functions/_lib/auth.js.
OUT=$(HUB_PIN="$PIN" node -e '
  const c = require("crypto"), s = c.randomBytes(16);
  console.log(s.toString("base64"));
  console.log(c.pbkdf2Sync(process.env.HUB_PIN, s, 100000, 32, "sha256").toString("base64"));')
unset PIN PIN2
SALT=$(echo "$OUT" | sed -n 1p)
HASH=$(echo "$OUT" | sed -n 2p)

printf %s "$SALT" | npx -y wrangler@4.150.0 pages secret put PIN_SALT_B64 --project-name conradgelber-com
printf %s "$HASH" | npx -y wrangler@4.150.0 pages secret put PIN_HASH_B64 --project-name conradgelber-com
echo "Done. The new PIN works after the next deploy."
