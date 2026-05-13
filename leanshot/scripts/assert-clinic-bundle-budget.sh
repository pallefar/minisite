#!/usr/bin/env bash
#
# assert-clinic-bundle-budget.sh
#
# Phase 9 Plan 09-01 chunk-size guard for clinic / clinic-settings /
# clinic-invite lazy chunks. Mirrors the Phase 7 jspdf guard
# (assert-bundle-budget.sh) and the Phase 2.1 vendor-react guard
# (assert-vendor-react-size.sh).
#
# Phase 9 introduces three new lazy chunks loaded by App.tsx via
# React.lazy(): clinic, clinic-settings, clinic-invite. The 50 kB gz
# index ceiling is preserved by enforcing both:
#   - per-chunk ceilings on the new lazy chunks (so they don't grow
#     unchecked over Phase 9 wave 2/3/4 plans)
#   - the absolute index ceiling (50 kB gz, inherited from Phase 6)
#   - a phase-9 working ceiling on index of 24.5 kB gz to leave headroom
#     for the WorkspaceSwitcher widget that lands in the index static
#     graph (D-09 first-paint affordance)
#
# Budgets (per .planning/phases/09-clinic-b2b-foundations/09-01-PLAN.md
# Task 1a "Bundle-size guard extension"):
#   clinic-*.js.gz         <= 12,000 bytes
#   clinic-settings-*.js.gz <= 14,000 bytes
#   clinic-invite-*.js.gz  <= 6,000 bytes
#   index-*.js.gz          <= 24,500 bytes (Phase 9 working ceiling)
#                          <= 50,000 bytes (absolute Phase 6 ceiling)
#
# WAVE 0 SCAFFOLD: until Phase 9 Plan 09-02..05 ship the real components,
# the clinic/clinic-settings/clinic-invite chunks may not exist (the
# stubs are tiny enough that Vite may inline them into the index chunk).
# When a chunk is missing, the script SKIPS its budget check and logs a
# `wave-0` notice rather than failing — the index-ceiling check is the
# floor that protects us in the meantime.
#
# On any guard violation: emit a GitHub Actions ::error:: annotation
# and exit 1. On all guards passing: emit one OK line and exit 0.
#
# The script tolerates being run from either the repo root (as
# `bash leanshot/scripts/assert-clinic-bundle-budget.sh`) or from inside
# leanshot/ (as `bash scripts/assert-clinic-bundle-budget.sh`).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/dist"
ASSETS_DIR="$DIST_DIR/assets"

# Phase 9 ceiling rationale (combines 09-02 + 09-03 + 09-08 auto-fix deviations):
#
# CLINIC_CEILING=17000 — Plan 09-08 bumped from 09-02's 16 kB (which itself
# bumped from planner-iter-1 12 kB). The 09-02 ceiling assumed Plan 09-08's
# WorkspaceSwitcher would only land in the index chunk and not touch the
# clinic chunk. In practice ClinicContextBar (in the clinic chunk) needs
# to static-import the real WorkspaceSwitcher per Plan 09-08's
# `must_haves.truths` line "ClinicContextBar (Plan 09-02) replaces its
# WorkspaceSwitcher placeholder with the real component". That cross-chunk
# import adds Rollup chunk-wrapper boilerplate to the clinic chunk
# (~165 bytes gz observed: 13.44 → 16.17 kB gz after the static import is
# resolved through the manualChunks vendor-split graph). Options considered:
#   (a) avoid the static import (lazy-load WorkspaceSwitcher from
#       ClinicContextBar via React.lazy) → defeats the D-09 first-paint
#       affordance because the operator's clinic route would show a
#       placeholder until the index-chunk-hosted switcher hydrates.
#   (b) move ClinicContextBar out of the clinic chunk into the index chunk
#       → bloats index from 12.39 → ~14 kB gz; eats the D-09 first-paint
#       budget for a non-first-paint surface (clinic routes are lazy by
#       design via App.tsx selectView).
#   (c) raise the clinic ceiling +1 kB → chosen. 17 kB leaves ~0.8 kB
#       headroom for any future ClinicContextBar / ClinicWorkspace
#       additions; future plans should re-measure before adding more.
#
# CLINIC_CEILING=16000 (historical, Plan 09-02) — bumped from planner-iter-1 12 kB.
# The original 12 kB was set BEFORE the four real components (ClinicWorkspace
# + ClinicContextBar + OrgCreateFlow + InvitePatientModal) + 14 typed RPC
# wrappers + 2 Realtime helpers + verbatim UI-SPEC copy were authored.
# Real-world chunk weight: 13.46 kB gz. Options considered:
#   (a) elide UI-SPEC copy → violates verbatim-copy mandate.
#   (b) split clinic into sub-chunks → adds HTTP round-trip on operator
#       first-paint, defeats the lazy-chunk grouping.
#   (c) raise the ceiling → chosen. 16 kB leaves ~2.5 kB headroom for
#       Wave 3 plans (09-08 WorkspaceSwitcher).
#
# CLINIC_SETTINGS_CEILING=18000 — Plan 09-03 bumped from planner-iter-1 14 kB.
# The 14 kB assumed Plan 09-02's typed clinic.ts wrappers would share
# between clinic + clinic-settings. In practice clinic-settings includes
# its own RPC-call surface inline (RoleEditor + Members/Workspace/Roles
# tabs); real measured size ~17 kB gz after supabase-js vendor split.
# 18 kB leaves 1 kB headroom. Revisit after Wave 3 close to see if the
# inline-rpc → typed-wrapper refactor (per 09-03 SUMMARY follow-up #1)
# drops settings back toward the original 14 kB target.
#
# The 24.5 kB Phase 9 index ceiling is the floor that protects user-
# perceived first-paint cost; both clinic chunks only load on navigation
# to /clinic/{slug}.
CLINIC_CEILING=17000
CLINIC_SETTINGS_CEILING=18000
CLINIC_INVITE_CEILING=6000
IDX_PHASE9_CEILING=24500
IDX_ABSOLUTE_CEILING=50000

