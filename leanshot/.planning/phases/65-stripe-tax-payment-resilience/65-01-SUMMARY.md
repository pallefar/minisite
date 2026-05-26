---
phase: 65-stripe-tax-payment-resilience
plan: 01
subsystem: payments-tax
tags: [migration, schema, stripe-tax, dunning, refunds, lifecycle-emails, rls]
requirements: [PAY-03, PAY-04, PAY-05, PAY-07, PAY-08, PAY-10, PAY-11]
dependency-graph:
  requires:
    - public.subscriptions (Phase 14 — id text PK)
    - public.org_subscriptions (Phase 28 — org_id uuid PK)
    - public.is_staff() (Phase 15)
    - auth.users (Supabase Auth)
  provides:
    - public.org_subscriptions.tax_id column
    - public.subscriptions.dunning_state + last_dunning_email_at columns
    - public.dunning_emails_sent table (composite PK idempotency)
    - public.refunds table (surrogate uuid PK audit)
    - public.lifecycle_emails_sent table (composite PK idempotency)
    - public.tax_collection_log table (Stripe Tax audit trail)
    - public.tax_nexus_thresholds table + 12 US state seed rows
    - public.tax_nexus_state_revenue materialized view (refresh concurrently capable)
  affects:
    - Wave 2 plans (65-02 through 65-09): all Edge Fns + UI surfaces read these contracts
tech-stack:
  added: []
  patterns:
    - composite-pk-idempotency (dunning_emails_sent, lifecycle_emails_sent)
    - surrogate-uuid-pk-audit (refunds, tax_collection_log) — per [[reference_dual_auth_submission_table_pk_pattern]]
    - matview-concurrent-refresh (unique index on state)
    - bare-create-policy (no IF NOT EXISTS — remote PG)
    - add-column-if-not-exists (production-table ALTER guard)
key-files:
  created:
    - supabase/migrations/20290104000001_org_subscriptions_tax_id.sql
    - supabase/migrations/20290104000002_subscriptions_dunning_state.sql
    - supabase/migrations/20290104000003_dunning_emails_sent.sql
    - supabase/migrations/20290104000004_refunds.sql
    - supabase/migrations/20290104000005_lifecycle_emails_sent.sql
    - supabase/migrations/20290104000006_tax_collection_log.sql
    - supabase/migrations/20290104000007_tax_nexus_thresholds.sql
    - supabase/migrations/20290104000008_tax_nexus_state_revenue_matview.sql
  modified: []
decisions:
  - subscriptions.id is TEXT (Phase 14 stripe_subscriptions schema), so dunning_emails_sent.subscription_id and refunds.subscription_id and tax_collection_log.subscription_id are all TEXT — NOT uuid as the plan body specified. Caught at execute-time during analog file review.
  - org_subscriptions PK is `org_id` uuid (Phase 28 schema), so tax_collection_log.org_subscription_id REFERENCES org_subscriptions(org_id) — NOT (id) as the plan body specified.
  - tax_nexus_state_revenue matview snapshots `now()` at refresh time (frozen) — daily cron refresh delivers a stable trailing-365d window per day.
  - dunning_emails_sent + lifecycle_emails_sent use composite PK (NOT surrogate uuid) — the burst-retry idempotency pattern requires ON CONFLICT DO NOTHING on the natural key.
  - refunds + tax_collection_log use surrogate UUID PK — stripe_refund_id can repeat across retries; UNIQUE constraint catches dup-inserts without merging rows.
  - dunning_state allows NULL (treated as 'none') so existing subscription rows pass the new CHECK constraint without backfill.
metrics:
  duration: ~25 minutes
  completed: 2026-05-26
  tasks: 2
  commits: 2
  files_created: 8
  files_modified: 0
---

# Phase 65 Plan 01: Payment-Resilience + Tax Schema Foundation Summary

**One-liner:** 8 migration files seed the entire Phase 65 schema (B2B tax_id mirror + dunning state machine + idempotent audit tables + Stripe Tax log + US economic-nexus reference table + per-state revenue matview) so all Wave 2 Edge Fns and UI surfaces share a stable, deterministic contract.

## What Was Built

This plan delivers the database foundation for Phase 65 — Stripe Tax + payment-resilience patterns. Eight migration files at timestamps `20290104000001` through `20290104000008` create the schema that all downstream Wave 2 plans depend on (6 Edge Fns + 3 UI surfaces + 1 daily cron).

