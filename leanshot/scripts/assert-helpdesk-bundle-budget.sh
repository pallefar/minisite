#!/usr/bin/env bash
#
# assert-helpdesk-bundle-budget.sh — Phase 37 Plan 06 Task 4 (D-16 / T-37-06-06).
#
# Enforces the helpdesk chunk topology per the 37-06 plan:
#
#   helpdesk-widget   ≤ 25,600 bytes gz  (root chunk; mounted on every screen via App.tsx — first-paint sensitive)
#   helpdesk-article  ≤ 130,000 bytes gz (react-markdown + remark-gfm + rehype-raw + dompurify; lazy on KB-article open)
#   helpdesk-macros   ≤ 25,000 bytes gz  (fuse.js + cmdk; lazy on '/' macro slash-command)
#   helpdesk-tickets  ≤ 25,000 bytes gz  (TicketForm + List + Thread + ReplyComposer + useTicketChannel; lazy on auth+non-PHI)
#
# Hash-hyphen safety: per [[reference_bundle_budget_hash_hyphen]], Vite hashes
# can contain `-` (e.g. `Bzp_TJcB`). We use a regex that strips trailing
# `[A-Z0-9]`-starting segments iteratively so labels like `helpdesk-widget`
# and `helpdesk-article` are correctly recovered.
#
# Behaviour mirrors assert-clinic-bundle-budget.sh:
#  - If a chunk is missing, emit a `wave-0: …` notice and skip the per-chunk check
#    (relevant when run before this plan's components ship).
#  - On any guard violation: emit a GitHub Actions `::error::` annotation + exit 1.
#  - On all guards passing: emit one OK line per chunk + a topology-OK line.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/dist"
ASSETS_DIR="$DIST_DIR/assets"

# Phase 37 Plan 06 D-16 ceilings:
#
# HELPDESK_WIDGET_CEILING=25600 — 25 kB gz hard ceiling per D-16. The widget root
#   is fetched (when the user first opens the help launcher) on every screen
#   regardless of auth state, so it's sized like a first-paint-adjacent chunk.
#   Measured at this plan's close: ~3.9 kB gz. Headroom is generous so future
#   tweaks (better placeholder copy, single-locale i18n) don't crowd the ceiling.
HELPDESK_WIDGET_CEILING=25600
#
# HELPDESK_ARTICLE_CEILING=130000 — react-markdown@9 + remark-gfm@4 + rehype-raw@7
#   + dompurify@3 together weigh ~107 kB gz, near their published baselines. The
#   article chunk is fetched only when a user opens a KB article — never on
#   first paint. Slack until a future plan opts into a leaner renderer (e.g.
#   marked + custom sanitization) which would push this below 60 kB.
HELPDESK_ARTICLE_CEILING=130000
#
# HELPDESK_MACROS_CEILING=25000 — fuse.js@7 + cmdk@1. Measured ~9.5 kB gz at this
#   plan's close; only loads when an agent types '/' in the reply composer.
HELPDESK_MACROS_CEILING=25000
#
# HELPDESK_TICKETS_CEILING=25000 — TicketForm/TicketList/TicketThread/
#   ReplyComposer/TypingIndicator/useTicketChannel. Supabase-js bytes live in
#   the existing vendor-supabase chunk so this chunk only carries the wiring
#   (~3 kB gz at close). Generous headroom for future ticket-side features.
HELPDESK_TICKETS_CEILING=25000

PHASE_REF=".planning/phases/37-m6-helpdesk-core/37-06-PLAN.md"

if [ ! -d "$DIST_DIR" ]; then
  echo "::error::dist/ not found at $DIST_DIR — run 'npm run build' first" >&2
  exit 1
fi
if [ ! -d "$ASSETS_DIR" ]; then
  echo "::error::dist/assets not found at $ASSETS_DIR — build appears incomplete" >&2
  exit 1
fi

FAIL=0

# Iterative hash-stripper — mirrors assert-clinic-bundle-budget.sh PLUS the
# Vite-6 hash-alphabet fix.
#
# Vite-6 content hashes include `_` (e.g. `Bzp_TJcB`) — NOT just `[A-Za-z0-9-]`.
# The assert-clinic-bundle-budget.sh regex `[A-Za-z0-9]*[A-Z0-9][A-Za-z0-9]*`
# would FAIL to strip `Bzp_TJcB` because `_` is outside the char class — the
# chunk would never match the label and silently get a "wave-0 skip".
# Phase 37 fix: extend the char class to `[A-Za-z0-9_]` so underscores in the
# hash don't break the strip. Label segments remain lowercase-only so the
# `[A-Z0-9]` requirement still distinguishes hash from label segments.
# We strip up to 4 trailing `-<segment>` groups where each segment contains
# at least one uppercase letter or digit (label segments are lowercase-only:
# `widget`, `article`, etc.).
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

check_chunk_ceiling 'helpdesk-widget-*.js'  "$HELPDESK_WIDGET_CEILING"  'helpdesk-widget'
check_chunk_ceiling 'helpdesk-article-*.js' "$HELPDESK_ARTICLE_CEILING" 'helpdesk-article'
check_chunk_ceiling 'helpdesk-macros-*.js'  "$HELPDESK_MACROS_CEILING"  'helpdesk-macros'
check_chunk_ceiling 'helpdesk-tickets-*.js' "$HELPDESK_TICKETS_CEILING" 'helpdesk-tickets'

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi

echo "helpdesk bundle topology OK"
exit 0
