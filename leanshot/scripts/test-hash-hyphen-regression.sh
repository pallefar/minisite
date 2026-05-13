#!/usr/bin/env bash
#
# test-hash-hyphen-regression.sh
#
# Phase 12 D-13 — regression test for the hash-hyphen fix landed in Plan 10-11
# (see memory reference_bundle_budget_hash_hyphen.md and lines 147-186 of
# scripts/assert-clinic-bundle-budget.sh).
#
# The fix changed the chunk-label recovery loop from a single `${base%-*}` strip
# to an iterative sed loop that strips trailing Vite hash segments until stable.
# A Vite hash CAN contain hyphens (e.g. `BsW-HOUO`). The old approach would strip
# only the last segment, producing `clinic-invite-BsW` — a wrong label that falls
# through to a silent "wave-0 skip" false-negative.
#
# This test exercises the sed loop in isolation against the known regression case
# and additional boundary cases. It exits 0 on success, non-zero on failure.
#
# Usage: bash scripts/test-hash-hyphen-regression.sh
# CI:    wired into the test-e2e job in .github/workflows/ci.yml
#
# D-13 stipulates: verify only — do NOT modify the sed loop in
# assert-clinic-bundle-budget.sh. This script replicates the loop logic in
# isolation for testing purposes.

set -euo pipefail

PASS_COUNT=0
FAIL_COUNT=0

run_sed_loop() {
  local stem="$1"
  local recovered="$stem"
  local prev=""
  for _ in 1 2 3 4; do
    prev="$recovered"
    recovered=$(echo "$recovered" | sed 's/-[A-Za-z0-9]*[A-Z0-9][A-Za-z0-9]*$//')
    [ "$recovered" = "$prev" ] && break
  done
  echo "$recovered"
}

assert_equals() {
  local description="$1"
  local input="$2"
  local expected="$3"
  local actual
  actual=$(run_sed_loop "$input")
  if [ "$actual" = "$expected" ]; then
    echo "PASS: $description — '$input' strips to '$actual'"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "FAIL: $description — expected '$expected', got '$actual' (input: '$input')" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

# ─── Case 1: primary regression case (reference_bundle_budget_hash_hyphen.md) ───
# clinic-invite-BsW-HOUO is the exact filename that caused the silent false-negative.
# The hash `BsW-HOUO` has a hyphen inside it; two sed passes are required:
#   pass 1: clinic-invite-BsW-HOUO → clinic-invite-BsW (strips HOUO — uppercase-starting)
#   pass 2: clinic-invite-BsW      → clinic-invite     (strips BsW  — uppercase-starting)
STEM="clinic-invite-BsW-HOUO"
EXPECTED="clinic-invite"
assert_equals "hash-hyphen regression (BsW-HOUO)" "$STEM" "$EXPECTED"

# ─── Case 2: no hash — label should be unchanged ───
STEM2="clinic-invite"
EXPECTED2="clinic-invite"
assert_equals "no-hash passthrough" "$STEM2" "$EXPECTED2"

# ─── Case 3: single-segment hash ───
# clinic-CBid3kQA: the hash CBid3kQA starts with an uppercase letter → one pass strips it
STEM3="clinic-CBid3kQA"
EXPECTED3="clinic"
assert_equals "single-segment hash (CBid3kQA)" "$STEM3" "$EXPECTED3"

# ─── Case 4: multi-word label with standard hash ───
# read-only-patient-view-6H0lh4Bj → the hash starts with a digit (6) → one pass strips it
STEM4="read-only-patient-view-6H0lh4Bj"
EXPECTED4="read-only-patient-view"
assert_equals "multi-word label + digit-leading hash" "$STEM4" "$EXPECTED4"

# ─── Case 5: share chunk ───
STEM5="share-BKJYvce0"
EXPECTED5="share"
assert_equals "share chunk hash strip" "$STEM5" "$EXPECTED5"

# ─── Summary ───
echo ""
echo "Results: $PASS_COUNT passed, $FAIL_COUNT failed"

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "FAIL: hash-hyphen regression test — $FAIL_COUNT case(s) failed" >&2
  exit 1
fi

echo "PASS: hash-hyphen regression — 'clinic-invite-BsW-HOUO' correctly strips to 'clinic-invite'"
exit 0
