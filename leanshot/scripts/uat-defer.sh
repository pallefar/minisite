#!/usr/bin/env bash
# uat-defer.sh — open a GitHub issue tagged `v1.4-launch-deferral` for a Phase 70 signal.
# Usage: scripts/uat-defer.sh <signal-slug> <reason>
# Per .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-CONTEXT.md Area 3.
set -euo pipefail

if [ "$#" -lt 2 ] || [ -z "${1:-}" ] || [ -z "${2:-}" ]; then
  echo "Usage: $0 <signal-slug> <reason>" >&2
  echo "Example: $0 trustpilot-vendor-claimed 'claim takes 5+ business days; fallback ships ok'" >&2
  exit 2
fi

SLUG="$1"
REASON="$2"
PLAN_DIR=".planning/phases/70-consolidated-uat-v1-4-launch-gate"
PLAN_FILE=$(git grep -l "$SLUG" "$PLAN_DIR"/*.md 2>/dev/null | head -1 || true)
[ -n "$PLAN_FILE" ] || PLAN_FILE="(plan-not-detected — slug may not match any 70-NN-PLAN-*.md)"
DEFERRED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

URL=$(gh issue create \
  --label v1.4-launch-deferral \
  --title "UAT defer: $SLUG" \
  --body "Deferred from Phase 70 (v1.4 Launch Gate consolidated UAT).

Signal: $SLUG
Reason: $REASON
Plan: $PLAN_FILE
Deferred-at: $DEFERRED_AT
Deferred-by: karsten.haldan@gmail.com

Re-evaluate before next milestone close. If this signal becomes a hard blocker, escalate by re-opening Phase 70 sign-off for this fixture group.")

echo "$URL"