### Migrations

| # | File | Purpose |
|---|------|---------|
| 1 | `20290104000001_org_subscriptions_tax_id.sql` | `org_subscriptions.tax_id` text column + partial btree index (PAY-03). |
| 2 | `20290104000002_subscriptions_dunning_state.sql` | `subscriptions.dunning_state` enum-CHECK column + `last_dunning_email_at` + partial cron-scan index (PAY-07). |
| 3 | `20290104000003_dunning_emails_sent.sql` | Audit + idempotency table; composite PK `(subscription_id, stage)`; service_role RLS + staff SELECT (PAY-05). |
| 4 | `20290104000004_refunds.sql` | Audit table with surrogate uuid PK + `stripe_refund_id UNIQUE`; service_role RLS + auth SELECT-own via subscriptions.user_id + staff SELECT (PAY-08). |
| 5 | `20290104000005_lifecycle_emails_sent.sql` | Idempotency table; composite PK `(user_id, stage)`; service_role RLS + staff SELECT (PAY-10 / PAY-11). |
| 6 | `20290104000006_tax_collection_log.sql` | Stripe Tax calculation audit; surrogate uuid PK; sub-OR-org CHECK; service_role RLS + staff SELECT (PAY-01). |
| 7 | `20290104000007_tax_nexus_thresholds.sql` | US economic-nexus reference + **12 inline seed rows** (CA, TX, NY, FL, WA, IL, PA, GA, NC, NJ, VA, AZ) with DOR citations in `notes` (PAY-04). |
| 8 | `20290104000008_tax_nexus_state_revenue_matview.sql` | Materialized view aggregating trailing-365d revenue per state with unique index on `state` for `REFRESH CONCURRENTLY` (T-65-01-06 DoS mitigation; PAY-04). |

### Schema Decisions (codified)

- **FK type alignment (Rule 1 fix):** Plan body specified `uuid` for `subscription_id` FKs, but `public.subscriptions.id` is `text` (Phase 14 schema). All three downstream FKs (`dunning_emails_sent.subscription_id`, `refunds.subscription_id`, `tax_collection_log.subscription_id`) are `text`.
- **org_subscriptions FK column (Rule 1 fix):** Plan body specified `references public.org_subscriptions(id)`, but that table's PK is `org_id` (Phase 28). Fixed to `references public.org_subscriptions(org_id) on delete set null`.
- **Composite PK vs surrogate UUID PK:** Idempotency tables (`dunning_emails_sent`, `lifecycle_emails_sent`) use composite natural-key PKs so ON CONFLICT DO NOTHING is the idempotency anchor. Audit tables (`refunds`, `tax_collection_log`) use surrogate UUID PKs so stripe_refund_id retries fail UNIQUE rather than silently merge.
- **`ADD COLUMN IF NOT EXISTS`** used on every ALTER TABLE (`org_subscriptions`, `subscriptions`) per the rag_sources.source_type drift pattern.
- **Bare `CREATE POLICY`** — no `IF NOT EXISTS` (unsupported on remote PG per [[feedback_phase_close_out_supabase_gotchas]]).
- **CHECK constraint on `subscriptions.dunning_state`** wrapped in a DO block so re-apply is safe even though new tables don't use `IF NOT EXISTS`.

## How It Connects

- **Wave 2 (65-02 through 65-09)** all depend on these row shapes:
  - `stripe-webhook` extension (Plan 65-02 / extension to existing handler) writes to `tax_collection_log` + flips `subscriptions.dunning_state`.
  - `request-refund` Edge Fn (Plan 65-06) inserts to `refunds`.
  - `stripe-dunning-orchestrator` cron (Plan 65-05) reads/writes `subscriptions.dunning_state` + `dunning_emails_sent`.
  - `lifecycle-trial-ending` + `lifecycle-win-back` Edge Fns (Plan 65-07 / 65-08) write to `lifecycle_emails_sent`.
  - `<PaymentFailedBanner>` UI reads `subscriptions.dunning_state` via the Zustand store hydration path.
  - `/admin/tax` dashboard reads `tax_nexus_state_revenue` matview joined with `tax_nexus_thresholds` for proximity %.
  - `nexus-monitor` daily cron (Plan 65-08) refreshes the matview + checks proximity + fires Slack guardrail.
