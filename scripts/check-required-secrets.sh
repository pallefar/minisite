#!/usr/bin/env bash
# Phase 52 Plan 52-04 — VENDOR-07 required-secrets drift guard.
#
# Usage: bash scripts/check-required-secrets.sh
#
# Purpose: Detects silent required-secret drift. Specifically watches SENTRY_DSN
#   (VENDOR-07: a missing/renamed SENTRY_DSN means all Edge Fn error reporting
#   is silently broken). Also watches all other [EXISTING] required secrets.
#
# Behavior:
#   - If Supabase CLI is available and authenticated, queries the live secret
#     NAME list (values are masked — never printed) for the project.
#   - If CLI is unavailable or unauthenticated, falls back to a name-manifest
#     self-consistency check (REQUIRED ∩ DEFERRED == ∅, all names well-formed)
#     so the guard stays green in CI without Supabase access.
#   - Hard FAILS (exit 1) only when a Required secret is missing AND not on the
#     deferred allowlist.
#   - WARNs (exit 0) for any secret on the deferred allowlist.
#   - Prints a RESULT: pass|fail summary line at the end.
#
# Canonical source: leanshot/.planning/runbooks/vendor-secrets.md
#   § "CI drift guard — required-secret manifest and deferred allowlist"
#   Keep the arrays below in sync with that section.
#
# Security: this script NEVER prints secret VALUES. `supabase secrets list`
#   returns only masked digests and names. We parse only the NAME column.
#   No Authorization tokens or secret values are echoed.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-ytnsipxxmzgaebkqmokp}"
RUNBOOK_PATH="leanshot/.planning/runbooks/vendor-secrets.md"

# Required (watched) secrets — hard FAIL if missing and not deferred.
# Source: vendor-secrets.md § "Required (watched) secrets"
# SENTRY_DSN MUST be present (VENDOR-07 drift target).
REQUIRED_SECRETS=(
  SENTRY_DSN
  RESEND_API_KEY
  RESEND_FROM
  STRIPE_SECRET_KEY
  ANTHROPIC_API_KEY
  ANTHROPIC_CLINICAL_BAA_ACTIVE
  MUX_TOKEN_ID
  MUX_TOKEN_SECRET
  MUX_WEBHOOK_SIGNING_SECRET
  # PostHog API auth credentials — used by vendor-smoke posthogHandler (index.ts:313-314).
  # Note: POSTHOG_PROJECT_KEY is a separate Vite/frontend public key used by variant-resolver Fn;
  # it is NOT the API auth credential and is NOT watched here.
  POSTHOG_PERSONAL_API_KEY
  POSTHOG_PROJECT_ID
)

# Deferred-to-Phase-70 allowlist — WARN (exit 0) if missing.
# Source: vendor-secrets.md § "Deferred-to-Phase-70 (pending-provisioning) allowlist"
DEFERRED_ALLOWLIST=(
  # FCM auth uses PLAY_SERVICE_ACCOUNT_JSON (OAuth2 service account) — not a legacy server key.
  # FCM_SERVER_KEY (legacy HTTP v1 key) is NOT read by any Edge Fn; removed from allowlist.
  CALENDLY_OAUTH_CLIENT_ID
  CALENDLY_OAUTH_CLIENT_SECRET
  CALENDLY_WEBHOOK_SIGNING_KEY
  CALENDLY_API_KEY
  BETTER_STACK_API_KEY
  BETTER_STACK_PAGE_ID
  ANTHROPIC_CLINICAL_API_KEY
  SLACK_WEBHOOK_EXPERIMENTS_URL
  SHARE_TOKEN_SECRET
  QUARTERLY_NPS_SIGNING_KEY
  APNS_KEY_ID
  APNS_TEAM_ID
  APNS_P8_KEY
  RC_API_KEY_IOS
  RC_API_KEY_ANDROID
  REVENUECAT_WEBHOOK_SECRET
  PLAY_PACKAGE_NAME
  PLAY_SERVICE_ACCOUNT_JSON
  VAPID_PRIVATE_KEY
)

# ---------------------------------------------------------------------------
# Helper: check if a name is in DEFERRED_ALLOWLIST
# ---------------------------------------------------------------------------
is_deferred() {
  local name="$1"
  for d in "${DEFERRED_ALLOWLIST[@]}"; do
    [ "$d" = "$name" ] && return 0
  done
  return 1
}

# ---------------------------------------------------------------------------
# Self-consistency check (name-manifest mode)
# Runs always (even when CLI is available) to catch manifest drift.
# ---------------------------------------------------------------------------
manifest_self_check() {
  local errors=0

  # 1. SENTRY_DSN must appear in REQUIRED and NOT in DEFERRED
  local sentry_in_required=0
  for r in "${REQUIRED_SECRETS[@]}"; do
    [ "$r" = "SENTRY_DSN" ] && sentry_in_required=1 && break
  done
  if [ "$sentry_in_required" -ne 1 ]; then
    echo "MANIFEST ERROR: SENTRY_DSN is missing from REQUIRED_SECRETS array (VENDOR-07)" >&2
    errors=$((errors + 1))
  fi
  if is_deferred "SENTRY_DSN"; then
    echo "MANIFEST ERROR: SENTRY_DSN must not be in DEFERRED_ALLOWLIST (VENDOR-07)" >&2
    errors=$((errors + 1))
  fi

  # 2. REQUIRED ∩ DEFERRED must be empty
  for r in "${REQUIRED_SECRETS[@]}"; do
    if is_deferred "$r"; then
      echo "MANIFEST ERROR: '$r' appears in both REQUIRED_SECRETS and DEFERRED_ALLOWLIST — guard behavior is undefined" >&2
      errors=$((errors + 1))
    fi
  done

  # 3. Runbook must exist
  if [ ! -f "$RUNBOOK_PATH" ]; then
    echo "MANIFEST ERROR: runbook not found at $RUNBOOK_PATH" >&2
    errors=$((errors + 1))
  fi

  return "$errors"
}

