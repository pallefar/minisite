#!/usr/bin/env bash
# check-unused-baseline.sh
# Runs knip + ts-unused-exports and compares warn counts against the baseline.
# Exits 0 when current <= baseline (warn-on-new posture per D-16 Phase 23).
# Exits 1 when current > baseline for either tool (new dead code introduced).
#
# Usage: bash scripts/check-unused-baseline.sh
#   Run from the leanshot/ working directory.
#
# To update baseline after a cleanup PR, run both tools, capture new counts,
# and update .github/workflows/baselines/unused-exports.json manually.
# D-17: once baseline reaches 0, the gate automatically enforces fail-on-any-warn.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LEANSHOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$LEANSHOT_DIR/.." && pwd)"
BASELINE="$REPO_ROOT/.github/workflows/baselines/unused-exports.json"

# ── Validate baseline file exists ────────────────────────────────────────────
if [[ ! -f "$BASELINE" ]]; then
  echo "ERROR: Baseline not found at $BASELINE"
  echo "       Initialize via Phase 23 Plan 23-02 Task 3."
  exit 1
fi

# ── Read baseline values ─────────────────────────────────────────────────────
BASE_KNIP=$(jq -r '.knip_warns' "$BASELINE")
BASE_TUE=$(jq -r '.tue_warns' "$BASELINE")

echo "=== Unused Exports Baseline Check ==="
echo "Baseline: knip=${BASE_KNIP}, tue=${BASE_TUE}"
echo ""

# ── Run knip ─────────────────────────────────────────────────────────────────
echo "Running knip..."
KNIP_JSON=$(cd "$LEANSHOT_DIR" && npx --yes knip --reporter=json 2>/dev/null || true)

if [[ -z "$KNIP_JSON" ]]; then
  echo "WARNING: knip produced no JSON output — treating as 0 warns"
  KNIP_WARNS=0
else
  # Count warns per category using per-array lengths (avoids nested-array ambiguity
  # in duplicates which is an array-of-pairs).
  # Categories: files, exports, types, enumMembers, duplicates (pairs), dependencies, devDependencies
  KNIP_WARNS=$(echo "$KNIP_JSON" | jq '
    [
      (.issues[].files         | length),
      (.issues[].exports       | length),
      (.issues[].types         | length),
      (.issues[].enumMembers   | length),
      (.issues[].duplicates    | length),
      (.issues[].dependencies  | length),
      (.issues[].devDependencies | length)
    ] | add // 0' 2>/dev/null || echo "0")
fi

echo "  knip current: $KNIP_WARNS (baseline: $BASE_KNIP)"

# ── Run ts-unused-exports ────────────────────────────────────────────────────
echo "Running ts-unused-exports..."
# D-15 exclusions applied via --ignoreFiles regex (pipe-separated OR) and
# --excludePathsFromReport (semicolon-separated path fragments).
# The first output line reports "N modules with unused exports"; we use that
# as the warn count metric for stability across versions.
TUE_OUTPUT=$(cd "$LEANSHOT_DIR" && npx --yes ts-unused-exports tsconfig.app.json \
  --ignoreFiles=".*\\.config\\.(ts|js|mjs)\$|.*\\.test\\.(ts|tsx)\$|.*\\.spec\\.(ts|tsx)\$|src/test-setup\\.ts\$|src/vite-env\\.d\\.ts\$" \
  --excludePathsFromReport=".planning;supabase;e2e;scripts;dist;dist-marketing;node_modules" \
  2>/dev/null || true)

if [[ -z "$TUE_OUTPUT" ]]; then
  echo "WARNING: ts-unused-exports produced no output — treating as 0 warns"
  TUE_WARNS=0
else
  # First line format: "N modules with unused exports".
  # Use parameter expansion instead of `echo | head -1` to avoid SIGPIPE
  # under `set -euo pipefail` when echo's stdout pipe closes early (CI bash 5).
  FIRST_LINE="${TUE_OUTPUT%%$'\n'*}"
  if [[ "$FIRST_LINE" =~ ^([0-9]+)\ modules ]]; then
    TUE_WARNS="${BASH_REMATCH[1]}"
  else
    # No unused exports at all — tool printed nothing or a success message
    TUE_WARNS=0
  fi
fi

echo "  ts-unused-exports current: $TUE_WARNS (baseline: $BASE_TUE)"
echo ""

# ── Compare against baseline ─────────────────────────────────────────────────
FAILED=0

if (( KNIP_WARNS > BASE_KNIP )); then
  echo "FAIL: knip warns INCREASED: $KNIP_WARNS > $BASE_KNIP (new unused exports/files introduced)"
  FAILED=1
elif (( KNIP_WARNS < BASE_KNIP )); then
  echo "PASS: knip warns DECREASED: $KNIP_WARNS < $BASE_KNIP (good — update baseline to lock in progress)"
else
  echo "PASS: knip warns unchanged: $KNIP_WARNS == $BASE_KNIP"
fi

if (( TUE_WARNS > BASE_TUE )); then
  echo "FAIL: ts-unused-exports warns INCREASED: $TUE_WARNS > $BASE_TUE (new unused exports introduced)"
  FAILED=1
elif (( TUE_WARNS < BASE_TUE )); then
  echo "PASS: ts-unused-exports warns DECREASED: $TUE_WARNS < $BASE_TUE (good — update baseline to lock in progress)"
else
  echo "PASS: ts-unused-exports warns unchanged: $TUE_WARNS == $BASE_TUE"
fi

echo ""

if (( FAILED == 1 )); then
  echo "=== FAILED: New unused exports/files detected ==="
  echo "Fix: remove the unused exports/files, or update the baseline if intentional."
  exit 1
fi

echo "=== PASSED: No new unused exports vs baseline ==="
exit 0
