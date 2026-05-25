#!/usr/bin/env bash
#
# check-no-ads-on-excluded-surfaces.test.sh
#
# Phase 56 Plan 56-06 (AD-03) — self-test for check-no-ads-on-excluded-surfaces.sh.
#
# Proves the gate is non-trivial:
#   (a) Runs against current src/ and asserts exit 0 (clean tree).
#   (b) Plants a fake clinic file importing an ad-serving component in a temp dir
#       and asserts exit 1 (gate catches the violation).
#
# Usage:
#   bash leanshot/scripts/check-no-ads-on-excluded-surfaces.test.sh
#
# Exit codes:
#   0 — both assertions passed
#   1 — one or more assertions failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$SCRIPT_DIR/check-no-ads-on-excluded-surfaces.sh"

PASS=0
FAIL=0

ok()   { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1" >&2; FAIL=$((FAIL + 1)); }

# ─── Resolve src root ────────────────────────────────────────────────────────

SRC_ROOT="${1:-}"
if [ -z "$SRC_ROOT" ]; then
  if [ -d "$SCRIPT_DIR/../src" ]; then
    SRC_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)/src"
  elif [ -d "src" ]; then
    SRC_ROOT="src"
  elif [ -d "leanshot/src" ]; then
    SRC_ROOT="leanshot/src"
  fi
fi

if [ -z "$SRC_ROOT" ] || [ ! -d "$SRC_ROOT" ]; then
  echo "::error::self-test: src root not found. Pass it as first argument." >&2
  exit 1
fi

# ─── Assertion A: clean src tree exits 0 ────────────────────────────────────

if bash "$GATE" "$SRC_ROOT" >/dev/null 2>&1; then
  ok "Gate exits 0 on clean src tree (no ad-serving imports in excluded surfaces)"
else
  fail "Gate unexpectedly exits non-zero on clean src tree — investigate violations"
fi

# ─── Assertion B: planted violation exits 1 (clinic surface) ─────────────────
# Create a throwaway dir that looks like clinic/ and plant a file importing
# an ad-serving component. The gate must catch it and exit 1.

TMPDIR_ROOT="$(mktemp -d)"
# Mimic src/components/clinic/ structure so the gate's find path matches
FAKE_CLINIC="$TMPDIR_ROOT/components/clinic"
mkdir -p "$FAKE_CLINIC"

# Plant a file with an ad-serving import (not commented out)
cat > "$FAKE_CLINIC/FakeClinicPage.tsx" <<'TSEOF'
import { something } from '@/components/ui/Card';
import { AdRenderer } from '@/components/ads';

export function FakeClinicPage() {
  return null;
}
TSEOF

GATE_EXIT=0
bash "$GATE" "$TMPDIR_ROOT" >/dev/null 2>&1 || GATE_EXIT=$?

if [ "$GATE_EXIT" -eq 1 ]; then
  ok "Gate exits 1 when a clinic file imports an ad-serving component (violation caught)"
else
  fail "Gate returned exit $GATE_EXIT instead of 1 on planted violation (gate may be broken)"
fi

# ─── Assertion B2: planted violation exits 1 (doctor-share surface) ──────────
# Verifies CR-01 fix: src/components/share/ is now covered by the gate.

TMPDIR_SHARE="$(mktemp -d)"
FAKE_SHARE="$TMPDIR_SHARE/components/share"
mkdir -p "$FAKE_SHARE"

cat > "$FAKE_SHARE/FakeSharePage.tsx" <<'TSEOF'
import { AdRenderer } from '@/components/ads';

export function FakeSharePage() {
  return null;
}
TSEOF

GATE_SHARE_EXIT=0
bash "$GATE" "$TMPDIR_SHARE" >/dev/null 2>&1 || GATE_SHARE_EXIT=$?

if [ "$GATE_SHARE_EXIT" -eq 1 ]; then
  ok "Gate exits 1 when a doctor-share (components/share) file imports an ad-serving component (CR-01 fix verified)"
else
  fail "Gate returned exit $GATE_SHARE_EXIT instead of 1 on doctor-share violation — CR-01 fix may be missing"
fi

rm -rf "$TMPDIR_SHARE"

# ─── Assertion C: commented-out import does NOT trip the gate ────────────────
# Verifies comment-stripping works (prevents negation-grep evasion).

FAKE_CLINIC2="$TMPDIR_ROOT/components/clinic2"
mkdir -p "$FAKE_CLINIC2"

# Adjust path structure: gate finds *components/clinic* pattern
FAKE_CLINIC2_INNER="$TMPDIR_ROOT/components/clinic-clean"
mkdir -p "$FAKE_CLINIC2_INNER"

cat > "$FAKE_CLINIC2_INNER/CleanClinicPage.tsx" <<'TSEOF'
// import { AdRenderer } from '@/components/ads';  // this is commented out
import { something } from '@/components/ui/Card';

export function CleanClinicPage() {
  return null;
}
TSEOF

GATE_EXIT2=0
bash "$GATE" "$TMPDIR_ROOT/components/clinic-clean/.." >/dev/null 2>&1 || GATE_EXIT2=$?

# The commented import should be stripped — gate must exit 0 on this dir alone
# We test by running gate against just a dir containing only the clean file
CLEAN_TMP="$(mktemp -d)"
CLEAN_CLINIC="$CLEAN_TMP/components/clinic-commented"
mkdir -p "$CLEAN_CLINIC"
cp "$FAKE_CLINIC2_INNER/CleanClinicPage.tsx" "$CLEAN_CLINIC/"

GATE_COMMENT_EXIT=0
bash "$GATE" "$CLEAN_TMP" >/dev/null 2>&1 || GATE_COMMENT_EXIT=$?

if [ "$GATE_COMMENT_EXIT" -eq 0 ]; then
  ok "Gate exits 0 when ad-serving import is comment-stripped (no false positive)"
else
  fail "Gate exits $GATE_COMMENT_EXIT on a commented import — possible false positive (comment stripping may be broken)"
fi

# ─── Cleanup ─────────────────────────────────────────────────────────────────

rm -rf "$TMPDIR_ROOT" "$CLEAN_TMP"

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo "Self-test results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  echo "::error::AD-03 gate self-test FAILED ($FAIL assertion(s))" >&2
  exit 1
fi

echo "AD-03 gate self-test PASSED — gate is non-trivial and catches violations."
exit 0