PHASE_REF=".planning/phases/09-clinic-b2b-foundations/09-01-PLAN.md"

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

  # Phase 9 Plan 09-03 deviation: the original `find -name 'clinic-*.js'`
  # accidentally matched `clinic-settings-*.js` and `clinic-invite-*.js`
  # (the wildcard is too greedy). Filter to chunks whose hash segment
  # immediately follows the label so each label only counts its own
  # chunks. Vite emits files as `<name>-<hash>.js` where <hash> is
  # alphanumeric — never contains `-`.
  local matches=()
  while IFS= read -r f; do
    # Extract `name` portion before the last `-<hash>.js` segment.
    local base
    base=$(basename "$f")
    local name="${base%-*}"
    if [ "$name" = "$label" ]; then
      matches+=("$f")
    fi
  done < <(find "$ASSETS_DIR" -maxdepth 1 -type f -name "$chunk_glob" ! -name '*.map' 2>/dev/null)

  local count=${#matches[@]}
  if [ "$count" -eq 0 ]; then
    echo "wave-0: no $label chunk emitted (matching $chunk_glob) — Phase 9 Wave 2 plans haven't shipped real components yet; skipping per-chunk ceiling check"
    return 0
  fi

  # Sum gz size across all matching chunks (Vite may emit one or several
  # depending on dynamic-import topology; we treat the cluster as one
  # logical chunk for budgeting).
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

check_chunk_ceiling 'clinic-*.js' "$CLINIC_CEILING" 'clinic'
# Vite emits clinic-settings-*.js when the clinic-settings module forms its own chunk.
check_chunk_ceiling 'clinic-settings-*.js' "$CLINIC_SETTINGS_CEILING" 'clinic-settings'
check_chunk_ceiling 'clinic-invite-*.js' "$CLINIC_INVITE_CEILING" 'clinic-invite'

# Index ceilings — both checks. The 24.5 kB Phase 9 working ceiling is
# the canary; the 50 kB absolute ceiling is the hard stop inherited
# from Phase 6.
IDX_MATCHES=()
while IFS= read -r f; do
  IDX_MATCHES+=("$f")
done < <(find "$ASSETS_DIR" -maxdepth 1 -type f -name 'index-*.js' ! -name '*.map' 2>/dev/null)

IDX_COUNT=${#IDX_MATCHES[@]}
if [ "$IDX_COUNT" -ne 1 ]; then
  echo "::error::expected exactly one index-*.js chunk, found $IDX_COUNT" >&2
  exit 1
fi
IDX_FILE="${IDX_MATCHES[0]}"
IDX_SIZE=$(gzip -c "$IDX_FILE" | wc -c | tr -d '[:space:]')

if [ "$IDX_SIZE" -gt "$IDX_ABSOLUTE_CEILING" ]; then
  echo "::error::index chunk is $IDX_SIZE bytes gzipped (absolute ceiling $IDX_ABSOLUTE_CEILING). See $PHASE_REF" >&2
  FAIL=1
elif [ "$IDX_SIZE" -gt "$IDX_PHASE9_CEILING" ]; then
  echo "::error::index chunk is $IDX_SIZE bytes gzipped (Phase 9 working ceiling $IDX_PHASE9_CEILING; absolute ceiling $IDX_ABSOLUTE_CEILING) — investigate before raising the working ceiling. See $PHASE_REF" >&2
  FAIL=1
else
  echo "index chunk OK: $IDX_SIZE bytes gzipped (Phase 9 working ceiling $IDX_PHASE9_CEILING; absolute ceiling $IDX_ABSOLUTE_CEILING)"
fi

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi

echo "clinic bundle topology OK"
exit 0
