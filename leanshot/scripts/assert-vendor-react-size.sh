#!/usr/bin/env bash
#
# assert-vendor-react-size.sh
#
# Phase 2.1 chunk-size guard. Verifies that the Vite build's manualChunks
# topology actually produced a non-trivial vendor-react chunk AND a slim
# entry chunk. This pins the topology rather than just asserting a lower
# bound on vendor-react — partial collapses (e.g. react-dom/client falling
# back into the entry while react/scheduler stays in vendor-react) are
# caught by the index-chunk ceiling.
#
# Three guards (see leanshot/.planning/phases/02.1-spa-lighthouse-perf/02.1-RESEARCH.md):
#   1. vendor-react gzipped size >= 30,000 bytes (FLOOR — catches the
#      catastrophic Phase 2 regression class where react-dom collapsed
#      back into index and vendor-react carried only scheduler at ~3 kB gz).
#   2. vendor-react gzipped size <= 80,000 bytes (CEILING — catches
#      accidental over-bundling from a too-loose regex sweeping in
#      unrelated packages).
#   3. index gzipped size <= 50,000 bytes (TOPOLOGY PIN — Phase 2 baseline
#      was 69.5 kB gz; post-fix target is 25-35 kB gz).
#
# On any guard violation: emit a GitHub Actions ::error:: annotation and
# exit 1. On all guards passing: emit a single OK line and exit 0.
#
# The script tolerates being run from either the repo root (as
# `bash leanshot/scripts/assert-vendor-react-size.sh`) or from inside
# leanshot/ (as `bash scripts/assert-vendor-react-size.sh`). It resolves
# the dist directory relative to its own location, NOT cwd.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/dist"
ASSETS_DIR="$DIST_DIR/assets"

VR_FLOOR=30000
VR_CEILING=80000
IDX_CEILING=50000

RESEARCH_REF=".planning/phases/02.1-spa-lighthouse-perf/02.1-RESEARCH.md"

if [ ! -d "$DIST_DIR" ]; then
  echo "::error::dist/ not found at $DIST_DIR — run 'npm run build' first" >&2
  exit 1
fi

if [ ! -d "$ASSETS_DIR" ]; then
  echo "::error::dist/assets not found at $ASSETS_DIR — build appears incomplete" >&2
  exit 1
fi

# Locate vendor-react chunk (exclude .map source maps).
# Use mapfile so we can count and disambiguate matches deterministically.
VR_MATCHES=()
while IFS= read -r f; do
  VR_MATCHES+=("$f")
done < <(find "$ASSETS_DIR" -maxdepth 1 -type f -name 'vendor-react-*.js' ! -name '*.map' 2>/dev/null)

VR_COUNT=${#VR_MATCHES[@]}
if [ "$VR_COUNT" -eq 0 ]; then
  echo "::error::no vendor-react-*.js chunk emitted in $ASSETS_DIR — manualChunks may be misconfigured. See $RESEARCH_REF" >&2
  exit 1
fi
if [ "$VR_COUNT" -gt 1 ]; then
  echo "::error::expected exactly one vendor-react-*.js chunk, found $VR_COUNT: ${VR_MATCHES[*]}" >&2
  exit 1
fi
VR_FILE="${VR_MATCHES[0]}"

# Locate index chunk.
IDX_MATCHES=()
while IFS= read -r f; do
  IDX_MATCHES+=("$f")
done < <(find "$ASSETS_DIR" -maxdepth 1 -type f -name 'index-*.js' ! -name '*.map' 2>/dev/null)

IDX_COUNT=${#IDX_MATCHES[@]}
if [ "$IDX_COUNT" -eq 0 ]; then
  echo "::error::no index-*.js chunk emitted in $ASSETS_DIR" >&2
  exit 1
fi
if [ "$IDX_COUNT" -gt 1 ]; then
  echo "::error::expected exactly one index-*.js chunk, found $IDX_COUNT: ${IDX_MATCHES[*]}" >&2
  exit 1
fi
IDX_FILE="${IDX_MATCHES[0]}"

# Compute gzipped sizes.
VR_SIZE=$(gzip -c "$VR_FILE" | wc -c | tr -d '[:space:]')
IDX_SIZE=$(gzip -c "$IDX_FILE" | wc -c | tr -d '[:space:]')

FAIL=0

if [ "$VR_SIZE" -lt "$VR_FLOOR" ]; then
  echo "::error::vendor-react chunk is only $VR_SIZE bytes gzipped (floor $VR_FLOOR) — react-dom likely collapsed back into index. See $RESEARCH_REF" >&2
  FAIL=1
fi

if [ "$VR_SIZE" -gt "$VR_CEILING" ]; then
  echo "::error::vendor-react chunk is $VR_SIZE bytes gzipped (ceiling $VR_CEILING) — likely accidental over-bundling; check manualChunks regex for unintended matches" >&2
  FAIL=1
fi

if [ "$IDX_SIZE" -gt "$IDX_CEILING" ]; then
  echo "::error::index chunk is $IDX_SIZE bytes gzipped (ceiling $IDX_CEILING) — likely react-dom or other vendor code collapsed back into entry. See $RESEARCH_REF" >&2
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi

echo "vendor-react chunk OK: $VR_SIZE bytes gzipped (floor $VR_FLOOR, ceiling $VR_CEILING); index chunk OK: $IDX_SIZE bytes gzipped (ceiling $IDX_CEILING)"
exit 0
