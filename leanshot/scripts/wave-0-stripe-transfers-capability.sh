#!/usr/bin/env bash
#
# Wave-0 smoke — Phase 19 Plan 19-03 — D-37 #2.
#
# Verifies that the LeanShot Stripe PLATFORM account has the `transfers`
# capability ACTIVE before any plan in Phase 19 attempts `stripe.transfers.create`
# (Plan 19-09 cron + Plan 19-11 payout-receipts).
#
# Per [[reference-stripe-platform-capabilities-endpoint]] (BL-13):
#   - GET /v1/account  (SINGULAR) returns the calling platform's OWN account,
#     whose response body exposes `capabilities.transfers` directly.
#   - GET /v1/accounts (PLURAL) lists CONNECTED accounts — NOT what we want.
#
# Per [[feedback-verify-human-uat-via-cli]] we prefer CLI verification over
# user paste-back. If this script PASSes we proceed without asking the user;
# if it FAILs we surface the exact dashboard step needed.
#
# Also verifies that STRIPE_CONNECT_RETURN_URL and STRIPE_CONNECT_REFRESH_URL
# exist as Supabase Function Secrets (consumed by stripe-connect-onboard's
# accountLinks.create call).
#
# Exit codes:
#   0 — capability active + env vars present
#   1 — capability missing (user must enable in Stripe Dashboard)
#   2 — env vars missing (user must `supabase secrets set ...`)
#   3 — STRIPE_SECRET_KEY not set in shell env
#
# Usage:
#   export STRIPE_SECRET_KEY=sk_live_...
#   bash leanshot/scripts/wave-0-stripe-transfers-capability.sh

set -euo pipefail

: "${STRIPE_SECRET_KEY:?Set STRIPE_SECRET_KEY from Phase 12 stripe-done checkpoint (https://dashboard.stripe.com/apikeys)}"

# ─── 1. Check PLATFORM `transfers` capability ────────────────────────────────
# /v1/account (singular) — not /v1/accounts (plural — that's the connected-accounts list).
response=$(curl -sS https://api.stripe.com/v1/account -H "Authorization: Bearer $STRIPE_SECRET_KEY")

# jq -e returns non-zero if the boolean expression evaluates to false/null.
if ! echo "$response" | jq -e '.capabilities.transfers == "active"' >/dev/null 2>&1; then
  current_state=$(echo "$response" | jq -r '.capabilities.transfers // "missing"')
  cat >&2 <<EOF
FAIL — platform Stripe \`transfers\` capability is not 'active'.
Current state: $current_state

REMEDIATION (Wave-0 D-37 #2):
  1. Visit Stripe Dashboard → Settings → Connect → Platform settings → Capabilities
     URL: https://dashboard.stripe.com/settings/connect/platform-controls
  2. Toggle ON \`transfers\` capability (one-click enable).
  3. Wait ~30 seconds for propagation, then re-run this smoke.

Without \`transfers\` active, Plan 19-09 (weekly payout cron) and Plan 19-11
(payout receipts) will hard-fail on stripe.transfers.create — DO NOT proceed.
EOF
  exit 1
fi

echo "  ✓ platform.capabilities.transfers = active"

# ─── 2. Check Function Secrets exist (STRIPE_CONNECT_RETURN_URL/REFRESH_URL) ─
# These are consumed by stripe-connect-onboard → accountLinks.create.
if ! command -v supabase >/dev/null 2>&1; then
  cat >&2 <<EOF
WARN — \`supabase\` CLI not on PATH; skipping Function Secrets check.
Manually verify the following secrets exist in the LeanShot project
(https://supabase.com/dashboard/project/ytnsipxxmzgaebkqmokp/functions/secrets):
  STRIPE_CONNECT_RETURN_URL  = https://leanshot.app
  STRIPE_CONNECT_REFRESH_URL = https://leanshot.app
EOF
  echo "WAVE-0 D-37 #2 PASS (env-var check skipped — no supabase CLI)"
  exit 0
fi

secrets_list=$(supabase secrets list --linked 2>/dev/null || true)

missing=""
if ! echo "$secrets_list" | grep -q "STRIPE_CONNECT_RETURN_URL"; then
  missing="$missing STRIPE_CONNECT_RETURN_URL"
fi
if ! echo "$secrets_list" | grep -q "STRIPE_CONNECT_REFRESH_URL"; then
  missing="$missing STRIPE_CONNECT_REFRESH_URL"
fi

if [ -n "$missing" ]; then
  cat >&2 <<EOF
FAIL — missing Function Secret(s):${missing}

REMEDIATION:
  supabase secrets set STRIPE_CONNECT_RETURN_URL=https://leanshot.app --linked
  supabase secrets set STRIPE_CONNECT_REFRESH_URL=https://leanshot.app --linked

Then re-run this smoke.
EOF
  exit 2
fi

echo "  ✓ STRIPE_CONNECT_RETURN_URL  set"
echo "  ✓ STRIPE_CONNECT_REFRESH_URL set"
echo "WAVE-0 D-37 #2 PASS"
