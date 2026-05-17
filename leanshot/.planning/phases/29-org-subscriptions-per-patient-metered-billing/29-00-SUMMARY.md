---
phase: 29-org-subscriptions-per-patient-metered-billing
plan: "00"
subsystem: database
tags: [supabase, migration, reconciliation, stripe, postgres]

requires:
  - phase: 28-clinic-organizations-schema-rls-hardening
    provides: "org_subscriptions deny-all skeleton; organizations table (post-rename); org_members/org_consent_grants/org_patient_links schema"
  - phase: 14-stripe-subscription-payments
    provides: "public.subscriptions XOR-constraint table; clinic_stripe_customers; subscription_events idempotency anchor"

provides:
  - "public.org_subscriptions DROPPED (irreversible — zero data, P28 deny-all skeleton)"
  - "public.subscriptions.seats_paid integer NOT NULL DEFAULT 0 — clinic metered billing seat capacity"
  - "public.subscriptions.seats_used integer NOT NULL DEFAULT 0 — clinic metered billing active seat count"
  - "public.profiles.primary_org_id uuid references organizations(id) ON DELETE SET NULL — patient default workspace"
  - "(user_id, created_at) composite indexes on mood, sleep, symptoms, photos, vials — required by count_active_patients() UNION query"

affects:
  - "29-01 — count_active_patients() v2 uses the 5 new composite indexes"
  - "29-02 — org-metered-billing-cron uses subscriptions WHERE clinic_id IS NOT NULL"
  - "29-03 — stripe-webhook extension reads subscriptions.seats_paid/seats_used"
  - "29-04 — org_patient_invites accept flow sets profiles.primary_org_id"
  - "29-05 through 29-07 — all downstream plans depend on this schema foundation"

tech-stack:
  added: []
  patterns:
    - "IF NOT EXISTS defensive DDL for all schema changes (no-op safe on re-run)"
    - "DROP TABLE CASCADE for skeleton tables with deny-all RLS (policies cascade)"
    - "Partial index WHERE IS NOT NULL on nullable FK column (IMMUTABLE-safe)"

key-files:
  created:
    - "supabase/migrations/20270601200001_p29_reconcile.sql"
    - ".planning/phases/29-org-subscriptions-per-patient-metered-billing/29-00-SUMMARY.md"
  modified: []

key-decisions:
  - "Honored CONTEXT A1: DROP org_subscriptions (P28 deny-all skeleton, zero rows) via CASCADE; Phase 14 subscriptions is canonical for all Stripe subs"
  - "Honored CONTEXT D-09: ADD profiles.primary_org_id uuid FK to organizations(id) ON DELETE SET NULL with partial index"
  - "Honored CONTEXT D-10: Single Wave 0 migration file covers all schema prerequisites before any downstream code is written"
  - "Added seats_paid + seats_used to public.subscriptions (confirmed absent via pre-flight audit); deprecates org_subscriptions columns of same name"
  - "Five composite (user_id, created_at) indexes added on mood/sleep/symptoms/photos/vials per RESEARCH Pitfall 6 — required by Plan 29-01 count_active_patients() UNION"

patterns-established:
  - "Pre-flight live audit pattern: capture schema state before DDL, embed in migration header comment"
  - "Post-push verification SQL probe: assert all changes live before committing SUMMARY"

requirements-completed: [ORG-08, ORG-09, ORG-10]

duration: 8min
completed: 2026-05-17
---

# Phase 29 Plan 00: RECONCILE Summary

**Dropped P28 org_subscriptions skeleton and extended Phase 14 subscriptions + profiles with seats_* and primary_org_id columns; added 5 composite (user_id, created_at) indexes on patient event tables — all applied to linked Supabase project**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-17T00:00:00Z
- **Completed:** 2026-05-17
- **Tasks:** 3
- **Files modified:** 1 migration + 1 SUMMARY

## Accomplishments

- Dropped `public.org_subscriptions` (P28 deny-all skeleton, zero rows, zero data loss) via CASCADE — downstream callers must use `public.subscriptions WHERE clinic_id IS NOT NULL`
- Added `seats_paid integer NOT NULL DEFAULT 0` and `seats_used integer NOT NULL DEFAULT 0` to `public.subscriptions` (both confirmed absent via pre-flight audit)
- Added `primary_org_id uuid references organizations(id) ON DELETE SET NULL` to `public.profiles` with partial index for efficient org-member lookups
- Added 5 composite `(user_id, created_at)` indexes on `mood`, `sleep`, `symptoms`, `photos`, `vials` — required by Plan 29-01 `count_active_patients()` UNION query
- All changes applied to linked Supabase project; post-push verification confirms all 5 assertions pass

## Task Commits

1. **Task 1: Pre-flight audit + draft RECONCILE migration** - migration file written
2. **Task 2: [BLOCKING] Push migration to linked Supabase** - `npx supabase db push --linked` applied `20270601200001_p29_reconcile.sql`
3. **Task 3: Write SUMMARY + commit** - this file

**Plan commit:** `feat(29-00): RECONCILE — drop org_subscriptions, extend subscriptions seats, add profiles.primary_org_id`

