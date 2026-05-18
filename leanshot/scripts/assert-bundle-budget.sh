#!/usr/bin/env bash
#
# assert-bundle-budget.sh
#
# Phase 24 D-18..20 — table-driven per-chunk bundle-ceiling enforcement.
#
# Replaces the Phase 7 jsPDF-only version. Hard-fails CI on any chunk overage
# per D-19. Always prints a table of (chunk, ceiling, actual, status) regardless
# of pass/fail (D-19: table always visible in PR check output).
#
# Chunks not yet present in dist/assets/ (code ships later in v1.3) are
# reported as MISSING — NOT a failure. This allows Wave-3 enforcement to run
# from Phase 24 forward without blocking later phases.
#
# Hash-hyphen-safe filename matching per [[reference_bundle_budget_hash_hyphen]]:
# Vite content hashes CAN contain hyphens (e.g. `BsW-HOUO`). We use -regex
# `/${chunk}-[a-f0-9]{8,}.js$` anchored to the chunk name so `course-player`
# matches `course-player-<hex8+>.js` only, NOT `course-player-extra-<hex>.js`.
#
# Bash 3.2 compatible (macOS default shell). No associative arrays.
#
# Usage:
#   bash scripts/assert-bundle-budget.sh [dist/assets]
#
# Can be invoked from repo root as `bash leanshot/scripts/assert-bundle-budget.sh`
# or from inside leanshot/ as `bash scripts/assert-bundle-budget.sh`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_DIST="$(cd "$SCRIPT_DIR/.." && pwd)/dist/assets"
DIST="${1:-$DEFAULT_DIST}"

if [ ! -d "$DIST" ]; then
  echo "::error::dist/assets not found at $DIST — run 'npm run build' first" >&2
  exit 1
fi

# ── Per-chunk ceilings and hints (bash 3.2 compatible, no associative arrays) ──
# Format: "chunk_name ceiling_kb hint_text"
# Alphabetized for diff hygiene. Update ceiling here when a phase ships code
# that pushes a chunk over ceiling; changes are diffable in PRs (T-24-07b).
CHUNK_CONFIG=(
  "admin-shell        45 Split a lazy route, defer heavy editor panels with sync-defer.ts, or revisit ceiling. NOTE: baseline 39.7 kB gz includes Phase 15 page-builder (old admin-bundle ceiling was 60 kB); Phase 24 D-18 target was 30 kB for new admin-only code."
  "community-feed     20 Defer feed-virtualization with sync-defer.ts; split heavy media render path."
  "course-player      30 Lazy-load video player; consider dynamic import for chapter-list."
  "gamification-burst  8 Move particle-animation to sync-defer.ts; drop framer-motion preset if used."
  "helpdesk-widget    25 Lazy-load ticket-form; defer markdown renderer."
  "i18n-runtime       25 Ship only the active locale bundle; lazy-load other locales on language switch. Phase 32 Plan 32-01 baseline: 20.36 kB gz with i18next 26.2.0 + react-i18next 17.0.8 + http-backend 3.0.2 + browser-languagedetector 8.2.1 + html-parse-stringify (transitive, for <Trans>) + use-sync-external-store (transitive). 32-RESEARCH estimate of 15 kB was optimistic — actual i18next + react-i18next core alone is ~12 kB gz before glue + transitives. Lever to pull if pressure returns: drop i18next-browser-languagedetector (~1 kB) for an inline 20-line manual detector. Plan 32-02..07 must stay inside this ceiling; if 32-04 override-backend pushes it, revisit ceiling vs. moving locale_overrides supabase-call out of this chunk."
  "index              50 Verify no static heavy-SDK imports leaked; route through sync-defer.ts per [[project_phase5_bundle_regression]]."
)

# ── Table header ─────────────────────────────────────────────────────────────
printf "%-24s %12s %12s %8s\n" "CHUNK" "CEILING_KB" "ACTUAL_KB" "STATUS"
printf "%-24s %12s %12s %8s\n" "-----" "----------" "---------" "------"

failed=0

for entry in "${CHUNK_CONFIG[@]}"; do
  # Parse: first token = chunk, second token = ceiling, rest = hint
  chunk=$(echo "$entry" | awk '{print $1}')
  ceiling=$(echo "$entry" | awk '{print $2}')
  hint=$(echo "$entry" | awk '{$1=$2=""; sub(/^[ \t]+/, ""); print}')

  # Hash-hyphen-safe regex: chunk name fully expanded; only trailing `-[hex8+].js`
  # treated as hash. Chunk names with hyphens (e.g. course-player) still match
  # correctly because we anchor to the exact chunk name followed by `-[a-f0-9]{8,}.js`.
  # Vite hashes use base64url-like chars (alphanumeric + underscore/hyphen).
  # Use [A-Za-z0-9_] to match all Vite hash chars, anchored after the chunk name.
  files=$(find "$DIST" -maxdepth 1 -type f \
    -regex ".*/${chunk}-[A-Za-z0-9_]\{8,\}\.js$" 2>/dev/null || true)

  if [ -z "$files" ]; then
    printf "%-24s %12s %12s %8s\n" "$chunk" "$ceiling" "0" "MISSING"
    # MISSING is OK — code for this chunk not yet shipped (v1.3 later phases).
    continue
  fi

  total_bytes=0
  for f in $files; do
    bytes=$(gzip -c "$f" | wc -c | tr -d ' ')
    total_bytes=$((total_bytes + bytes))
  done
  actual_kb=$(awk -v b="$total_bytes" 'BEGIN { printf "%.2f", b/1024 }')

  if awk -v a="$actual_kb" -v c="$ceiling" 'BEGIN { exit !(a > c) }'; then
    over_by=$(awk -v a="$actual_kb" -v c="$ceiling" 'BEGIN { printf "%.2f", a-c }')
    printf "%-24s %12s %12s %8s\n" "$chunk" "$ceiling" "$actual_kb" "OVER"
    echo "  OVER by ${over_by} kB. Hint: ${hint}" >&2
    failed=$((failed + 1))
  else
    printf "%-24s %12s %12s %8s\n" "$chunk" "$ceiling" "$actual_kb" "OK"
  fi
done

echo ""
if [ "$failed" -gt 0 ]; then
  echo "::error::FAIL: $failed chunk(s) over ceiling per D-19 (hard-fail). See table above for remediation hints." >&2
  exit 1
fi

echo "PASS: all chunks within gz ceilings."
exit 0
