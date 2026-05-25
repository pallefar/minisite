#!/usr/bin/env bash
#
# check-no-health-in-ad-context.sh
#
# Phase 55 Plan 55-01 (HEALTH-04 / HEALTH-08 — Layer 3 of 3).
#
# Two-tunnel firewall CI grep gate: fails if any ad/marketing/analytics/affiliate
# file (or *.ad-eligible.ts) contains a comment-stripped import of health.ts.
# Apple §5.1.3 prohibits HealthKit / PHI data from reaching ad-targeting surfaces.
#
# HEALTH-08 mandates THREE independent enforcement layers; this script is layer 3
# (CI grep gate). Layer 1 is leanshot/eslint-rules/no-health-in-ad-context.cjs
# (build-time AST). Layer 2 is leanshot/src/lib/native/healthAssert.ts (runtime).
#
# Why a grep gate when the AST rule exists:
#   - The ESLint rule can be silenced with `// eslint-disable-next-line`.
#     This grep gate is comment-stripped so eslint-disable comments cannot hide
#     the violation (per feedback_negation_grep_defeated_by_comment_string).
#   - The AST rule does not track dynamic imports or aliased re-exports;
#     the per-file comment-stripped check catches file-level co-occurrence.
#
# Strategy:
#   1. Enumerate every *.ts/*.tsx file under ad-context directories
#      (ads, marketing, analytics, affiliate) plus *.ad-eligible.ts files.
#   2. For each file, slurp its contents, strip /* ... */ block comments
#      (multi-line aware via perl -0) and // line comments, then check whether
#      the comment-stripped content contains an import matching native/health.
#   3. Any matching file is reported; exit 1 with ::error:: annotation.
#
# Test files + __tests__ directories are excluded — they legitimately reference
# both sides of the firewall for fixture purposes.
#
# Usage:
#   bash leanshot/scripts/check-no-health-in-ad-context.sh [src_root]
#
# Exit codes:
#   0 — no ad-context file imports health (Layer 3 passes)
#   1 — health import detected in ad-context file (Layer 3 fails — block merge)
#   2 — src root not found

set -euo pipefail

# Resolve src/ root. Default = leanshot/src (relative to repo root).
# When invoked from leanshot/ cwd via the npm script, src/ also works.
SRC_ROOT="${1:-}"
if [ -z "$SRC_ROOT" ]; then
  if [ -d "leanshot/src" ]; then
    SRC_ROOT="leanshot/src"
  elif [ -d "src" ]; then
    SRC_ROOT="src"
  else
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    if [ -d "$SCRIPT_DIR/../src" ]; then
      SRC_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)/src"
    fi
  fi
fi

if [ -z "$SRC_ROOT" ] || [ ! -d "$SRC_ROOT" ]; then
  echo "::error::source root not found (tried: leanshot/src, src, script-relative ../src). Pass it explicitly: bash scripts/check-no-health-in-ad-context.sh path/to/src" >&2
  exit 2
fi

# Step 1: find all TypeScript files under ad-context surfaces.
# Strategy: find files in directories named ads, ad, marketing, analytics, affiliate,
# OR files matching *.ad-eligible.ts anywhere under SRC_ROOT.
# Exclude test files and generated directories.
FILES=$(find "$SRC_ROOT" \
  \( \
    -path "*/ads/*" \
    -o -path "*/ad/*" \
    -o -path "*/marketing/*" \
    -o -path "*/analytics/*" \
    -o -path "*/affiliate/*" \
    -o -name "*.ad-eligible.ts" \
  \) \
  \( -name "*.ts" -o -name "*.tsx" \) \
  ! -name "*.test.ts" \
  ! -name "*.test.tsx" \
  ! -path "*/__tests__/*" \
  ! -path "*/node_modules/*" \
  ! -path "*/dist/*" \
  ! -path "*/dist-marketing/*" \
  ! -path "*/coverage/*" \
  2>/dev/null || true)

if [ -z "$FILES" ]; then
  echo "OK: no ad-context source files found under $SRC_ROOT — Layer 3 trivially passes."
  exit 0
fi

# Step 2: per file, strip /* ... */ block comments and // line comments,
# then check whether the stripped content contains a health.ts import.
# perl -0 slurps the whole file as one record so the regex matches across newlines.
HITS=""
for f in $FILES; do
  STRIPPED=$(perl -0pe 's{/\*.*?\*/}{}gs; s{//[^\n]*}{}g' "$f" 2>/dev/null || cat "$f")
  if echo "$STRIPPED" | grep -qE "from ['\"].*native/health|from ['\"]@/lib/native/health"; then
    HITS="${HITS}${f}"$'\n'
  fi
done

if [ -z "$HITS" ]; then
  echo "OK: no health import in ad-context files under $SRC_ROOT (Layer 3 passes)."
  exit 0
fi

cat >&2 <<'EOM'
::error::FAIL: Two-tunnel firewall violation (Layer 3 — comment-stripped CI grep gate).

An ad/marketing/analytics/affiliate file contains an import of health.ts.
Apple §5.1.3 prohibits HealthKit / PHI data from reaching ad-targeting surfaces.

This gate is comment-stripped so eslint-disable comments do NOT hide the violation.

Fix options:
  1. Remove the health.ts import from the ad-context file.
  2. If the cross-read is legitimate, extract it into a sibling helper that
     does not match the FORBIDDEN_IMPORTERS pattern (carveout via sibling helper).
  3. Review whether the ad-context file was misclassified (wrong directory).

Offending files (comment-stripped, ad-context file contains health.ts import):
EOM
echo "$HITS" >&2
exit 1
