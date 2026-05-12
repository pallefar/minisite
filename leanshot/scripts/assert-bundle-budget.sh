#!/usr/bin/env bash
#
# assert-bundle-budget.sh
#
# Phase 7 Plan 07-06 chunk-shape guard for jsPDF + jspdf-autotable.
# COMPL-06 ships a PDF export that dynamic-imports jspdf inside the
# Settings Export-PDF click handler. The bundle ceiling enforced by
# assert-vendor-react-size.sh (index gz ≤ 50,000 bytes) holds only if
# jspdf stays in its own lazy chunk. This script pins that topology:
#
#   1. dist/assets/jspdf-*.js chunk MUST exist (separate from index).
#   2. jspdf chunk gzipped size MUST be > 20,000 bytes (sanity floor —
#      if it's tiny, jsPDF was tree-shaken away → PDF export is broken).
#   3. The index chunk MUST NOT contain the literal `jsPDF` identifier
#      (presence proves a static import landed jsPDF in the entry chunk).
#
# On any guard violation: emit a GitHub Actions ::error:: annotation
# and exit 1. On all guards passing: emit a single OK line and exit 0.
#
# See memory project_phase5_bundle_regression.md for the original
# regression class this script defends against.
#
# The script tolerates being run from either the repo root (as
# `bash leanshot/scripts/assert-bundle-budget.sh`) or from inside
# leanshot/ (as `bash scripts/assert-bundle-budget.sh`). It resolves
# the dist directory relative to its own location, NOT cwd.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/dist"
ASSETS_DIR="$DIST_DIR/assets"

JSPDF_FLOOR=20000

PHASE_REF=".planning/phases/07-compliance-foundations-legal-counsel-led/07-06-PLAN.md"

if [ ! -d "$DIST_DIR" ]; then
  echo "::error::dist/ not found at $DIST_DIR — run 'npm run build' first" >&2
  exit 1
fi

if [ ! -d "$ASSETS_DIR" ]; then
  echo "::error::dist/assets not found at $ASSETS_DIR — build appears incomplete" >&2
  exit 1
fi

# Locate jspdf chunk (exclude .map source maps). Vite may emit jspdf alone OR
# jspdf + jspdf-autotable together — we accept any file whose basename starts
# with `jspdf` (covers both `jspdf-XXXX.js` and `jspdf-autotable-XXXX.js`).
JSPDF_MATCHES=()
while IFS= read -r f; do
  JSPDF_MATCHES+=("$f")
done < <(find "$ASSETS_DIR" -maxdepth 1 -type f -name 'jspdf*.js' ! -name '*.map' 2>/dev/null)

JSPDF_COUNT=${#JSPDF_MATCHES[@]}
if [ "$JSPDF_COUNT" -eq 0 ]; then
  echo "::error::no jspdf*.js chunk emitted in $ASSETS_DIR — jspdf may have been static-imported into the index chunk OR tree-shaken away. See $PHASE_REF" >&2
  exit 1
fi

# Sum gzipped size across all jspdf-*.js chunks (Vite may emit jspdf +
# jspdf-autotable separately or merge them; either is acceptable).
TOTAL_JSPDF=0
for f in "${JSPDF_MATCHES[@]}"; do
  sz=$(gzip -c "$f" | wc -c | tr -d '[:space:]')
  TOTAL_JSPDF=$((TOTAL_JSPDF + sz))
done

if [ "$TOTAL_JSPDF" -lt "$JSPDF_FLOOR" ]; then
  echo "::error::jspdf chunk(s) only $TOTAL_JSPDF bytes gzipped (floor $JSPDF_FLOOR) — jspdf was likely tree-shaken or stub-replaced. Phase 7 Plan 07-06 expects a real jsPDF runtime. See $PHASE_REF" >&2
  exit 1
fi

# Final cross-check: verify jspdf is NOT in the index chunk by grepping the
# index chunk source for the jsPDF API surface name. This is a coarse signal
# (a comment or string could falsely match), but a direct static import would
# absolutely include the constructor name.
IDX_MATCHES=()
while IFS= read -r f; do
  IDX_MATCHES+=("$f")
done < <(find "$ASSETS_DIR" -maxdepth 1 -type f -name 'index-*.js' ! -name '*.map' 2>/dev/null)

if [ ${#IDX_MATCHES[@]} -eq 1 ]; then
  IDX_FILE="${IDX_MATCHES[0]}"
  # The jsPDF constructor identifier appears uniquely in the runtime source.
  # If we see it in the index chunk, jspdf was statically imported somewhere.
  if grep -q "jsPDF" "$IDX_FILE"; then
    echo "::error::index chunk ($IDX_FILE) contains 'jsPDF' identifier — jspdf was statically imported, regressing the index gz ceiling. Move the import to a dynamic await import('jspdf') inside a click handler. See $PHASE_REF" >&2
    exit 1
  fi
fi

echo "jspdf bundle topology OK: $JSPDF_COUNT chunk(s), total gz $TOTAL_JSPDF bytes (floor $JSPDF_FLOOR); index chunk free of jsPDF identifier"
exit 0
