#!/usr/bin/env bash
#
# assert-moderation-bundle-budget.sh — Phase 48 Plan 48-10 (T-48-27).
#
# Enforces the admin-moderation chunk topology per the 48-10 plan:
#
#   admin-moderation  ≤ 30,720 bytes gz  (≤30 kB gz per 48-CONTEXT)
#
# Bundles ModerationLayout + 5 sub-views (ReportsQueue, BannedWordsEditor,
# UserBansRoster, ApplyModerationForm, AuditLogViewer) + api.ts + the shared
# lib/moderation/types.ts. Loads only when an authenticated staff/admin
# user navigates to /admin/moderation; never on first paint.
#
# Hash-hyphen safety mirrors assert-helpdesk-bundle-budget.sh: Vite-6 hashes
# include `[A-Za-z0-9_]` so the strip regex accepts underscores. Label
# segments are lowercase-only so the `[A-Z0-9]` requirement still distinguishes
# hash from label segments.
#
# Behaviour:
#  - If the chunk is missing, emit a `wave-0: …` notice and skip the check
#    (relevant if the script is run before the chunk has been built).
#  - On guard violation: emit a GitHub Actions `::error::` annotation + exit 1.
#  - On pass: emit one OK line.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/dist"
ASSETS_DIR="$DIST_DIR/assets"

# 48-CONTEXT D-19 — admin-moderation ≤30 kB gz hard ceiling. Module is
# lazy-loaded only when the user opens /admin/moderation; not first-paint.
MODERATION_CEILING=30720

PHASE_REF=".planning/phases/48-m4-moderation/48-10-PLAN.md"

if [ ! -d "$DIST_DIR" ]; then
  echo "::error::dist/ not found at $DIST_DIR — run 'npm run build' first" >&2
  exit 1
fi
if [ ! -d "$ASSETS_DIR" ]; then
  echo "::error::dist/assets not found at $ASSETS_DIR — build appears incomplete" >&2
  exit 1
fi

FAIL=0

check_chunk_ceiling() {
  local chunk_glob="$1"
  local ceiling="$2"
  local label="$3"

  local matches=()
  while IFS= read -r f; do
    local base stem recovered prev
    base=$(basename "$f")
    stem="${base%.js}"
    recovered="$stem"
    for _ in 1 2 3 4; do
      prev="$recovered"
      recovered=$(echo "$recovered" | sed 's/-[A-Za-z0-9_]*[A-Z0-9][A-Za-z0-9_]*$//')
      [ "$recovered" = "$prev" ] && break
    done
    if [ "$recovered" = "$label" ]; then
      matches+=("$f")
    fi
  done < <(find "$ASSETS_DIR" -maxdepth 1 -type f -name "$chunk_glob" ! -name '*.map' 2>/dev/null)

  local count=${#matches[@]}
  if [ "$count" -eq 0 ]; then
    echo "wave-0: no $label chunk emitted (matching $chunk_glob) — skipping per-chunk ceiling check"
    return 0
  fi

  local total=0
  for f in "${matches[@]}"; do
    local sz
    sz=$(gzip -c "$f" | wc -c | tr -d '[:space:]')
    total=$((total + sz))
  done

  if [ "$total" -gt "$ceiling" ]; then
    echo "::error::$label chunk(s) total $total bytes gzipped (ceiling $ceiling). See $PHASE_REF" >&2
    FAIL=1
  else
    echo "$label chunk OK: $total bytes gzipped (ceiling $ceiling)"
  fi
}

check_chunk_ceiling 'admin-moderation-*.js' "$MODERATION_CEILING" 'admin-moderation'

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi

echo "admin-moderation bundle topology OK"
exit 0
