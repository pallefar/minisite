#!/usr/bin/env bash
# Phase 67 Plan 67-04 — Seed PostHog funnel-break Insights + Subscriptions (OPS-05).
#
# Usage:
#   POSTHOG_PERSONAL_API_KEY=phx_... \
#   POSTHOG_PROJECT_ID=140479 \
#   bash scripts/posthog/seed-funnel-alerts.sh
#
# Optional:
#   POSTHOG_HOST=https://app.posthog.com           # default
#   POSTHOG_FUNNELS_JSON=scripts/posthog/funnel-alerts.json  # default
#   DRY_RUN=1                                       # print actions only, no POST
#
# Behavior:
#   1. Reads funnel-alerts.json (3 funnel definitions: activation / payment / signup).
#   2. For each funnel:
#      a. GET /api/projects/{id}/insights/?search={name} — skip if a funnel with that
#         exact name already exists (idempotent re-run).
#      b. POST /api/projects/{id}/insights/ to create the funnel insight.
#      c. Resolve the Slack destination by name (looked up at start; aborts if missing).
#      d. POST /api/projects/{id}/subscriptions/ to attach the WoW-drop alert to the
#         insight, with the resolved destination + threshold from JSON.
#   3. Exit 0 on success; non-zero if any creation fails or destination is missing.
#
# Security:
#   - POSTHOG_PERSONAL_API_KEY value is NEVER echoed; only used as Authorization bearer.
#   - JSON payloads are constructed with jq from the manifest file — no user input.
#
# Operator: see leanshot/.planning/runbooks/observability.md for the full playbook.

set -euo pipefail

# ---------------------------------------------------------------------------
# Config + env validation
# ---------------------------------------------------------------------------

POSTHOG_HOST="${POSTHOG_HOST:-https://app.posthog.com}"
POSTHOG_FUNNELS_JSON="${POSTHOG_FUNNELS_JSON:-scripts/posthog/funnel-alerts.json}"
DRY_RUN="${DRY_RUN:-0}"

if [[ -z "${POSTHOG_PERSONAL_API_KEY:-}" ]]; then
  echo "FATAL: POSTHOG_PERSONAL_API_KEY env var is required." >&2
  echo "  Create one at: ${POSTHOG_HOST}/settings/user-api-keys" >&2
  exit 2
fi

if [[ -z "${POSTHOG_PROJECT_ID:-}" ]]; then
  echo "FATAL: POSTHOG_PROJECT_ID env var is required (LeanShot prod = 140479)." >&2
  exit 2
fi

if [[ ! -f "$POSTHOG_FUNNELS_JSON" ]]; then
  echo "FATAL: funnel manifest not found at $POSTHOG_FUNNELS_JSON" >&2
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "FATAL: jq is required. Install with: brew install jq" >&2
  exit 2
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "FATAL: curl is required." >&2
  exit 2
fi

API_BASE="${POSTHOG_HOST%/}/api/projects/${POSTHOG_PROJECT_ID}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# ph_curl METHOD PATH [JSON_BODY] — wraps curl with auth + JSON content type.
# Echoes response body on stdout; sets PH_LAST_STATUS in env.
PH_LAST_STATUS=0
ph_curl() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local url="${API_BASE}${path}"
  local tmp
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' RETURN

  if [[ -n "$body" ]]; then
    PH_LAST_STATUS=$(curl -sS -o "$tmp" -w '%{http_code}' \
      -X "$method" "$url" \
      -H "Authorization: Bearer ${POSTHOG_PERSONAL_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "$body")
  else
    PH_LAST_STATUS=$(curl -sS -o "$tmp" -w '%{http_code}' \
      -X "$method" "$url" \
      -H "Authorization: Bearer ${POSTHOG_PERSONAL_API_KEY}")
  fi

  cat "$tmp"
}

resolve_destination_id() {
  local name="$1"
  # PostHog subscriptions can target Slack channels via integration objects.
  # Look up integrations of kind=slack and find the one named `name`.
  local resp
  resp=$(ph_curl GET "/integrations/" "")
  if [[ "$PH_LAST_STATUS" -ge 400 ]]; then
    echo "" # caller will treat empty as not-found
    return 0
  fi
  echo "$resp" | jq -r --arg n "$name" '.results[]? | select(.kind=="slack" and .display_name==$n) | .id' | head -n1
}

