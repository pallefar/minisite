#!/usr/bin/env bash
#
# Phase 19 Plan 19-02 — Wave-0 D-37 #1 smoke
#
# Verifies that the Vercel rewrite at /r/:code preserves the upstream
# Supabase Edge Function's Set-Cookie header WITH Domain=.leanshot.app.
#
# Why this exists:
#   The affiliate-attribute Edge Function runs on *.supabase.co, but its
#   cookie must carry Domain=.leanshot.app so the visitor's browser keeps
#   it across the apex + www + any future subdomain. Vercel rewrites are
#   server-side proxies (NOT 30x redirects), so the upstream response
#   (including Set-Cookie) should be passed through verbatim. If a future
#   Vercel platform change strips or rewrites Set-Cookie, we need to know
#   BEFORE building real attribution logic on it — hence this smoke.
#
# Fallback if the smoke fails:
#   Register r.leanshot.app as a CNAME pointing directly at the Supabase
#   functions host, and rewrite frontend links from /r/{code} to
#   https://r.leanshot.app/{code}. Cookie Domain=.leanshot.app still
#   covers the subdomain because it is a child of the apex.
#
# Project rules honored:
#   - reference_supabase_edge_function_deploy.md (esm.sh URLs, verify_jwt=false)
#   - reference_supabase_worktree_temp_state.md (copy supabase/.temp/* if
#     running from a Claude Code worktree)
#   - feedback_parallel_executor_autonomy_drift.md (parallel executor MUST
#     NOT push to live infra — this script is run BY the orchestrator or
#     manually by a developer, NOT by a parallel executor agent)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUPABASE_DIR="$(cd "${REPO_ROOT}/.." && pwd)/supabase"
SMOKE_LOG="/tmp/wave-0-smoke.txt"
TARGET_URL="https://leanshot.app/r/test"

# Resolve Supabase CLI: prefer system binary, fall back to npx.
if command -v supabase >/dev/null 2>&1; then
  SUPABASE_BIN="supabase"
elif command -v npx >/dev/null 2>&1; then
  SUPABASE_BIN="npx --yes supabase"
else
  echo "ERROR: neither 'supabase' nor 'npx' on PATH. Install Supabase CLI." >&2
  echo "        macOS: brew install supabase/tap/supabase" >&2
  exit 2
fi

# Resolve Vercel CLI.
if command -v vercel >/dev/null 2>&1; then
  VERCEL_BIN="vercel"
elif command -v npx >/dev/null 2>&1; then
  VERCEL_BIN="npx --yes vercel"
else
  echo "ERROR: neither 'vercel' nor 'npx' on PATH. Install Vercel CLI." >&2
  echo "        npm: npm i -g vercel" >&2
  exit 2
fi

echo ">>> [1/4] Deploying stub affiliate-attribute Edge Function to Supabase..."
cd "${SUPABASE_DIR}"
${SUPABASE_BIN} functions deploy affiliate-attribute --linked

echo ">>> [2/4] Deploying vercel.json (rewrite /r/:code) to production..."
cd "${REPO_ROOT}"
${VERCEL_BIN} deploy --prod --yes

echo ">>> [3/4] Curling ${TARGET_URL} and capturing headers..."
curl -sSv "${TARGET_URL}" 2>&1 | tee "${SMOKE_LOG}" >/dev/null
echo "    (full transcript: ${SMOKE_LOG})"

echo ">>> [4/4] Asserting Set-Cookie preserves Domain=.leanshot.app + HttpOnly..."

# Assertion A: at least one Set-Cookie line with the expected attributes.
if ! grep -i '^< set-cookie:' "${SMOKE_LOG}" | grep -F 'Domain=.leanshot.app' | grep -F 'HttpOnly' >/dev/null; then
  echo "" >&2
  echo "SMOKE FAILED — Vercel rewrite did NOT preserve Set-Cookie with Domain=.leanshot.app." >&2
  echo "" >&2
  echo "Fallback path (D-37 #1):" >&2
  echo "  1. Register r.leanshot.app as a CNAME pointing at ytnsipxxmzgaebkqmokp.functions.supabase.co" >&2
  echo "  2. Verify the CNAME via 'dig +short r.leanshot.app'." >&2
  echo "  3. Update leanshot/src links from /r/{code} to https://r.leanshot.app/{code}." >&2
  echo "  4. Remove the /r/:code rewrite from leanshot/vercel.json." >&2
  echo "  5. Re-run this smoke against https://r.leanshot.app/test." >&2
  echo "" >&2
  echo "Headers received:" >&2
  grep -i '^< set-cookie:' "${SMOKE_LOG}" >&2 || echo "  (no Set-Cookie headers at all)" >&2
  exit 1
fi

# Assertion B (W-6): exactly ONE Set-Cookie line. The Wave-0 stub sets only
# `_aff` (W-6 dropped the `_aff_v` mirror); two Set-Cookie lines would mean
# someone re-introduced the dual cookie.
SET_COOKIE_COUNT=$(grep -ic '^< set-cookie:' "${SMOKE_LOG}" || echo 0)
if [ "${SET_COOKIE_COUNT}" != "1" ]; then
  echo "" >&2
  echo "SMOKE FAILED — expected exactly 1 Set-Cookie header (W-6: single _aff cookie)." >&2
  echo "        got: ${SET_COOKIE_COUNT}" >&2
  echo "Headers received:" >&2
  grep -i '^< set-cookie:' "${SMOKE_LOG}" >&2
  exit 1
fi

echo ""
echo "WAVE-0 SMOKE PASS" | tee -a "${SMOKE_LOG}"
echo ""
echo "Vercel rewrite /r/:code preserves Set-Cookie with Domain=.leanshot.app."
echo "Exactly one Set-Cookie header (W-6 — no _aff_v mirror)."
echo "Plan 19-02 Task 2 may now replace the stub with the real handler."
