#!/usr/bin/env bash
#
# check-no-ads-on-excluded-surfaces.sh
#
# Phase 56 Plan 56-06 (AD-03 / T-56-16 — Layer 3 enforcement for surface exclusion).
#
# Surface-exclusion CI grep gate: fails if any excluded-surface file contains a
# comment-stripped import of an ad-serving component.
#
# Apple §5.1.3 + clinic/PHI trust boundary: clinic, share, admin, dose-log,
# and patient surfaces MUST NEVER import or render ad-serving components.
#
# Why a grep gate when canShowAds() already guards at runtime:
#   - canShowAds() can be bypassed by a developer who imports the ad component
#     directly without calling the guard.
#   - This gate is comment-stripped so eslint-disable / commented imports
#     cannot hide a violation (per feedback_negation_grep_defeated_by_comment_string).
#   - Three-layer discipline: Layer 1 (ESLint import-x/no-restricted-paths) +
#     Layer 2 (canShowAds runtime guard from 56-01) + Layer 3 (this CI grep).
#
# Strategy:
#   1. Enumerate every *.ts/*.tsx file under excluded-surface source directories
#      (clinic, admin, dashboard/share) plus dose-log / patient surface files.
#   2. For each file, slurp its contents, strip /* ... */ block comments
#      (multi-line aware via perl -0) and // line comments, then check whether
#      the comment-stripped content contains an import of an ad-serving component.
#   3. Any matching file is reported; exit 1 with ::error:: annotation.
#
# CARVEOUT: src/components/admin/growth/AdRevenueDashboardPage.tsx reads only
# the get_ad_revenue_dashboard() SECDEF RPC — it does NOT import ad-serving
# components. This gate targets ad-SERVING component imports only (the AdRenderer
# family + @/lib/ads/canShowAds), so the revenue dashboard passes cleanly.
#
# Test files + __tests__ directories are excluded — they legitimately reference
# both sides of the boundary for fixture purposes.
#
# Usage:
#   bash leanshot/scripts/check-no-ads-on-excluded-surfaces.sh [src_root]
#
# Exit codes:
#   0 — no excluded-surface file imports an ad-serving component (gate passes)
#   1 — ad-serving import detected in excluded-surface file (gate fails — block merge)
#   2 — src root not found

set -euo pipefail

# Resolve src/ root. Default = leanshot/src (relative to repo root).
# When invoked from leanshot/ cwd via ci.yml, src/ also works.
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
  echo "::error::source root not found (tried: leanshot/src, src, script-relative ../src). Pass it explicitly: bash scripts/check-no-ads-on-excluded-surfaces.sh path/to/src" >&2
  exit 2
fi

# Step 1: find all TypeScript files under excluded-surface directories.
# Excluded surfaces (from canShowAds.ts EXCLUDED_SURFACES + RESEARCH §7):
#   - clinic: src/components/clinic/
#   - admin: src/components/admin/
#   - share (dashboard): src/components/dashboard/share/
#   - share (doctor-share): src/components/share/  (SharePage, CodeEntryScreen, ShareRevokedScreen)
#   - MedicationTab (dose-log equivalent PHI context): src/components/dashboard/tabs/MedicationTab.tsx
#   Plus any file matching *patient* or *dose-log* patterns under src/
#
# Exclude test files and __tests__ directories.
FILES=$(find "$SRC_ROOT" \
  \( \
    -path "*/components/clinic/*" \
    -o -path "*/components/admin/*" \
    -o -path "*/components/dashboard/share/*" \
    -o -path "*/components/share/*" \
    -o -name "MedicationTab.tsx" \
    -o -name "*dose-log*" \
    -o -name "*patient*" \
  \) \
  \( -name "*.ts" -o -name "*.tsx" \) \
  ! -name "*.test.ts" \
  ! -name "*.test.tsx" \
  ! -path "*/__tests__/*" \
  ! -path "*/node_modules/*" \
  ! -path "*/dist/*" \
  ! -path "*/coverage/*" \
  2>/dev/null || true)

if [ -z "$FILES" ]; then
  echo "OK: no excluded-surface source files found under $SRC_ROOT — AD-03 gate trivially passes."
  exit 0
fi

# Step 2: per file, strip /* ... */ block comments and // line comments,
# then check whether the stripped content contains an ad-serving import.
# perl -0 slurps the whole file as one record so the regex matches across newlines.
#
# Forbidden pattern targets ad-SERVING component imports only:
#   - from '@/components/ads  (AdRenderer, EmbedAdSlot, PlatformAdSlot, HouseAdSlot)
#   - from '@/lib/ads/canShowAds  (runtime guard — surface code must not call this directly)
#   - from '@/lib/ads/  (any other ads lib import)
#
# The admin revenue dashboard (AdRevenueDashboardPage) does NOT match because it
# imports only from @/components/ui/ and @/lib/supabase — it never imports ad-serving.
HITS=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  STRIPPED=$(perl -0pe 's{/\*.*?\*/}{}gs; s{//[^\n]*}{}g' "$f" 2>/dev/null || cat "$f")
  # AD-03: pattern covers static imports, dynamic import() expressions, and require() calls
  # targeting ad-serving component paths.
  if echo "$STRIPPED" | grep -qE "from ['\"]@/components/ads|from ['\"]@/lib/ads/|import\(['\"]@/components/ads|import\(['\"]@/lib/ads/|require\(['\"]@/components/ads|require\(['\"]@/lib/ads/"; then
    HITS="${HITS}${f}"$'\n'
  fi
done <<< "$FILES"

if [ -z "$HITS" ]; then
  echo "OK: no ad-serving import found in excluded-surface files under $SRC_ROOT (AD-03 gate passes)."
  exit 0
fi

cat >&2 <<'EOM'
::error::FAIL: Surface-exclusion firewall violation (AD-03 — comment-stripped CI grep gate).

An excluded-surface file (clinic / admin / share / dose-log / patient / medication)
contains an import of an ad-serving component.

Apple §5.1.3 + clinic PHI trust boundary prohibit ad components on these surfaces.

This gate is comment-stripped so eslint-disable comments do NOT hide the violation.

Fix options:
  1. Remove the ad-serving import from the excluded-surface file.
  2. If the cross-read is legitimate (e.g. reading an ad revenue RPC, not rendering ads),
     use a path that does not match the ad-SERVING component import pattern.
  3. Review whether the file was misclassified (wrong directory).

Offending files (comment-stripped, excluded-surface file contains ad-serving import):
EOM
echo "$HITS" >&2
exit 1