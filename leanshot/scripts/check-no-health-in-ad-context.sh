#!/usr/bin/env bash
# Phase 55 / 56 — Layer 3 CI grep gate: HEALTH-08 firewall.
#
# Asserts that no file under src/lib/ads/ or src/components/ads/ contains
# a direct import of native/health. This is the third enforcement layer of
# the three-layer "MUST NEVER" invariant:
#   1. ESLint AST rule (eslint-rules/no-health-in-ad-context.cjs)
#   2. Runtime assertNoHealthData() in healthAssert.ts
#   3. This script (CI grep gate)
#
# Usage: bash scripts/check-no-health-in-ad-context.sh src
# Exit 0 = clean. Exit 1 = violation found.

set -euo pipefail

SRC_DIR="${1:-src}"

PATTERN="from ['\"].*native/health['\"]"

VIOLATIONS=$(grep -rE "$PATTERN" \
  "$SRC_DIR/lib/ads/" \
  "$SRC_DIR/components/ads/" \
  2>/dev/null || true)

if [ -n "$VIOLATIONS" ]; then
  echo "FIREWALL VIOLATION: native/health import found in ad context:"
  echo "$VIOLATIONS"
  exit 1
fi

echo "check-no-health-in-ad-context: PASS (no native/health imports in ad files)"
exit 0
