#!/usr/bin/env bash
# load-rate-limit.sh — Phase 4 T-04-02 / SC#4 evidence.
#
# Fires 35 sequential POSTs against the deployed `ai-chat` Edge Function.
# Threshold is 30/minute (per `.planning/decisions/supabase.md`), so the
# 31st request onward should return 429 with body `{"error":"rate-limited"}`.
#
# Acceptance: 200 count ≤ 30 AND 429 count ≥ 5 → exit 0.
#
# Usage:
#   bash scripts/load-rate-limit.sh <project-ref> <jwt> <anon-key>
#   bash scripts/load-rate-limit.sh ytnsipxxmzgaebkqmokp "$JWT" "$ANON_KEY"
#
# Generating a JWT for the test:
#   curl -s -X POST "https://<ref>.supabase.co/auth/v1/signup" \
#        -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
#        -d '{"data":{"anonymous":true}}'
#   # OR use the supabase-js client `signInAnonymously()` in a Node REPL.
set -euo pipefail
REF="${1:?usage: $0 REF JWT ANON_KEY}"
JWT="${2:?missing JWT}"
ANON_KEY="${3:?missing ANON_KEY}"
URL="https://${REF}.supabase.co/functions/v1/ai-chat"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Parallel fire — sequential requests cross minute-bucket boundaries
# (each curl takes ~1-2s for a streaming response), diluting hits across
# multiple buckets. Parallel forces them into one minute bucket so the
# 30/minute threshold is actually exercised.
fire() {
  local i=$1
  curl -s -o /dev/null -w "%{http_code}" -X POST "$URL" \
    -H "Authorization: Bearer $JWT" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -H "Accept: text/event-stream" \
    -d '{"messages":[{"role":"user","content":"Hi"}],"mode":"coach"}' \
    > "$TMP/r-$i"
}
export -f fire
export URL JWT ANON_KEY TMP

for i in $(seq 1 35); do
  fire "$i" &
done
wait

OK=0
LIMITED=0
OTHER=0
for f in "$TMP"/r-*; do
  STATUS=$(cat "$f")
  case "$STATUS" in
    200) OK=$((OK+1)) ;;
    429) LIMITED=$((LIMITED+1)) ;;
    *)   OTHER=$((OTHER+1)) ;;
  esac
done
echo "200=$OK 429=$LIMITED other=$OTHER"
# Allow ≤ 30 successful (threshold is 30/minute exclusive at 31st), ≥ 5 limited.
if [ "$OK" -le 30 ] && [ "$LIMITED" -ge 5 ]; then
  echo "PASS — rate-limit gate enforced (SC#4)"
  exit 0
fi
echo "FAIL — expected OK ≤ 30 and 429 ≥ 5"
exit 1
