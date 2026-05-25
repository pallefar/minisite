---
phase: 40
plan: "01"
subsystem: database/edge-functions
tags: [migration, rls, stripe, append-only, coupon-seed]
dependency_graph:
  requires: []
  provides:
    - "public.cancellation_offers_log (append-only ledger)"
    - "public.save_offer_rules (admin rule catalog)"
    - "Stripe coupon catalog SAVE-{20,25,30}-{2,3}MO (seeded at deploy-time)"
    - "supabase/functions/cancellation-seed-coupons (idempotent seed Fn)"
  affects:
    - "40-03 (cancellation-decide-offer reads save_offer_rules + writes cancellation_offers_log)"
    - "40-05 (SECDEF RPCs write save_offer_rules)"
    - "40-06 (ROI view reads cancellation_offers_log; orchestrator invokes coupon seed)"
tech_stack:
  added:
    - "Stripe esm.sh/stripe@19 (Edge Fn import, cancellation-seed-coupons)"
  patterns:
    - "Negative-space RLS append-only ledger (xp_ledger template)"
    - "Defense-in-depth UPDATE/DELETE block triggers (named $body$ dollar-quote)"
    - "Deferred FK to resolve cyclic table dependency"
    - "Idempotent Stripe seed with resource_already_exists catch (A7)"
key_files:
  created:
    - "supabase/migrations/20270709000001_p40_cancellation_offers_log.sql"
    - "supabase/migrations/20270709000002_p40_save_offer_rules.sql"
    - "supabase/migrations/20270709000003_p40_stripe_coupon_seed.sql"
    - "supabase/functions/cancellation-seed-coupons/index.ts"
    - "supabase/functions/cancellation-seed-coupons/index.test.ts"
    - "supabase/functions/cancellation-seed-coupons/deno.json"
    - "supabase/tests/p40_offers_log_rls_proof.sql"
    - "supabase/tests/p40_save_offer_rules_rls_proof.sql"
    - "supabase/tests/p40_enum_check.sql"
  modified: []
decisions:
  - "Cyclic FK resolved via deferred ALTER TABLE in migration 2 (cancellation_offers_log.rule_id → save_offer_rules)"
  - "Append-only enforced via 2-layer: negative-space RLS (no INSERT/UPDATE/DELETE policies for authenticated) + defense-in-depth triggers raising append_only_table"
  - "subscription_id FK is TEXT (not UUID) matching Stripe sub_* format per PATTERNS §12"
  - "user_id + org_id + subscription_id + rule_id all use ON DELETE SET NULL for GDPR audit-retention (rows survive account deletion)"
  - "save_offer_rules offer_type does not include 'none' (that value only appears in cancellation_offers_log for no-rule-matched rows)"
  - "Stripe coupon seed deferred to Plan 40-06 close-out; migration 3 is marker-only"
  - "All 6 status + 6 offer_type + 7 reason + 3 tenure_bucket values declared at table creation (no later widening migration needed in Phase 40)"
metrics:
  duration: "~25 minutes"
  completed: "2026-05-21"
  tasks_completed: 3
  tasks_total: 3
  files_created: 9
  files_modified: 0
---

# Phase 40 Plan 01: Schema — cancellation_offers_log + save_offer_rules + Stripe coupon seed

## One-Liner

Append-only `cancellation_offers_log` ledger + admin `save_offer_rules` rule catalog + idempotent Stripe coupon seed Edge Fn for 6 SAVE-{20,25,30}-{2,3}MO coupons.

## What Was Built

### Task 1: cancellation_offers_log migration + pgTAP proofs

Migration `20270709000001_p40_cancellation_offers_log.sql` creates the append-only log table:

- All 6 `status` values declared at CHECK-constraint time: `offered`, `accepted`, `declined`, `expired`, `ineligible_lifetime_cap`, `ineligible_cooldown`
- All 6 `offer_type` values at creation: `pause`, `discount`, `extended_trial`, `downgrade`, `contact_csm`, `none`
- All 7 D-18 `reason` values at creation: `too_expensive`, `not_using`, `found_alternative`, `health_goals_changed`, `temporary_break`, `service_quality_issue`, `other`
- All 3 `tenure_bucket` values at creation: `<30d`, `30-180d`, `>180d`
- `subscription_id` is `text` FK referencing `subscriptions(id)` (Stripe sub_* format, not UUID)
- `user_id` / `org_id` / `subscription_id` / `rule_id` all `ON DELETE SET NULL` for GDPR audit-retention
- `rule_id` declared as plain `uuid` column here (no FK — deferred to migration 2 to avoid cyclic dependency)
- Negative-space RLS: `cancellation_offers_log_select_admin` (support_admin+ SELECT only) + `cancellation_offers_log_service_insert` (service_role INSERT explicit); no INSERT/UPDATE/DELETE for authenticated
- Defense-in-depth: `_p40_cancellation_offers_log_block_update` + `_p40_cancellation_offers_log_block_delete` trigger functions raise `append_only_table`; named `$body$` dollar-quote tags; zero bare `$$`
- 3 indexes: `idx_offers_log_user(user_id, offered_at desc)`, `idx_offers_log_status_taken` (partial where `status in ('accepted','declined')`), `idx_offers_log_cohort_offer` (GIN on cohort_snapshot where status='accepted')

