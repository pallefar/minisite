---
phase: 19
plan: 1
subsystem: affiliate-ledger-schema
tags: [supabase, postgres, rls, migrations, tier-effective, affiliate-impressions, affiliates-public-view]
requires: [Phase 14 stripe_subscriptions, Phase 9 public.is_staff helper, public.audit_logs + app.suppress_audit GUC]
provides:
  - public.affiliates (AFF-01)
  - public.affiliate_clicks (AFF-02)
  - public.affiliate_conversions (D-36 idempotency anchor)
  - public.affiliate_impressions (AFF-08 / D-38)
  - public.payouts (AFF-06 ledger; D-39 reduced enum)
  - public.tier_effective view (MONEY-07; forward-compat with P16-06 D-04)
  - public.affiliates_public_view (AFF-09 / BL-3 anon read path)
  - public.insert_affiliate_impression(uuid,text,text,text) SECURITY DEFINER helper (BL-10)
  - 15 named RLS policies across the 5 tables
affects: [Phase 16-06 P16-06 becomes a no-op for subscriptions.provider column]
tech-stack:
  added: []
  patterns:
    - "Idempotent migrations via `do $$ if not exists` + `add column if not exists`"
    - "security_invoker=true on all views (D-03)"
    - "FK retention split: cascade on non-IRS facts, set null on auth.users for IRS rows, restrict on conversions+payouts -> affiliates"
key-files:
  created:
    - supabase/migrations/20270101000001_affiliates_schema.sql
    - supabase/migrations/20270101000002_affiliate_clicks_conversions_payouts.sql
    - supabase/migrations/20270101000003_subscriptions_provider_guard.sql
    - supabase/migrations/20270101000004_tier_effective_view.sql
    - supabase/migrations/20270101000004a_insert_affiliate_impression_fn.sql
    - supabase/migrations/20270101000005_affiliate_rls.sql
    - supabase/tests/affiliate_schema.test.sql
    - supabase/tests/tier_effective_view.test.sql
    - leanshot/tests/rls/affiliates-rls.test.ts
  modified: []
decisions:
  - "Switched two partial-index expressions from date_trunc('day', created_at) to (affiliate_id, created_at) range indexes. date_trunc(text, timestamptz) is STABLE (not IMMUTABLE) — would have failed at migration apply. The Plan 19-07 baseline matview does its own date_trunc('day', created_at AT TIME ZONE 'UTC') aggregation against the range index. Documented inline in migration 002."
  - "idx_payouts_eligible indexes payouts(created_at) where status='pending' instead of (eligible_at) — eligible_at is on affiliate_conversions per D-30; payouts cron joins against conversions for the 60-day hold filter."
metrics:
  duration_minutes: 18
  completed_utc: 2026-05-15T18:07:37Z
  commits:
    - b6be464 feat(19-01) migrations 1-4a
    - ce361cd feat(19-01) RLS + tests
---

# Phase 19 Plan 01: schema + RLS + tier_effective Summary

Ship the affiliate-ledger Postgres schema (5 tables + 2 views + RLS + 1 SECURITY DEFINER helper) in a single migration batch, forward-compatible with Phase 16's deferred RevenueCat integration. AFF-01 + AFF-08 + AFF-09 + AFF-10 + MONEY-07 all landed.

## Schema delta

### Tables (5)

| Table | Rows | RLS | IRS-retention FK |
|---|---|---|---|
| `affiliates` | 1 per affiliate | ✓ 3 policies | `user_id → auth.users` ON DELETE SET NULL |
| `affiliate_clicks` | append-only on /r/{code} | ✓ 3 policies | `user_id → auth.users` ON DELETE SET NULL |
| `affiliate_conversions` | 1 per Stripe invoice (UNIQUE on `invoice_id`, D-36) | ✓ 3 policies | `user_id` SET NULL; `affiliate_id` RESTRICT |
| `affiliate_impressions` (D-38) | append-only on /r/{code}/landing render | ✓ 3 policies | `affiliate_id` CASCADE (NOT IRS) |
| `payouts` | append-only per Stripe transfer | ✓ 3 policies | `user_id` SET NULL; `affiliate_id` RESTRICT |

### Views (2)

| View | Purpose | Visibility |
|---|---|---|
| `tier_effective` | MAX(current_period_end) per user_id across providers (MONEY-07) | `security_invoker=true`; authenticated SELECT (each caller sees their own subscriptions) |
| `affiliates_public_view` (BL-3) | Approved-affiliate slice for /r/{code}/landing | `security_invoker=true`; anon + authenticated SELECT; 8 non-PII columns only |

