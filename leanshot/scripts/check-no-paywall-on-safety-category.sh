#!/usr/bin/env bash
#
# check-no-paywall-on-safety-category.sh
#
# Phase 39 Plan 39-02 (PHARMA-02 / D-06 layer 3 of 3).
#
# D-05 enumerates 5 safety-info categories that must never sit behind a
# pharma paywall:
#   - overdose-warning
#   - contraindication-alert
#   - fda-black-box
#   - serious-adverse-event-signal
#   - pregnancy-lactation-contraindication
#
# D-06 mandates THREE independent enforcement layers; this script is layer 3
# (CI grep gate). Layer 1 is leanshot/eslint-rules/no-paywall-on-safety-category.cjs
# (build-time AST). Layer 2 is leanshot/src/lib/pharma/phaCheck.ts (runtime).
#
# Why a grep gate when the AST rule exists:
#   - The AST rule can be silenced with `// eslint-disable-next-line` on a
#     single line. The CI grep gate is comment-stripped per
#     [[reference_grep_gate_comment_strip]] so eslint-disable comments
#     cannot hide the violation.
#   - The AST rule does not track aliased re-exports
#     (`const sc = content.safety_category; <Paywall>{sc}</Paywall>`); the
#     grep window (10 lines either side) catches the file-level co-occurrence.
#
# Usage:
#   bash leanshot/scripts/check-no-paywall-on-safety-category.sh [src_root]
#
# Exit codes:
#   0 — no Paywall* ↔ safety_category co-occurrence within 10 lines (pass)
#   1 — co-occurrence detected (fail — block merge; print offending lines)
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
  echo "::error::source root not found (tried: leanshot/src, src, script-relative ../src). Pass it explicitly: bash scripts/check-no-paywall-on-safety-category.sh path/to/src" >&2
  exit 2
fi

# Strategy (per-file, NOT grep-window — handles JSDoc block comments):
#   1. Enumerate every src/ TypeScript file that contains `safety_category`.
#   2. For each file, slurp its contents, strip /* … */ block comments
#      (multi-line aware via perl -0) and // line comments, then check for
#      Paywall|PaywallGate|PaywallModal anywhere in the comment-stripped
#      content. Per reference_grep_gate_comment_strip: comment-strip before
#      proximity check so eslint-disable / TODO / explanatory comments
#      cannot mask the violation.
#   3. Any file where stripped content has BOTH safety_category AND a
#      Paywall* identifier is reported.
#
# Per-file check (not 10-line window) is a slightly wider net than the
# original D-06 spec, but it correctly handles the common case where a
# JSDoc header at the top of a file references Paywall* in prose (e.g.
# phaCheck.ts itself). The wider net is OK because:
#   - Phase 39 production code keeps pharma + paywall surfaces in separate
#     files (D-03 + D-12 architecture).
#   - Phase 39 test/fixture/doc files are excluded by the path filters.
#
# Test files + the eslint-rules directory are excluded — they legitimately
# enumerate both identifier names for fixture purposes.

# Step 1: find files containing safety_category.
FILES=$(grep -rl \
  --include='*.tsx' --include='*.ts' \
  --exclude='*.test.ts' --exclude='*.test.tsx' \
  --exclude-dir=__tests__ \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude-dir=dist-marketing \
  --exclude-dir=coverage \
  'safety_category' \
  "$SRC_ROOT" 2>/dev/null || true)

if [ -z "$FILES" ]; then
  echo "OK: no safety_category occurrences found under $SRC_ROOT — gate trivially passes."
  exit 0
fi

# Step 2 + 3: per file, strip /* … */ and // comments, then look for
# Paywall* identifier. Record matching paths.
HITS=""
for f in $FILES; do
  # perl -0 slurps the whole file as one record so the regex matches across
  # newlines (JSDoc /** ... */ blocks span many lines).
  STRIPPED=$(perl -0pe 's{/\*.*?\*/}{}gs; s{//[^\n]*}{}g' "$f" 2>/dev/null || cat "$f")
  if echo "$STRIPPED" | grep -qE '(^|[^A-Za-z0-9_])(Paywall|PaywallGate|PaywallModal)([^A-Za-z0-9_]|$)'; then
    if echo "$STRIPPED" | grep -q 'safety_category'; then
      HITS="$HITS$f"$'\n'
    fi
  fi
done

if [ -n "$HITS" ]; then
  cat >&2 <<'EOM'
::error::FAIL: Paywall* ↔ safety_category proximity detected.

D-05 enumerates 5 safety-info categories (overdose-warning,
contraindication-alert, fda-black-box, serious-adverse-event-signal,
pregnancy-lactation-contraindication) that MUST never sit behind a paywall.
Found a Paywall|PaywallGate|PaywallModal token within 10 lines of a
safety_category reference (comment-stripped, so eslint-disable comments do
NOT hide the violation).

Fix options:
  1. Move the safety_category render outside the Paywall* wrapper.
  2. Guard the wrapper with phaCheck(content) so the violation also surfaces
     at runtime (defense-in-depth per D-06 layer 2).
  3. If the proximity is a false positive (e.g. unrelated code blocks), use
     the established carveout: split the surrounding logic into two files
     so the 10-line window no longer co-occurs.

Offending files (comment-stripped, BOTH safety_category AND a Paywall* token present):
EOM
  echo "$HITS" >&2
  exit 1
fi

echo "OK: no Paywall* ↔ safety_category proximity under $SRC_ROOT (D-06 layer 3 passes)."
exit 0