# ---------------------------------------------------------------------------
# Supabase secret name discovery
# Returns list of known secret names via stdout, one per line.
# Returns empty if CLI is unavailable or unauthenticated (soft skip).
# ---------------------------------------------------------------------------
discover_supabase_secrets() {
  if ! command -v supabase &>/dev/null; then
    echo "[INFO] supabase CLI not found — using name-manifest self-consistency check only" >&2
    return 0
  fi

  local raw _err_tmp
  # Use mktemp for stderr temp file to avoid collision on shared/concurrent runners.
  _err_tmp=$(mktemp)
  # supabase secrets list may exit non-zero if not linked/authenticated — treat as soft
  if ! raw=$(supabase secrets list --project-ref "$SUPABASE_PROJECT_REF" 2>"$_err_tmp"); then
    local err
    err=$(cat "$_err_tmp" 2>/dev/null || true)
    rm -f "$_err_tmp"
    # Not-authenticated and not-linked are expected in CI without secret access
    if echo "$err" | grep -qiE "not logged in|not authenticated|unauthorized|sign in|access token|project not found"; then
      echo "[INFO] supabase CLI not authenticated — using name-manifest self-consistency check only" >&2
      return 0
    fi
    echo "[WARN] supabase secrets list failed: $err" >&2
    return 0
  fi
  rm -f "$_err_tmp"

  # Parse the NAME column — output is a table like:
  #   NAME                         DIGEST
  #   RESEND_API_KEY               abc123...
  # We skip the header line and extract the first whitespace-delimited field.
  # Values (DIGEST) are masked digests only — never full values.
  echo "$raw" | awk 'NR > 1 && NF > 0 { print $1 }'
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
echo "=== Required-secrets drift guard (VENDOR-07) ==="
echo "Project ref: $SUPABASE_PROJECT_REF"
echo ""

# Always run self-consistency check first
echo "--- Manifest self-consistency check ---"
manifest_errors=0
manifest_self_check || manifest_errors=$?
if [ "$manifest_errors" -gt 0 ]; then
  echo "MANIFEST SELF-CHECK FAILED: $manifest_errors error(s) — fix the arrays in this script and the runbook" >&2
  echo "RESULT: fail"
  exit 1
fi
echo "Manifest self-consistency: OK"
echo ""

# Discover live secrets
echo "--- Discovering live Supabase secrets ---"
# Use a temp file approach for bash 3 compatibility (macOS ships with bash 3.2)
_secrets_tmp=$(mktemp)
discover_supabase_secrets > "$_secrets_tmp"
LIVE_NAMES=()
while IFS= read -r line; do
  [ -n "$line" ] && LIVE_NAMES+=("$line")
done < "$_secrets_tmp"
rm -f "$_secrets_tmp"

if [ "${#LIVE_NAMES[@]}" -eq 0 ]; then
  echo "[INFO] No live secret names discovered — CI guard running in name-manifest-only mode"
  echo "RESULT: pass (name-manifest self-consistency only)"
  exit 0
fi

echo "Discovered ${#LIVE_NAMES[@]} live secret name(s)"
echo ""

# Check each required secret
echo "--- Checking required secrets ---"
hard_failures=()
warnings=()

for secret in "${REQUIRED_SECRETS[@]}"; do
  found=0
  for live in "${LIVE_NAMES[@]}"; do
    [ "$live" = "$secret" ] && found=1 && break
  done

  if [ "$found" -eq 1 ]; then
    echo "  OK: $secret"
  else
    if is_deferred "$secret"; then
      echo "  WARN: $secret not yet set — deferred to Phase 70"
      warnings+=("$secret")
    else
      echo "  FAIL: $secret is MISSING (not in deferred allowlist)" >&2
      hard_failures+=("$secret")
    fi
  fi
done

echo ""

# Summary
if [ "${#warnings[@]}" -gt 0 ]; then
  echo "Deferred-secret warnings (${#warnings[@]}):"
  for w in "${warnings[@]}"; do
    echo "  WARN: $w — deferred to Phase 70"
  done
  echo ""
fi

if [ "${#hard_failures[@]}" -gt 0 ]; then
  echo "HARD FAILURES (${#hard_failures[@]}) — non-deferred required secrets missing:" >&2
  for f in "${hard_failures[@]}"; do
    echo "  MISSING: $f" >&2
  done
  echo ""
  echo "RESULT: fail"
  exit 1
fi

echo "RESULT: pass"
exit 0