### Helper (1)

`public.insert_affiliate_impression(uuid, text, text, text)` — SECURITY DEFINER with locked `search_path = public, pg_temp`; service_role EXECUTE grant only; truncates IP via `set_masklen(...::inet, 24)` (BL-10 / D-38).

## RLS policy inventory (15)

| Table | Policies |
|---|---|
| affiliates | `pol_affiliates_self_select`, `pol_affiliates_staff_all`, `pol_affiliates_public_landing_read` (BL-3) |
| affiliate_clicks | `pol_affiliate_clicks_self_select`, `pol_affiliate_clicks_staff_all`, `pol_affiliate_clicks_service_insert` |
| affiliate_conversions | `pol_affiliate_conversions_self_select`, `pol_affiliate_conversions_staff_all`, `pol_affiliate_conversions_service_insert` |
| affiliate_impressions (D-38) | `pol_affiliate_impressions_self_select`, `pol_affiliate_impressions_staff_all`, `pol_affiliate_impressions_service_insert` |
| payouts | `pol_payouts_self_select`, `pol_payouts_staff_all`, `pol_payouts_service_write` |

The plan's `grep -c 'create policy'` acceptance criterion (`≥ 14`) is satisfied (16 matches in the migration file: 15 policy creations + 1 incidental comment match).

**Anti-pattern note (W-2 cleanup honored):** NO `pol_affiliates_self_update_profile` policy. Per BL-2 Path A, affiliate self-updates flow through the `partner-profile-update` Edge Function in Plan 19-06 (service-role with JWT auth + column allowlist). RLS does not gate column-level writes.

## Test results

| Test file | Type | Result |
|---|---|---|
| `supabase/tests/affiliate_schema.test.sql` | psql DO-block | **PASS** — all 9 assertions raised the success notice |
| `supabase/tests/tier_effective_view.test.sql` | psql DO-block | **PASS** — D-02 stripe-MAX + D-04 RC-forward-compat both green |
| `leanshot/tests/rls/affiliates-rls.test.ts` | vitest | File loads; 1 gating test green; 4 RLS tests skipped without env (CI-gated) |

D-04 forward-compat test breakdown:
- Scenario A: two `provider='stripe'` rows with overlapping windows → `winning_provider='stripe'`, `effective_period_end ≈ now() + 30 days` ✓
- Scenario B: add a `provider='revenuecat'` row with `current_period_end = now() + 60 days` → `winning_provider='revenuecat'`, `effective_period_end ≈ now() + 60 days` ✓ (zero view change required)

## FK retention contract documented (D-33)

- `affiliates.user_id → auth.users` **SET NULL** — affiliate row survives user deletion; anonymized in account-delete cascade (Plan 19-09)
- `affiliate_clicks.user_id → auth.users` **SET NULL** — ledger preserved post-deletion
- `affiliate_conversions.user_id → auth.users` **SET NULL**; `affiliate_id → affiliates` **RESTRICT** — block affiliate delete if conversions exist (D-33 step 1 pre-flight)
- `affiliate_impressions.affiliate_id → affiliates` **CASCADE** — impressions are NOT IRS records (D-38)
- `payouts.user_id → auth.users` **SET NULL**; `payouts.affiliate_id → affiliates` **RESTRICT** (D-33 step 4 — payouts retained 7yr)

## Deferred tech debt

- **D-39 — `payouts.status='reversed'`** — DEFERRED to v1.3. Chargeback handling on already-paid transfers (Stripe `transfer.reversed` webhook) is out of scope for v1.2. v1.3 plan: add `'reversed'` via `alter table ... drop constraint ... add constraint`; wire `transfer.reversed` webhook handler. v1.2 enum is the reduced set `('pending','processing','paid','failed','blocked_onboarding')` enforced by the check constraint.
- **D-38 — `affiliate_impressions` ready-but-unwired** — Schema lives here. The insert-on-render path ships in Plan 19-08 (BL-8). Plan 19-07 explicitly does NOT add a ratio-detector at v1.2 — the matview shipped in 19-07 is for clicks only. v1.3 will materialize `affiliate_impression_baseline` and add the impression-to-click ratio anomaly detector using accumulated history.

## [BLOCKING] schema push deferred to Plan 19-09