- **No `supabase db push` here** — per [[feedback_fn_deploy_before_cron_db_push]], push happens in close-out Plan 65-10 (after dependent Edge Fns are deployed).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] FK type mismatch — subscription_id columns**
- **Found during:** Task 1 prep (analog file review of `20260601000019_stripe_subscriptions.sql`).
- **Issue:** Plan body specified `subscription_id uuid not null references public.subscriptions(id)` for `dunning_emails_sent`, `refunds`. The plan also implies uuid for `tax_collection_log.subscription_id`. But `public.subscriptions.id` is `text` PK (Phase 14 stripe schema — `id` stores Stripe's `sub_xxx` identifier directly). A `uuid` FK referencing a `text` PK would fail migration push at `relation reference type mismatch`.
- **Fix:** All three downstream FKs use `text` to match the source PK.
- **Files modified:** 20290104000003, 20290104000004, 20290104000006
- **Commit:** 26b36258 (Tasks 1's 5 migrations) + e0c591c7 (Task 2's `tax_collection_log`)

**2. [Rule 1 - Bug] FK column mismatch — org_subscriptions reference**
- **Found during:** Task 2 prep (analog file review of `20270601100008_org_subscriptions_table.sql`).
- **Issue:** Plan body specified `org_subscription_id uuid references public.org_subscriptions(id) on delete set null`. But `public.org_subscriptions` has no `id` column — its PK is `org_id uuid` (Phase 28 schema choice — one subscription row per organization).
- **Fix:** Changed to `org_subscription_id uuid references public.org_subscriptions(org_id) on delete set null`. Column name kept as `org_subscription_id` for semantic clarity (this is the org's subscription, identified by org_id).
- **Files modified:** 20290104000006
- **Commit:** e0c591c7

### Threat Mitigations Applied

Per the plan's `<threat_model>` register:

| Threat ID | Mitigation status |
|-----------|-------------------|
| T-65-01-01 (Tampering, dunning_emails_sent) | mitigated — composite PK (subscription_id, stage) makes duplicate-send insertion fail; ON CONFLICT DO NOTHING in Plan 65-05 is the consumer-side guarantee. |
| T-65-01-02 (Info Disclosure, refunds) | mitigated — RLS SELECT-own policy joins to subscriptions.user_id; service_role required to mutate. |
| T-65-01-03 (Info Disclosure, tax_collection_log) | mitigated — staff-only SELECT via `public.is_staff()`. |
| T-65-01-04 (Repudiation, refunds) | mitigated — created_at + updated_at + stripe_refund_id UNIQUE + eligibility_window column records WHY refund was allowed. |
| T-65-01-05 (Tampering, tax_nexus_thresholds) | accepted — authenticated SELECT only; mutation requires service_role / SQL access. |
| T-65-01-06 (DoS, tax_nexus_state_revenue) | mitigated — unique index on `state` enables `REFRESH MATERIALIZED VIEW CONCURRENTLY` so daily cron refresh never blocks reads. |

### No Threat Flags Introduced

No new trust boundaries or unmodelled surfaces were added; all new tables exist behind RLS or matview GRANTs as planned.

## Verification

- All 8 migrations exist at exact timestamps `20290104000001` through `20290104000008` ✓
- Each migration wrapped in `begin; ... commit;` (1 of each per file) ✓
- No `IF NOT EXISTS` on `CREATE POLICY` lines (only in comments referencing the convention) ✓
- No `IF NOT EXISTS` on `CREATE TABLE` lines ✓
- RLS enabled on every new table before any `create policy` ✓
- `tax_nexus_thresholds` seeded with 12 US state rows inline ✓
- `tax_nexus_state_revenue` has unique index on `state` (required for concurrent refresh) ✓
- `subscriptions.dunning_state` CHECK accepts NULL + 5 enum values ✓
- `refunds.id` is surrogate uuid (NOT composite) ✓
- `dunning_emails_sent` + `lifecycle_emails_sent` have composite PKs ✓
- Inter-migration column dependencies verified — only 000008 reads from 000006 (no forward references; 000007 is standalone) ✓
- No `supabase db push` executed (per plan — close-out owns push) ✓

## Known Stubs

None. All migrations are complete, self-contained SQL ready for `supabase db push` at close-out (Plan 65-10).

## Deferred Issues

None. All tasks within scope completed in 2 atomic commits.

## Self-Check: PASSED

All 8 migration files exist on disk; both task commits (26b36258, e0c591c7) present in `git log`; no STATE.md or ROADMAP.md modifications (per parallel-executor mode).
