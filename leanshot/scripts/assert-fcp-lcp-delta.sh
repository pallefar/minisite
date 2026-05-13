#!/usr/bin/env bash
# ============================================================================
# assert-fcp-lcp-delta.sh — Phase 13 PR-1 perf gate (D-07 + D-13)
# ----------------------------------------------------------------------------
# Compares the median FCP + LCP values from a Lighthouse CI run against the
# pre-Phase-13 baseline committed at
#   leanshot/.planning/phases/13-design-system-v2-rollout/13-FCP-BASELINE.json
# and exits non-zero if either metric exceeds the baseline by more than
# `tolerance_pct` (read from the baseline JSON — NOT hardcoded so future
# phases can re-baseline by editing the JSON only).
#
# Usage (CI):
#   bash leanshot/scripts/assert-fcp-lcp-delta.sh                 \
#        [--lhci-dir=.lighthouseci]                                \
#        [--baseline=leanshot/.planning/phases/13-design-system-v2-rollout/13-FCP-BASELINE.json]
#
# Usage (smoke test):
#   bash leanshot/scripts/assert-fcp-lcp-delta.sh --dry-run \
#        --current-fcp=586 --current-lcp=594
#   → exit 0 if FCP/LCP within tolerance of baseline
#   → exit 1 otherwise (with a clear diagnostic)
#
# Reads:
#   - $BASELINE — schema: { fcp_ms, lcp_ms, tolerance_pct, captured_sha, ... }
#   - $LHCI_DIR/lhr-*.json — Lighthouse audit reports written by `lhci collect`
#
# Math:
#   delta_pct = (current - baseline) / baseline * 100
#   Positive delta means slower (regression). Negative delta is a speedup
#   (always passes — speedups are good).
# ============================================================================

set -euo pipefail

# -------- argv parse --------
LHCI_DIR=".lighthouseci"
BASELINE="leanshot/.planning/phases/13-design-system-v2-rollout/13-FCP-BASELINE.json"
DRY_RUN=0
DRY_FCP=""
DRY_LCP=""

for arg in "$@"; do
  case "$arg" in
    --lhci-dir=*)     LHCI_DIR="${arg#*=}" ;;
    --baseline=*)     BASELINE="${arg#*=}" ;;
    --dry-run)        DRY_RUN=1 ;;
    --current-fcp=*)  DRY_FCP="${arg#*=}" ;;
    --current-lcp=*)  DRY_LCP="${arg#*=}" ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

# -------- prereqs --------
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required" >&2; exit 2; }
command -v awk >/dev/null 2>&1 || { echo "ERROR: awk is required" >&2; exit 2; }

[ -f "$BASELINE" ] || { echo "ERROR: baseline JSON not found at $BASELINE" >&2; exit 2; }

# -------- read baseline --------
BASELINE_FCP=$(jq -r '.fcp_ms' "$BASELINE")
BASELINE_LCP=$(jq -r '.lcp_ms' "$BASELINE")
TOLERANCE_PCT=$(jq -r '.tolerance_pct' "$BASELINE")
CAPTURED_SHA=$(jq -r '.captured_sha' "$BASELINE")

if ! [[ "$BASELINE_FCP" =~ ^[0-9]+$ ]] || [ "$BASELINE_FCP" -le 0 ]; then
  echo "ERROR: baseline fcp_ms is not a positive integer ($BASELINE_FCP)" >&2
  exit 2
fi
if ! [[ "$BASELINE_LCP" =~ ^[0-9]+$ ]] || [ "$BASELINE_LCP" -le 0 ]; then
  echo "ERROR: baseline lcp_ms is not a positive integer ($BASELINE_LCP)" >&2
  exit 2
fi
if ! [[ "$TOLERANCE_PCT" =~ ^[0-9]+$ ]] || [ "$TOLERANCE_PCT" -le 0 ]; then
  echo "ERROR: baseline tolerance_pct is not a positive integer ($TOLERANCE_PCT)" >&2
  exit 2
fi

# -------- resolve current FCP / LCP --------
if [ "$DRY_RUN" -eq 1 ]; then
  if [ -z "$DRY_FCP" ] || [ -z "$DRY_LCP" ]; then
    echo "ERROR: --dry-run requires --current-fcp=<ms> --current-lcp=<ms>" >&2
    exit 2
  fi
  CURRENT_FCP="$DRY_FCP"
  CURRENT_LCP="$DRY_LCP"