find_existing_insight_id() {
  local name="$1"
  local resp
  # PostHog supports ?search=, but we filter client-side for exact name match.
  resp=$(ph_curl GET "/insights/?search=$(printf '%s' "$name" | jq -sRr @uri)" "")
  if [[ "$PH_LAST_STATUS" -ge 400 ]]; then
    echo ""
    return 0
  fi
  echo "$resp" | jq -r --arg n "$name" '.results[]? | select(.name==$n) | .id' | head -n1
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

echo "PostHog seed-funnel-alerts — project=${POSTHOG_PROJECT_ID} host=${POSTHOG_HOST}"
[[ "$DRY_RUN" == "1" ]] && echo "(DRY_RUN=1 — no POST will be sent)"

DESTINATION_NAME=$(jq -r '.destination_name' "$POSTHOG_FUNNELS_JSON")
WOW_THRESHOLD=$(jq -r '.wow_drop_pct_threshold' "$POSTHOG_FUNNELS_JSON")
FREQUENCY=$(jq -r '.frequency' "$POSTHOG_FUNNELS_JSON")

echo "Resolving Slack destination by name: '$DESTINATION_NAME' ..."
DESTINATION_ID=""
if [[ "$DRY_RUN" != "1" ]]; then
  DESTINATION_ID=$(resolve_destination_id "$DESTINATION_NAME")
  if [[ -z "$DESTINATION_ID" ]]; then
    echo "FATAL: Slack destination '$DESTINATION_NAME' not found in project $POSTHOG_PROJECT_ID." >&2
    echo "  Create it first: ${POSTHOG_HOST}/project/${POSTHOG_PROJECT_ID}/pipeline/destinations" >&2
    echo "  (Add a Slack integration named exactly '$DESTINATION_NAME'.)" >&2
    exit 3
  fi
  echo "  resolved destination_id=$DESTINATION_ID"
else
  DESTINATION_ID="DRY_RUN_DESTINATION_ID"
fi

FAILED=0
CREATED=0
SKIPPED=0

# Iterate funnels
NUM=$(jq '.funnels | length' "$POSTHOG_FUNNELS_JSON")
for i in $(seq 0 $((NUM - 1))); do
  FUNNEL_NAME=$(jq -r ".funnels[$i].name" "$POSTHOG_FUNNELS_JSON")
  FUNNEL_DESC=$(jq -r ".funnels[$i].description" "$POSTHOG_FUNNELS_JSON")
  FUNNEL_FILTERS=$(jq -c ".funnels[$i].filters" "$POSTHOG_FUNNELS_JSON")
  ALERT_NAME=$(jq -r ".funnels[$i].alert.name" "$POSTHOG_FUNNELS_JSON")

  echo ""
  echo "[$((i + 1))/$NUM] $FUNNEL_NAME"

  # Idempotency: check for existing insight by exact name
  EXISTING_ID=""
  if [[ "$DRY_RUN" != "1" ]]; then
    EXISTING_ID=$(find_existing_insight_id "$FUNNEL_NAME")
  fi

  if [[ -n "$EXISTING_ID" ]]; then
    echo "  Insight already exists (id=$EXISTING_ID). Skipping insight creation."
    SKIPPED=$((SKIPPED + 1))
    INSIGHT_ID="$EXISTING_ID"
  else
    INSIGHT_BODY=$(jq -n \
      --arg name "$FUNNEL_NAME" \
      --arg desc "$FUNNEL_DESC" \
      --argjson filters "$FUNNEL_FILTERS" \
      '{name: $name, description: $desc, filters: $filters, saved: true}')

    if [[ "$DRY_RUN" == "1" ]]; then
      echo "  (DRY_RUN) Would POST /insights/ with name='$FUNNEL_NAME'"
      INSIGHT_ID="DRY_RUN_INSIGHT_ID"
    else
      RESP=$(ph_curl POST "/insights/" "$INSIGHT_BODY")
      if [[ "$PH_LAST_STATUS" -ge 400 ]]; then
        echo "  FAILED to create insight (status=$PH_LAST_STATUS): $RESP" >&2
        FAILED=$((FAILED + 1))
        continue
      fi
      INSIGHT_ID=$(echo "$RESP" | jq -r '.id // .short_id')
      CREATED=$((CREATED + 1))
      echo "  Created insight id=$INSIGHT_ID"
    fi
  fi

  # Attach subscription / alert
  # PostHog subscription payload: name + target_type=slack + target_value=channel
  # + insight=<id> + frequency=daily. Threshold is encoded in `target_value`'s
  # alert config (PostHog Alerts API uses a separate /alerts/ endpoint on newer
  # versions; we issue both /subscriptions/ for delivery + alert metadata).
  SUB_BODY=$(jq -n \
    --arg name "$ALERT_NAME" \
    --arg freq "$FREQUENCY" \
    --argjson insight_id "${INSIGHT_ID:-0}" \
    --argjson dest_id "$([[ "$DRY_RUN" == "1" ]] && echo 0 || echo "$DESTINATION_ID")" \
    --argjson threshold "$WOW_THRESHOLD" \
    '{
      title: $name,
      insight: $insight_id,
      target_type: "slack",
      target_value: ($dest_id | tostring),
      frequency: $freq,
      interval: 1,
      condition: {
        kind: "absolute_decrease",
        threshold_pct: $threshold,
        comparison: "week_over_week"
      }
    }')

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "  (DRY_RUN) Would POST /subscriptions/ with alert='$ALERT_NAME' threshold=${WOW_THRESHOLD}%"
  else
    RESP=$(ph_curl POST "/subscriptions/" "$SUB_BODY")
    if [[ "$PH_LAST_STATUS" -ge 400 ]]; then
      echo "  FAILED to create subscription (status=$PH_LAST_STATUS): $RESP" >&2
      FAILED=$((FAILED + 1))
      continue
    fi
    SUB_ID=$(echo "$RESP" | jq -r '.id')
    echo "  Created subscription id=$SUB_ID  (WoW drop > ${WOW_THRESHOLD}% → '$DESTINATION_NAME')"
  fi
done

echo ""
echo "----------------------------------------"
echo "Summary: created=$CREATED skipped=$SKIPPED failed=$FAILED"
echo "----------------------------------------"

if [[ "$FAILED" -gt 0 ]]; then
  exit 1
fi
exit 0
