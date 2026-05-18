# Plan 31-00 — RECONCILE: enum rename + SECDEF ripple — SUMMARY

**Completed:** 2026-05-18
**Wave:** 0
**Requirements covered:** ORG-12

## What Shipped

Atomically renamed live Postgres enum `public.org_member_role` from `(admin, staff, viewer)` to `(owner, clinician, staff)` and re-created every consumer that referenced the old role literals — in a single migration transaction wrapped with idempotency guards + post-flight assertions.

**Live DB state (project `ytnsipxxmzgaebkqmokp`):**
- `org_member_role` enum values: `owner`, `clinician`, `staff` (no `admin`, no `viewer`)
- `_is_org_owner(uuid, uuid)` SECDEF present; `_is_org_admin(uuid, uuid)` dropped
- 12 SECDEF functions re-created with role-literal substitutions (admin→owner, staff→clinician, viewer→staff): `send_org_invite`, `revoke_org_invite`, `link_org_patient`, `count_active_patients`, `send_org_patient_invite`, `accept_org_patient_invite_preview`, `update_org_ranking_weights`, `set_patient_dose_thresholds`, `acknowledge_clinician_alert`, `snooze_clinician_alert`, `update_org_dose_trend_thresholds`, `reset_patient_dose_thresholds`, `_is_org_clinician`, `get_clinic_alert_metrics`
- 10 RLS policies dropped + re-created against `_is_org_owner` and the new role enum values

**Migration applied:** `supabase/migrations/20270601300100_p31_00_enum_rename_and_secdef_ripple.sql` (1233 lines)

## Commits

- `7c805a3` — Write atomic enum-rename + SECDEF-ripple migration
- `83a29ac` — Flip TypeScript role vocabulary + RLS fixtures + client role-literal usage (`src/types/org.ts`, `src/lib/org.ts`, `ClinicSettingsPage.tsx`, `RouteOrgGuard.tsx`, `p28-rls-fixture.ts`, 9 test files)
- `b228e38` — Migration grep-gate formatting fix
- `cd49586` — **Inline fix**: drop dependent policy `org_patient_invites_select_by_org_admin` BEFORE `_is_org_admin` function drop (push iter-1 failed SQLSTATE 2BP01); also renamed migration file `20260518070000_*` → `20270601300100_*` for lexicographic order with existing 2027-dated v1.3 migrations
- `<inline fix>` — Guard `org_subscriptions_select_admins` policy ripple with `to_regclass('public.org_subscriptions') is not null` check; Phase 28 D-14 specified the table as "skeleton only; P29 owns writes" but it was never actually shipped to live (verified via `information_schema.tables` 2026-05-18). Migration now forward-compatible.

## Verification (post-push, against live DB)

- ✓ Enum values: 3 rows `owner, clinician, staff` (no admin/viewer)
- ✓ `_is_org_owner` present; `_is_org_admin` absent (queried `pg_proc`)
- ✓ No `^Skipping` lines in push log (per [[reference_supabase_migration_filename_regex]])
- ✓ Push exit code 0
- ✓ P28 RLS proof tests: `rls-org-members.test.ts` + `rls-org-invites.test.ts` — 2/2 passed (8 skipped via SHOULD_RUN env-gate, unchanged from pre-push behavior)
- ✓ Pre-push: TS `tsc -b --noEmit` clean, vitest `org.test.ts` + `store-org-slice.test.ts` 21/21 passed

## Surprises / inline fixes (worth carrying forward)

1. **Function-drop-before-policy-drop ordering bug** — the planner's migration ordered "drop old function" in STEP 2 before "drop+recreate dependent policies" in STEP 3. The single dependent policy on live DB (`org_patient_invites_select_by_org_admin`) caused SQLSTATE 2BP01. Fix: added an early policy drop in STEP 2 before the function drop. Generalizable: when ripping out a SECDEF that other policies reference, drop the policies FIRST or use `CASCADE`.
2. **Future-dated timestamp convention** — Codebase v1.3 uses `2027*`-prefixed migration timestamps to keep ordering even though calendar date is 2026. The planner used calendar date `20260518070000`; CLI refused as out-of-order. Fix: renamed to `20270601300100_*` (between latest P30 migration `...300011` and P31-01's `...310101`).
3. **`org_subscriptions` table never shipped** — Phase 28 CONTEXT D-14 specified the table as "skeleton only; P29 owns writes" but P29 evidently didn't create it. The migration assumed it existed. Fix: wrapped policy ripple in `to_regclass(...) is not null` guard. **Carry-over:** P29's `org_subscriptions` is a latent dependency for Phase 29 deferred work — flag for v1.4.

## Status Machine

N/A (no status fields owned by this plan)

## Files Modified

- `supabase/migrations/20270601300100_p31_00_enum_rename_and_secdef_ripple.sql` (renamed from `20260518070000_*`)
- `src/types/org.ts`
- `src/lib/org.ts`
- `src/components/clinic/settings/ClinicSettingsPage.tsx`
- `src/components/clinic/RouteOrgGuard.tsx`
- `src/lib/__tests__/_fixtures/p28-rls-fixture.ts`
- `src/lib/__tests__/org.test.ts`
- `src/lib/__tests__/store-org-slice.test.ts`
- `src/lib/__tests__/rls-org-members.test.ts`
- `src/lib/__tests__/rls-org-invites.test.ts`
- `src/lib/__tests__/with-org-scope.test.ts`

## Wave 0 Status

- **31-00:** ✓ COMPLETE (this plan)
- **31-00b:** ✓ COMPLETE (parallel, separate plan; commits `82a8256` + `bf06f31` + `b9a38b0`)

Ready for Wave 1 dispatch (Plan 31-01).
