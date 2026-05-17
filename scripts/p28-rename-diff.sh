#!/usr/bin/env bash
# Phase 28 Plan 28-00 RECONCILE — pre/post pg_dump --schema-only diff script.
# Addendum A1 (2026-05-17).
#
# Usage: bash scripts/p28-rename-diff.sh <before.sql> <after.sql>
# Outputs a unified diff of the two schema dumps to stdout.
# Exits 0 on success (diff output produced); 1 on missing arguments.
set -euo pipefail

BEFORE="${1:?pre-rename schema dump path required (pass /tmp/p28-before.sql)}"
AFTER="${2:?post-rename schema dump path required (pass /tmp/p28-after.sql)}"

if [ ! -f "$BEFORE" ]; then
  echo "ERROR: before-dump not found: $BEFORE" >&2
  exit 1
fi
if [ ! -f "$AFTER" ]; then
  echo "ERROR: after-dump not found: $AFTER" >&2
  exit 1
fi

# diff returns exit code 1 when files differ — expected; capture output, not exit code.
diff -u "$BEFORE" "$AFTER" || true
