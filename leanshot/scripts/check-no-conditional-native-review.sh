#!/usr/bin/env bash
# Phase 36 Plan 36-01 (REVIEW-01 D-04) — V13-3 BLOCKER grep backup gate.
#
# Two-gate defense (CONTEXT D-03 + D-04):
#   - D-03: ESLint AST rule no-conditional-native-review.cjs (Phase 42 D-20).
#   - D-04: this grep backup, comment-stripped, 10-line co-occurrence window.
#
# Catches patterns the AST rule cannot reach (aliased re-export per Pitfall 7,
# shim-method invocation `.request()` whose callee.property.name='request' is
# not in TARGET_CALL_NAMES). When BOTH gates green: native review prompt cannot
# fire from a rating-aware code path.
#
# Per [[reference_grep_gate_comment_strip]] — strip // and /* */ comments
# BEFORE counting so JSDoc/inline-comment mentions of forbidden identifiers do
# not self-invalidate the gate.
#
# Exit codes:
#   0 — no co-occurrence found (clean tree)
#   1 — at least one violation; file:line printout follows
#   2 — invalid invocation (missing src/)
#
# Usage:
#   bash leanshot/scripts/check-no-conditional-native-review.sh        # gate (CI)
#   bash leanshot/scripts/check-no-conditional-native-review.sh -v     # verbose

set -u
set -o pipefail

VERBOSE=0
if [ "${1:-}" = "-v" ] || [ "${1:-}" = "--verbose" ]; then
  VERBOSE=1
fi

SRC_DIR="${PWD}/src"
if [ ! -d "$SRC_DIR" ]; then
  echo "[check-no-conditional-native-review] error: src/ not found in $PWD" >&2
  exit 2
fi

# Native-review call surface patterns (P36 review-prompt + P42 quarterly NPS).
TARGET_CALL='requestReview|InAppReview\.request|Rating\.request|reviewShim\.request|useNativeReviewTrigger|showReviewPrompt|triggerReviewPrompt|showQuarterlyNpsModal|triggerQuarterlyNps'

# Rating-aware identifiers — co-occurrence with TARGET_CALL = V13-3 violation.
RATING_IDS='nps_score|review_state|is_promoter|is_detractor'

# strip_comments — drop pure-comment lines so JSDoc mentions don't trip the gate.
strip_comments() {
  grep -v -E '^[[:space:]]*(//|/\*|\*)'
}

# 10-line co-occurrence window. For each file with a TARGET_CALL hit, slice
# 10 lines above + 10 lines below and check if RATING_IDS appears within.
hits=""
while IFS=: read -r file line _; do
  [ -z "$file" ] && continue
  [ -z "$line" ] && continue
  start=$((line > 10 ? line - 10 : 1))
  end=$((line + 10))
  # Pull the window through strip_comments to ignore comment-only references.
  if sed -n "${start},${end}p" "$file" 2>/dev/null \
       | strip_comments \
       | grep -qE "($RATING_IDS)"; then
    hits="${hits}${file}:${line}\n"
  fi
done < <(
  grep -rnE "($TARGET_CALL)" "$SRC_DIR" \
    --include='*.ts' \
    --include='*.tsx' \
    --exclude-dir=__tests__ \
    --exclude-dir=node_modules \
    --exclude-dir=dist \
    --exclude-dir=dist-marketing \
    --exclude='*.test.ts' \
    --exclude='*.test.tsx' \
    2>/dev/null \
    | strip_comments
)

TOTAL=0
if [ -n "$hits" ]; then
  TOTAL=$(printf '%b' "$hits" | grep -c ':')
fi

echo ""
if [ "$TOTAL" -eq 0 ]; then
  total_files=$(find "$SRC_DIR" -type f \( -name '*.ts' -o -name '*.tsx' \) ! -path '*/__tests__/*' ! -name '*.test.ts' ! -name '*.test.tsx' | wc -l | tr -d ' ')
  echo "✓ check-no-conditional-native-review: 0 violations across ${total_files} files"
  exit 0
else
  echo "✗ check-no-conditional-native-review: ${TOTAL} violations remain."
  echo "  Per Phase 36 V13-3 BLOCKER (CONTEXT D-03/D-04) — native review prompt"
  echo "  must fire UNCONDITIONALLY; rating-aware code path is forbidden."
  echo ""
  echo "  Offending lines (file:line — TARGET_CALL within 10 lines of RATING_IDS):"
  printf '%b' "$hits" | head -50 | sed 's/^/    /'
  if [ "$TOTAL" -gt 50 ]; then
    echo "    ... and $((TOTAL - 50)) more"
  fi
  exit 1
fi