Per the plan and project rule `feedback_parallel_executor_autonomy_drift`: `supabase db push --linked` is NOT invoked in this plan. All Wave-1 plans accumulate migration deltas; Plan 19-09 owns the single `[BLOCKING]` push at phase close.

## Infra-phase routing

Per project memory `feedback_infra_phase_validate_not_verify`: Phase 19 verification will route to `/gsd-validate-phase`, not `/gsd-verify-work`. This plan ships pure schema infra with zero user-observable behavior; the verifier's user-story guard would halt mvp-mode verification.

## Deviations from plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `date_trunc('day', timestamptz)` is STABLE, not IMMUTABLE**
- **Found during:** Task 1 local validation (Postgres 17 container)
- **Issue:** The plan specified `create index idx_clicks_affiliate_day on affiliate_clicks(affiliate_id, date_trunc('day', created_at))` and the same shape on `affiliate_impressions`. Postgres rejects this with `functions in index expression must be marked IMMUTABLE` because `date_trunc(text, timestamptz)` is STABLE — the result depends on session `TimeZone`. (The IMMUTABLE form is `date_trunc(text, timestamp)` without tz.) The plan's own landmine annotation flagged the IMMUTABLE pitfall but didn't catch this specific case.
- **Fix:** Switched both indexes to plain `(affiliate_id, created_at)` range indexes. Consumers (Plan 19-07 baseline matview) do their own `date_trunc('day', created_at AT TIME ZONE 'UTC')` aggregation at query time against the range index — same hot-path support, IMMUTABLE-clean.
- **Files modified:** `supabase/migrations/20270101000002_affiliate_clicks_conversions_payouts.sql` (lines 38, 89)
- **Documented inline** with NOTE comment citing the gotcha.

**2. [Rule 3 — Blocking] `idx_payouts_eligible` referenced non-existent `payouts.eligible_at` column**
- **Found during:** Task 1 local validation
- **Issue:** Plan called for `create index idx_payouts_eligible on payouts(eligible_at) where status='pending'`. The `eligible_at` column is on `affiliate_conversions` (D-30: invoice.paid + 60 days), NOT on `payouts`. The Plan 19-09 cron joins against `affiliate_conversions.eligible_at` separately to compute payout eligibility.
- **Fix:** Indexed `payouts(created_at) where status='pending'` instead — same cron-fire semantic (chronological retrieval of pending payouts), payoff-eligibility joined at query time.
- **Files modified:** `supabase/migrations/20270101000002_affiliate_clicks_conversions_payouts.sql` (line 108)

### Validation environment note

`supabase db reset --local --linked=false` (the plan's verify command) is blocked by a pre-existing baseline ordering issue unrelated to this plan: `20260601000019_stripe_subscriptions.sql` references `public.orgs` which is only created by `20260801000002_orgs.sql`. The baseline depends on `supabase db push --linked` (Phase 14+ migrations were applied to the live DB in a different historical order). The 6 new Phase 19 migrations were instead validated on a clean Postgres 17 container against bootstrapped `auth.users`, `auth.uid()`, `service_role`/`anon`/`authenticated` roles, `public.is_staff()`, and a minimal `public.subscriptions` shim. All 6 migrations apply cleanly in that environment; both SQL test files pass; the vitest file loads.

## Self-Check: PASSED

- [x] 6 migration files exist at the canonical paths under `supabase/migrations/`
- [x] 3 test files exist (2 SQL + 1 vitest)
- [x] `payouts.status` check excludes `'reversed'` (D-39)
- [x] `affiliate_impressions` table exists with `affiliate_id` ON DELETE CASCADE (D-38)
- [x] `affiliates_public_view` exposes exactly 8 non-PII columns (BL-3)
- [x] `affiliates.template_choice` column exists with default `'coach'` (BL-3)
- [x] `public.insert_affiliate_impression(uuid, text, text, text)` SECURITY DEFINER with locked search_path and service_role-only grant (BL-10)
- [x] Both views have `reloptions = {security_invoker=true}` (D-03)
- [x] 15 RLS policies across 5 tables (Task 2 acceptance ≥ 14)
- [x] Both SQL test files raise their `ALL ASSERTIONS PASSED` notice
- [x] vitest RLS test file loads (4 tests skipped without live env — CI-gated)
- [x] Pathspec commits (no `git add .`): `b6be464` (Task 1) + `ce361cd` (Task 2)
- [x] No `supabase db push --linked` invocation (deferred to Plan 19-09 [BLOCKING])
- [x] No modifications to STATE.md or ROADMAP.md (orchestrator owns those)
