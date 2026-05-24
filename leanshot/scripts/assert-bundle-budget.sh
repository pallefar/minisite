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
  "admin-shell       137 GRANDFATHERED debt — Phase 36 Plan 36-05 raised ceiling 130→137 to acknowledge the Phase 36 reviews admin module landing (ReviewsLayout + module-registration overhead in admin-shell; RulesListPage/FunnelDashboardPage/CtaCatalogPage are already lazy-split as separate chunks). Phase 42 Plan 42-11 previously raised 45→130 (Phase 15 page-builder + Phase 24 AdminShell merged-chunk pattern; admin-shell at 115.06 kB gz after Phase 42 NPS dashboard, was 105.50 kB before Phase 42, ceiling 45 kB; documented in .planning/phases/42-v1-3-polish-closeout/deferred-items.md). Phase 36 baseline: 133.11 kB gz post-merge; +3.11 kB over Phase 42 ceiling = Phase 36 admin module wiring (ReviewsLayout: 3 lazy imports + module manifest entry). Owner of debt-burn: Phase 24 admin-shell ceiling-track or a future polish-debt phase. Any NEW regression beyond 137 kB gz signals NEW post-Phase-36 admin code MUST be deferred via sync-defer.ts or admin-route lazy-split."
  "cancellation       13 Plan 40-04 baseline — three-step modal single chunk (D-17 reason picklist + D-19 server-picked offer + D-20 loss-summary). If regressed, lazy-split OfferCard animation via sync-defer.ts or remove framer-motion from loss-summary tile fade-in."
  "community-directory 10 Phase 45 Plan 45-07b — directory surface (CommunityDirectoryView + ProfileCard + LeaderboardChip + ReportButton). Lever to pull: lazy-load LeaderboardChip via sync-defer.ts viewport-trigger; or strip ReportButton modal into a separate chunk if growth exceeds 10 kB gz."
  "community-dm       35 Phase 45 Plan 45-07b — DM surface (DMInboxView + DMThreadView + DMComposer + DMAttachmentUploader + use-dm-inbox-realtime hook). Heaviest contributor: react-virtuoso (~25 kB gz). Lever to pull: defer DMComposer load until thread view is opened (move out of inbox-default chunk); or lazy-load the dompurify config dep if it duplicates."
  "community-feed     20 Defer feed-virtualization with sync-defer.ts; split heavy media render path."
  "community-media   320 Phase 44 Plan 09 ACTUAL: @mux/mux-player v3.13.0 (web component + HLS.js + playback-core + upchunk + mux-video + mux-data-google-ima + Media Chrome) actual gz is ~295 kB (RESEARCH underestimated at 170 kB; corrected at 44-10 Task 2). @mux/mux-uploader-react adds ~8 kB gz. Total ~305 kB gz; ceiling set at 320 kB with 5% headroom. Lever to pull: defer @mux/mux-player via sync-defer.ts viewport-trigger in CommunityVideoPlayer; or upgrade to Mux player v4 if it ships smaller player core."
  "community-mentions  12 Phase 44 Plan 09: Fuse.js (~8 kB gz) + mention typeahead glue (~4 kB). If regressed: check Fuse.js is lazy-imported only (NOT statically imported from community-feed chunk)."
  "course-player      30 Lazy-load video player; consider dynamic import for chapter-list."
  "events             25 Phase 47 Plan 47-05 baseline scaffold — events tab (EventListView + EventDetailView + RsvpButton + WaitlistChip + JoinNowButton). Wave 2 sets the actual size after Plan 47-07 lands; this scaffold reserves the ceiling. If regressed: defer EventDetailView via sync-defer.ts viewport-trigger or split RsvpButton modal into its own chunk."
  "gamification-burst  8 Move particle-animation to sync-defer.ts; drop framer-motion preset if used."
  "helpdesk-widget    25 Lazy-load ticket-form; defer markdown renderer."
  "i18n-runtime       25 Ship only the active locale bundle; lazy-load other locales on language switch. Phase 32 Plan 32-01 baseline: 20.36 kB gz with i18next 26.2.0 + react-i18next 17.0.8 + http-backend 3.0.2 + browser-languagedetector 8.2.1 + html-parse-stringify (transitive, for <Trans>) + use-sync-external-store (transitive). 32-RESEARCH estimate of 15 kB was optimistic — actual i18next + react-i18next core alone is ~12 kB gz before glue + transitives. Lever to pull if pressure returns: drop i18next-browser-languagedetector (~1 kB) for an inline 20-line manual detector. Plan 32-02..07 must stay inside this ceiling; if 32-04 override-backend pushes it, revisit ceiling vs. moving locale_overrides supabase-call out of this chunk."
  "index              50 Verify no static heavy-SDK imports leaked; route through sync-defer.ts per [[project_phase5_bundle_regression]]."
  "QuarterlyNPSModal   5 Phase 42 Plan 42-10 in-app NPS fallback modal. 5-star + textarea + Submit/Skip; lightweight modal. Keep under 5 kB gz — if it grows, audit for unused dep imports."
  "WhatsNewDrawer    105 GRANDFATHERED debt — Phase 42 Plan 42-09 What's New drawer at 93.58 kB gz at first build (includes markdown renderer + serial markdown→HTML pass). Owner of debt-burn: Phase 42 polish or a v1.4 markdown-defer plan (lazy-load remark/rehype stack). Any regression beyond 105 kB gz signals NEW changelog feature MUST defer the markdown path via sync-defer.ts."
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

  # Hash-hyphen-safe regex: Vite content hashes are exactly 8 chars from the
  # base64url charset `[A-Za-z0-9_-]`. Phase 42 Plan 04 Task 2 hit a build that
  # produced `index-BIGRN-KO.js` (hash `BIGRN-KO` contains a hyphen); the
  # previous regex `[A-Za-z0-9_]\{8,\}` excluded `-` and reported the chunk as
  # MISSING (ceiling un-enforced). Fix: require EXACTLY 8 base64url chars
  # `[A-Za-z0-9_-]\{8\}` so the regex (a) accepts hyphen-containing hashes and
  # (b) does not greedily match longer suffixes like `clinic-invite-XXXXXXXX`
  # for `chunk=clinic` (that would require 8 chars + .js immediately after
  # `clinic-`, which fails on the longer chunk name). See
  # [[reference_bundle_budget_hash_hyphen]] (Plan 10-11 fixed the parallel
  # `assert-clinic-bundle-budget.sh`).
  files=$(find "$DIST" -maxdepth 1 -type f \
    -regex ".*/${chunk}-[A-Za-z0-9_-]\{8\}\.js$" 2>/dev/null || true)

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
