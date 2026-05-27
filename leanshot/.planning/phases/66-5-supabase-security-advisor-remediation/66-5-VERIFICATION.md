---
phase: 66.5
status: human_needed
verified: 2026-05-27
mode: automated-verify-only (operator + remote-deploy items rolled to Phase 70)
---

# Phase 66.5: Supabase Security Advisor Remediation — VERIFICATION

## Automated Verification (PASS)

| Check | Method | Result |
|-------|--------|--------|
| 3 migrations exist | `ls supabase/migrations/2029010600000{1,2,3}*.sql` | ✅ |
| Migration 000001 RLS count | `grep -cE "alter table public\.(email_send_counters\|ad_spend_facts_y2026m0[5-8]\|paywall_events\|plan_history) enable row level security" 000001*.sql` | ✅ 7 |
| Migration 000001 policy count | grep `create policy "(email_send_counters\|ad_spend_facts_y2026m0[5-8]\|paywall_events\|plan_history)_deny_all_authenticated"` | ✅ 7 |
| Migration 000002 security_invoker count | `grep -cE "security_invoker\s*=\s*on" 000002*.sql` | ✅ 3 (v_cancellation_offers_roi + share_snapshot_view + user_activity_daily) |
| Migration 000002 revoke count | `grep -c "revoke select.*from anon, authenticated" 000002*.sql` | ✅ 2 (share_snapshot_view + user_activity_daily) |
| Migration 000003 ALTER FUNCTION count | `grep -cE "alter function public\." 000003*.sql` | ✅ 16 |
| DO-block drift guards | `grep -c "exception when undefined_" 000001 000002 000003 \| awk -F: '{sum+=$2} END{print sum}'` | ✅ 33 (matches table+function+matview drift cases) |
| All `IF NOT EXISTS` use restricted to CREATE/INSERT | `grep -E "create policy if not exists" 000001 000002 000003` | ✅ 0 occurrences (remote PG unsupported) |

## Human-Verify Signals (DEFERRED TO PHASE 70)

| Signal | Status | Description |
|--------|--------|-------------|
| S1: `npx supabase db push --linked` applies 3 migrations cleanly | ⏭ | Depends on Phase 65 `org_subscriptions` drift resolution |
| S2: Re-run advisor; 11 ERROR findings → 0 | ⏭ | `npx supabase db advisors --linked --type security --level error \| jq 'length'` should return 0 |
| S3: Re-run advisor; function_search_path_mutable 16 → 0 | ⏭ | `... \| jq '[.[] \| select(.name=="function_search_path_mutable")] \| length'` should return 0 |
| S4: anon role cannot SELECT from share_snapshot_view | ⏭ | `curl -H "apikey: ${ANON_KEY}" "${SUPABASE_URL}/rest/v1/share_snapshot_view?limit=1"` → 403 or 0 rows |
| S5: anon role cannot SELECT from user_activity_daily | ⏭ | Same curl pattern → 403 or 0 rows |
| S6: Existing share-snapshot Edge Fn still works (service_role bypass intact) | ⏭ | Smoke test the share-create flow end-to-end |
| S7: Existing admin cohort-retention RPC still returns rows | ⏭ | Smoke test admin dashboard |

## Test Coverage

n/a — pure-SQL migration phase. No application code changed; no unit tests added. Verification is operator-side post-push.