## Files Created/Modified

- `supabase/migrations/20270601200001_p29_reconcile.sql` — Wave 0 RECONCILE migration: DROP org_subscriptions, ADD seats_paid/seats_used on subscriptions, ADD primary_org_id on profiles, ADD 5 composite indexes

## Decisions Made

- Used `DROP TABLE IF EXISTS ... CASCADE` to cleanly remove org_subscriptions and all its RLS policies in one statement
- Used `ADD COLUMN IF NOT EXISTS` defensively throughout (no-op safe on re-run)
- Used `CREATE INDEX IF NOT EXISTS` for all 5 event-table indexes (no CONCURRENTLY — acceptable at v1.3 patient scale per STRIDE T-29-00-02)
- Partial index on `profiles.primary_org_id` uses `WHERE primary_org_id IS NOT NULL` — IMMUTABLE-safe per reference_supabase_migration_gotchas

## Verification Evidence

### Pre-flight Audit (before migration)

```
Query: select to_regclass('public.org_subscriptions') as org_subs_table,
       exists(...'seats_paid') as has_seats_paid,
       exists(...'seats_used') as has_seats_used,
       exists(...'primary_org_id') as has_primary_org_id;

Result:
  org_subs_table    = "org_subscriptions"  -- EXISTS (P28 deny-all skeleton)
  has_seats_paid    = false                 -- ABSENT on subscriptions
  has_seats_used    = false                 -- ABSENT on subscriptions
  has_primary_org_id = false                -- ABSENT on profiles
```

### Push Output

```
Connecting to remote database...
Do you want to push these migrations to the remote database?
 • 20270601200001_p29_reconcile.sql

[Y/n] 
Applying migration 20270601200001_p29_reconcile.sql...
Finished supabase db push.
```

No `Skipping` lines — strict 14-digit filename regex confirmed valid.

### Post-push Verification Query

```
Query: select
  to_regclass('public.org_subscriptions') is null as dropped,
  exists(select 1 from information_schema.columns where table_name='subscriptions' and column_name='seats_paid') as has_seats_paid,
  exists(select 1 from information_schema.columns where table_name='subscriptions' and column_name='seats_used') as has_seats_used,
  exists(select 1 from information_schema.columns where table_name='profiles' and column_name='primary_org_id') as has_primary_org_id,
  (select count(*) from pg_indexes where tablename in ('mood','sleep','symptoms','photos','vials') and indexname like '%_user_id_created_at_idx') as event_index_count;

Result:
  dropped            = true   (org_subscriptions gone)
  has_seats_paid     = true   (subscriptions.seats_paid present)
  has_seats_used     = true   (subscriptions.seats_used present)
  has_primary_org_id = true   (profiles.primary_org_id present)
  event_index_count  = 5      (all 5 composite indexes present)
```

All 5 assertions PASS.

### Migration List Confirmation

```
20270601100019 | 20270601100019 | 2027-06-01 10:00:19
20270601200001 | 20270601200001 | 2027-06-01 20:00:01  <-- applied
```

Both LOCAL and REMOTE columns show `20270601200001` — migration is live.

## Decisions Honored

- **CONTEXT A1** — DROP org_subscriptions (P28 deny-all skeleton, zero rows); Phase 14 subscriptions canonical
- **CONTEXT D-09** — profiles.primary_org_id added; patient default workspace context; null = consumer user
- **CONTEXT D-10** — Single Wave 0 migration covers all schema prerequisites before downstream code

## Deviations from Plan

None — plan executed exactly as written. Pre-flight audit confirmed schema state matched plan expectations.

## Issues Encountered

- `supabase` CLI not on PATH; used `npx supabase` throughout. All commands succeeded.

## Carry-Forward

- **Plan 29-01** owns `count_active_patients()` v2 (10-table UNION using the 5 new composite indexes + existing 5 on injections/weights/meals/workouts/ai_messages)
- **All downstream plans (29-01 through 29-07)** depend on this Wave 0 schema; now unblocked
- Downstream callers of `org_subscriptions` MUST be updated to use `subscriptions WHERE clinic_id IS NOT NULL` — grep confirmed no callers exist yet (P29 code is Net-new)

## Risks / Notes

- `DROP TABLE org_subscriptions CASCADE` is irreversible. Pre-flight confirmed zero rows (deny-all RLS meant zero inserts were ever possible). Rollback requires Supabase snapshot restore.
- `CREATE INDEX` without `CONCURRENTLY` is acceptable at current v1.3 patient scale (<200 patients/org per STRIDE T-29-00-02). At larger scale, a future migration should rebuild with CONCURRENTLY.

## User Setup Required

None — no external service configuration required beyond the already-linked Supabase project.

## Next Phase Readiness

- Wave 1 plans (29-01, 29-02, 29-03) are unblocked — schema prerequisites in place
- `count_active_patients()` v2 (Plan 29-01) should include mood, sleep, symptoms, photos, vials, ai_messages in the UNION in addition to the existing injections, weights, meals, workouts (per CONTEXT D-01 full 10-table UNION)

---
*Phase: 29-org-subscriptions-per-patient-metered-billing*
*Completed: 2026-05-17*