else
  [ -d "$LHCI_DIR" ] || { echo "ERROR: LHCI output dir not found at $LHCI_DIR" >&2; exit 2; }

  # Collect all lhr-*.json files. Need at least 1.
  shopt -s nullglob
  LHR_FILES=("$LHCI_DIR"/lhr-*.json)
  shopt -u nullglob
  if [ "${#LHR_FILES[@]}" -eq 0 ]; then
    echo "ERROR: no lhr-*.json files in $LHCI_DIR" >&2
    exit 2
  fi

  # Extract numeric FCP/LCP from each report, median, round to integer.
  CURRENT_FCP=$(jq -s '
    map(.audits["first-contentful-paint"].numericValue)
    | sort
    | .[length / 2 | floor]
    | round
  ' "${LHR_FILES[@]}")
  CURRENT_LCP=$(jq -s '
    map(.audits["largest-contentful-paint"].numericValue)
    | sort
    | .[length / 2 | floor]
    | round
  ' "${LHR_FILES[@]}")
fi

if ! [[ "$CURRENT_FCP" =~ ^[0-9]+$ ]] || [ "$CURRENT_FCP" -le 0 ]; then
  echo "ERROR: current FCP not a positive integer: $CURRENT_FCP" >&2
  exit 2
fi
if ! [[ "$CURRENT_LCP" =~ ^[0-9]+$ ]] || [ "$CURRENT_LCP" -le 0 ]; then
  echo "ERROR: current LCP not a positive integer: $CURRENT_LCP" >&2
  exit 2
fi

# -------- compute deltas (awk for float arithmetic) --------
FCP_DELTA_PCT=$(awk -v c="$CURRENT_FCP" -v b="$BASELINE_FCP" 'BEGIN{printf "%.2f", (c-b)/b*100}')
LCP_DELTA_PCT=$(awk -v c="$CURRENT_LCP" -v b="$BASELINE_LCP" 'BEGIN{printf "%.2f", (c-b)/b*100}')

# -------- check against tolerance --------
# A positive delta > tolerance_pct fails. Negative (speedup) always passes.
FCP_FAIL=$(awk -v d="$FCP_DELTA_PCT" -v t="$TOLERANCE_PCT" 'BEGIN{print (d > t) ? 1 : 0}')
LCP_FAIL=$(awk -v d="$LCP_DELTA_PCT" -v t="$TOLERANCE_PCT" 'BEGIN{print (d > t) ? 1 : 0}')

echo "=== Phase 13 FCP+LCP delta gate (D-07 + D-13) ==="
echo "  baseline SHA:   $CAPTURED_SHA"
echo "  tolerance:      ±${TOLERANCE_PCT}% (positive delta = regression)"
echo "  FCP baseline:   ${BASELINE_FCP} ms"
echo "  FCP current:    ${CURRENT_FCP} ms"
echo "  FCP delta:      ${FCP_DELTA_PCT}%"
echo "  LCP baseline:   ${BASELINE_LCP} ms"
echo "  LCP current:    ${CURRENT_LCP} ms"
echo "  LCP delta:      ${LCP_DELTA_PCT}%"

if [ "$FCP_FAIL" -eq 1 ] || [ "$LCP_FAIL" -eq 1 ]; then
  echo ""
  echo "FAIL: perf regression — Phase 13 token/font swap exceeded ${TOLERANCE_PCT}% tolerance."
  [ "$FCP_FAIL" -eq 1 ] && echo "  - FCP regressed by ${FCP_DELTA_PCT}% (baseline ${BASELINE_FCP} ms → current ${CURRENT_FCP} ms)"
  [ "$LCP_FAIL" -eq 1 ] && echo "  - LCP regressed by ${LCP_DELTA_PCT}% (baseline ${BASELINE_LCP} ms → current ${CURRENT_LCP} ms)"
  echo ""
  echo "Investigate paper-grain SVG overlay (LCP risk) and Geist webfont load (FCP risk)."
  echo "If this is intentional (e.g., a future phase wants to re-baseline), update"
  echo "  ${BASELINE} and explain in the PR description."
  exit 1
fi

echo ""
echo "PASS: both FCP (${FCP_DELTA_PCT}%) and LCP (${LCP_DELTA_PCT}%) within ±${TOLERANCE_PCT}% tolerance."
exit 0
