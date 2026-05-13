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

CLINIC_CEILING=12000
CLINIC_SETTINGS_CEILING=14000
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

  local matches=()
  while IFS= read -r f; do
    matches+=("$f")
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