pgTAP tests:
- `p40_offers_log_rls_proof.sql`: 4 tests — policy count exact, UPDATE trigger blocks, DELETE trigger blocks, cross-tenant policy structural proof
- `p40_enum_check.sql`: 4 tests — all CHECK constraint values verified via pg_constraint catalog

### Task 2: save_offer_rules migration + deferred FK + pgTAP proof

Migration `20270709000002_p40_save_offer_rules.sql`:

- Table: `id`, `title`, `cohort_id` (FK → cohort_definitions ON DELETE CASCADE), `tenure_buckets text[]`, `reasons text[]`, `org_type` (any/consumer/clinic), `offer_type` (pause/discount/extended_trial/downgrade/contact_csm), `pause_months`, `coupon_id`, `extension_days`, `downgrade_target`, `priority`, `active`, `created_at`, `updated_at`, `created_by`
- All 5 `offer_type` values and all 3 `org_type` values declared at creation
- Indexes: `idx_rules_active_priority(priority) where active=true`, `idx_rules_cohort(cohort_id) where active=true`
- RLS: `save_offer_rules_select_admin` (support_admin+ SELECT); `revoke insert, update, delete on save_offer_rules from authenticated`
- `updated_at` trigger using named `$body$` dollar-quote
- Deferred FK at end of migration: `ALTER TABLE cancellation_offers_log ADD CONSTRAINT p40_offers_rule_fk FOREIGN KEY (rule_id) REFERENCES save_offer_rules(id) ON DELETE SET NULL`

pgTAP test `p40_save_offer_rules_rls_proof.sql`: 4 tests — exact policy count, deferred FK exists, cohort_id CASCADE FK verified, select_admin policy structural check.

### Task 3: Stripe coupon seed Edge Fn + marker migration

Edge Fn `cancellation-seed-coupons/index.ts`:
- Loops 6-coupon catalog: `SAVE-{20,25,30}-{2,3}MO` with `duration='repeating'`, `metadata.source='phase_40_save_flow'`
- Idempotency: `idempotencyKey: 'seed-${id}-v1'` + `try/catch` on `err.code === 'resource_already_exists'`
- Service-role bearer gate via `checkServiceRoleBearer` (T-40-01-05)
- Logs only `err.code + err.message` — never `err.raw` (T-40-01-06)
- `shutdownPostHog()` in `finally` block
- `setStripeForTest` export hook for test injection

Test `index.test.ts`: 4 Deno tests — all pass:
- T1: missing bearer → 401
- T2: all 6 succeed → created:6, skipped:0
- T3: 3 succeed + 3 resource_already_exists → created:3, skipped:3, no exception
- T4: non-idempotent Stripe error → exception bubbles

Migration `20270709000003_p40_stripe_coupon_seed.sql`: marker-only `DO $migration_marker$` block documenting deploy-time invocation requirement (owned by Plan 40-06).

## Verified Output Properties

- Timestamp slot used: `20270709000001` / `20270709000002` / `20270709000003`
- Helper function verified: `public.is_admin_at_least` (exists at `20270601000027_profiles_admin_role_column.sql:33`)
- No deviations from the `<interfaces>` column list
- Stripe coupon seed: deferred to Plan 40-06 (marker migration documents intent)
- Zero bare `$$` across all 3 migrations (grep returns 0)
- All 3 migration files at exact 14-digit timestamp format (no "Skipping" risk)

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | `1800815` | cancellation_offers_log + RLS + pgTAP proofs |
| Task 2 | `0f27cd0` | save_offer_rules + deferred FK + RLS proof |
| Task 3 | `d2d6710` | coupon seed Edge Fn + marker migration |

## Deviations from Plan

None — plan executed exactly as written.

The `save_offer_rules.offer_type` CHECK omits `'none'` (the plan's `<interfaces>` block lists 5 values for `save_offer_rules.offer_type` without `'none'`; `'none'` only appears in `cancellation_offers_log.offer_type` for the no-rule-matched case). This matches the plan specification exactly.

## Known Stubs

None — this plan is schema-only. No UI components, no data-source wiring required.

## Threat Flags

No new threat surface introduced beyond what is documented in the plan's `<threat_model>`. All STRIDE mitigations declared in the threat register are implemented:

| Flag | File | Status |
|------|------|--------|
| T-40-01-01 | cancellation_offers_log | Mitigated: block_update + block_delete triggers |
| T-40-01-02 | cancellation_offers_log | Mitigated: select_admin policy on is_admin_at_least |
| T-40-01-03 | save_offer_rules | Mitigated: revoke INSERT/UPDATE/DELETE from authenticated |
| T-40-01-04 | cancellation-seed-coupons | Mitigated: idempotencyKey + resource_already_exists catch |
| T-40-01-05 | cancellation-seed-coupons | Mitigated: checkServiceRoleBearer gate |
| T-40-01-06 | cancellation-seed-coupons | Mitigated: logs err.code+message only, never err.raw |
| T-40-01-07 | save_offer_rules | Accepted: audit logging owned by Plan 40-05 SECDEF RPCs |

## Self-Check: PASSED

All 3 commits found in git log. All 9 files present in worktree. 4/4 Deno tests green.
