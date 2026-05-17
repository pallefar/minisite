#!/usr/bin/env bash
#
# check-taxo-06-reconciliation.sh
#
# Phase 24 TAXO-06 reconciliation marker gate.
# Refuses to merge if the reconciliation block in events.ts header is removed.
#
# D-10 chose ADDITIVE-ONLY event evolution (ESLint-enforced). The header marker
# in src/lib/analytics/events.ts documents WHY this satisfies REQ TAXO-06
# ("schema-evolution policy with migration safety"). Removing it silently changes
# the policy without a visible PR diff justification.
#
# Per [[reference_grep_gate_comment_strip]]: strip comments before grep WHEN the
# token could match commented-out code. Here we WANT the comment match — the marker
# lives IN the file header comment — so no strip needed. The grep targets the
# literal string "TAXO-06 reconciliation:" which appears only in the header block.
#
# Usage:
#   bash scripts/check-taxo-06-reconciliation.sh [path/to/events.ts]
#
# Exit codes:
#   0 — marker present (pass)
#   1 — marker missing (fail — block merge)
#   2 — file not found

set -euo pipefail

FILE="${1:-src/lib/analytics/events.ts}"

# Resolve relative to script location when run from repo root
if [ ! -f "$FILE" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  RESOLVED="$(cd "$SCRIPT_DIR/.." && pwd)/$FILE"
  if [ -f "$RESOLVED" ]; then
    FILE="$RESOLVED"
  else
    echo "::error::$FILE not found (tried $RESOLVED). Ensure events.ts exists." >&2
    exit 2
  fi
fi

if ! grep -q "TAXO-06 reconciliation:" "$FILE"; then
  cat >&2 <<EOM
::error::FAIL: TAXO-06 reconciliation marker missing from $FILE header.

Phase 24 D-10 chose additive-only event evolution. The reconciliation block in
events.ts explains why this satisfies the spirit of REQ TAXO-06 ("schema-evolution
policy with migration safety"). Removing this marker silently changes the policy.

Restore the block (see Phase 24 24-CONTEXT.md D-10) OR — if the policy genuinely
changes — file a Phase 24 follow-up issue documenting the new evolution model BEFORE
removing the marker.
EOM
  exit 1
fi

echo "OK: TAXO-06 reconciliation marker present in $FILE"
exit 0
