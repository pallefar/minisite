# Plan 70-07 — Unit-tests 62-failure root-cause + reconciliation plan

**Created:** 2026-05-29
**Author:** cascade-37 triage session
**CI run analyzed:** `26623200524` (HEAD `33498951`), Unit-tests job `78453667610`
**Decision taken:** "Investigate + draft migrations, don't push" — nothing in this
doc has been applied to the remote DB.

## Summary

The Unit-tests CI job runs `npm run test:unit -- --maxWorkers=1` with
`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` present, so the
RLS/RPC suites run **live against the remote Supabase DB** (`ytnsipxxmzgaebkqmokp`)
and gate merge. Locally they self-skip (`describeIfLive` / `SHOULD_RUN`), which is
why none of this reproduces on a dev machine.

Vitest summary: **62 failed tests across 53 failed files**. Breakdown:

- **31 failed files** = Deno-runtime Edge-Fn tests wrongly captured by the
  `functions-unit` vitest project. **Already fixed** in cascade-36 (scoped the
  include to the 16 vitest-compatible files). 0 of the 62 failed *tests*.
- **62 failed tests across 22 files** = the real backlog, triaged below.

`supabase migration list --linked` shows **all 476 migrations applied on both
local and remote**, including the supposed fix migrations. The failures are
therefore **live-DB state drift** (objects marked-migrated but diverged) and/or
**migrations that were buggy/incomplete when written** — not an unapplied-migration
gap. The CI error codes (42P17 / 42704 / 23502 / 42501) are the live DB's actual
responses, so each root below is confirmed by live behavior.

## Cluster table

| # | Root cause | Error | Tests | Class | Fix |
|---|-----------|-------|-------|-------|-----|
| R1 | `org_members_select` RLS policy is self-referential | `42P17 infinite recursion … relation "org_members"` | ~30 (`rls-org-*`, `rls-change-member-role`) | **DB** | drafted migration A |
| R2 | `citext` extension not installed | `42704 type "citext" does not exist` | 5 (`resolve-clinic-slug`) | **DB** | drafted migration B |
| R3 | `log_admin_action` INSERT omits `user_id_hash` | `23502 null value in column "user_id_hash"` | ~12 (`audit-logs-rls`, `audit-trigger`, rag `topic-*`) | **DB** | drafted migration C |
| R4 | `admin_backup_codes` INSERT revoked from `service_role` | `42501 permission denied for table admin_backup_codes` | 2 (`backup-codes`) | **Test/policy** | see R4 below — recommend test-side RPC seeding (defer) |
| R5 | `has_permission()` SECDEF lacks newer TS perm keys | `expected 18 to be 16`; owner pairs `expected true` | 7 (`role-matrix-sync`) | **DB or test** | decision needed — extend DB fn vs trim TS |
| R6 | `_validate_onboarding_steps` narrowed to shape-guard in P34 | `expected null not to be null` (no raise) | 5 (`validate-onboarding-steps`) | **Test** | update test to P34 contract |
| R7 | `markdown-it` vitest alias is a hardcoded local absolute path | `Failed to resolve import "markdown-it"` | 2 (`research-renderer`, collection) | **Config (in-repo)** | fixed cascade-37 |
| R8 | jsdom lacks `Notification` / `PushManager` | `expected 'unsupported' to be 'granted'` | 1 (`notifications/permission`) | **Test (in-repo)** | fixed cascade-37 |

## DB-side roots (drafted migrations — NOT pushed)

Drafts live in `drafted-migrations/` next to this file. They are written with
forward timestamps (after the newest applied `20290107000004`) so they are
apply-ready, but they are **not** in `supabase/migrations/` and have **not** been
pushed. Review, then `git mv` into `supabase/migrations/` and
`supabase db push --linked` when ready.

### R1 — org_members RLS infinite recursion (42P17) — the big one

`supabase/migrations/20270601600004_p31_06_fix_org_member_rls_recursion.sql` was
**self-defeating**. It created the `public._is_org_member(org_id, user_id)` SECURITY
DEFINER helper (which bypasses RLS and breaks the cycle) but then re-created
`org_members_select` with its second clause STILL an inline
`EXISTS (SELECT 1 FROM public.org_members direct_check …)` subquery — the migration's
own trailing comment admits this "does NOT avoid the recursion." It only switched the
`org_onboarding_flows` policy to the helper.

Result: any query that touches `org_members` (directly, or via another table's RLS
policy that joins `org_members` for a membership check — `org_branding`, `org_settings`,
`org_invites`, `organizations`, `org_patient_links`, `org_consent_grants`,
`org_onboarding_flows`, `change_member_role`) re-invokes `org_members_select`, which
subqueries `org_members`, which re-invokes the policy → 42P17.

No later migration redefines `org_members_select` (checked through `20271102…`); the
p47 events policy queries `org_members` but doesn't redefine its policy.

**Fix (migration A):** redefine `org_members_select` so the "see co-members of my orgs"
clause uses the existing SECDEF helper instead of an inline self-subquery:

```sql
drop policy if exists "org_members_select" on public.org_members;
create policy "org_members_select" on public.org_members for select
  using (
    auth.uid() = user_id
    OR public._is_org_member(org_members.org_id, auth.uid())
  );
```

`_is_org_member` is `security definer` + `stable` and selects `org_members` without
re-triggering RLS, so the cycle is broken. **This is the highest-impact fix and also
a live production correctness bug** — co-member visibility on org tables is currently
broken for authenticated B2B/clinic users, not just tests.

### R2 — citext not installed (42704)

`20270601100011_resolve_clinic_slug_rpc.sql:87` compares `oi.email = v_email::citext`
with `set search_path = pg_catalog, public, extensions`. No migration ever ran
`CREATE EXTENSION citext`, so the cast type doesn't resolve at runtime → 42704, which
the RPC surfaces to every `resolve_clinic_slug` call.

**Fix (migration B):** `create extension if not exists citext with schema extensions;`
(matches the function's search_path). Alternative if extension install is undesirable:
rewrite the comparison to `lower(oi.email) = lower(v_email)` and drop the citext
dependency — but `CREATE EXTENSION` is the lower-risk, intent-preserving choice.

### R3 — log_admin_action omits user_id_hash (23502)

`public.audit_logs.user_id_hash` is `text not null` (since
`20260601000001_audit_logs.sql:62`). `20270601200005_fix_phi_audit_trigger_user_id_hash.sql`
fixed **`fn_audit_phi_trigger`** to compute it, but
`20270601000029_log_admin_action_function.sql:38` — written a year later — still
INSERTs without `user_id_hash`. So **every `log_admin_action()` call has always
failed** with 23502 (it was DOA, masked by the rate-limit cluster). This breaks the
direct `audit-logs-rls` test and every RPC that records an admin action via
`log_admin_action` (rag `topic-create/update/delete/restore`, `topic-audit`).

**Fix (migration C):** `create or replace function public.log_admin_action(...)` adding
`user_id_hash` to the column list and the canonical value used by the trigger fix:

```sql
encode(digest(coalesce(auth.uid()::text, 'service_role'), 'sha256'), 'hex')
```

Keep the existing `is_admin_at_least('staff')` gate and signature unchanged.

## DB-or-test decision roots

### R4 — admin_backup_codes permission denied (42501)

`20270601000031_admin_backup_codes_table.sql:51-54` deliberately
`revoke insert/update/delete … from authenticated, anon, service_role;` and grants
only to `postgres` (append-only hardening; RLS `abc_select_own_aal2` for SELECT). The
test's `seedBackupCodes` does a direct `admin.from('admin_backup_codes').insert()` as
`service_role`, which the security model intentionally blocks → 42501 (and T7b sees
42501 where it expected the 23505 unique violation). This is **not a DB bug** — the
test exercises a path the hardening forbids. Tracked already as `EG-29`
(`[PLAN-24-05-SWAP]` stub→RPC). **Recommendation:** seed via a SECDEF RPC (postgres
context) or keep deferred; do **not** weaken the grant.

### R5 — has_permission missing newer keys (role-matrix-sync, 7 tests)

`_ROLE_PERMISSIONS_FOR_TEST` (TS) now yields **18** distinct perms; the test's shape
sanity still asserts 16, and the 6 owner pairs for the 2 newest keys fail because the
DB `has_permission()` (`20270601310101_p31_01_has_permission_secdef.sql`) returns false
for keys it doesn't know. The test file's own header documents this as intentional
"TS ahead of DB" drift requiring "a follow-up plan must extend the DB function AND
update this count." **Decision needed:** (a) extend `has_permission()` with the 2 new
keys (security-floor change — needs the intended role→perm mapping), or (b) if those
keys are UX-only hints with no DB enforcement, trim them from the matrix / update the
test count to 18 and assert DB=false for them. I did not draft this migration because
it needs the product decision on whether the new perms are DB-enforced.

## Test-side roots

### R6 — _validate_onboarding_steps narrowed (validate-onboarding-steps, 5 tests)

`20270706000002_p34_onboarding_flows_consumer.sql` did `create or replace` on
`_validate_onboarding_steps`, **intentionally** reducing it to a pure shape-guard:
it now only raises `INVALID_STEPS_NOT_ARRAY` (non-array) and `UNKNOWN_STEP_TYPE`
(type not in the merged P31+P34 allowlist). The P31-era test still asserts
`MISSING_MANDATORY_STEP` (empty array, missing mandatory) and
`INVALID_CUSTOM_ON_LOCKED_STEP` — rules the function no longer has. **Fix:** update
`validate-onboarding-steps.test.ts` to the P34 contract (and, if mandatory-step
enforcement is still required, assert it where it now lives —
`save_consumer_onboarding_flow` / app layer). Needs live DB to verify, so left as a
documented test-contract update rather than a blind edit.

### R7 / R8 — fixed in cascade-37 (in-repo, verified locally)

- **R7:** `vitest.config.ts` `src-lib-unit` `markdown-it` alias was the literal
  `/Users/karstenhaldan/minisite/leanshot/node_modules/markdown-it/index.mjs` — a dev
  machine absolute path that doesn't exist on the CI runner
  (`/home/runner/work/minisite/…`), so `research-renderer.ts`'s `import MarkdownIt from
  'markdown-it'` failed to resolve and the file failed collection. Made portable via
  `fileURLToPath(new URL('./node_modules/markdown-it/index.mjs', import.meta.url))`.
- **R8:** `notifications/permission.test.ts` ran under jsdom without `Notification` /
  `PushManager` / `serviceWorker`, so `requestPushPermission` short-circuited to
  `'unsupported'`. Added the stubs so the granted-path assertions run.

## Net effect once applied

| Action | Clears |
|---|---|
| cascade-36 (done) | 31 Deno collection failures |
| cascade-37 (done) | R7 (2) + R8 (1) = 3 tests |
| migration A (R1) | ~30 tests |
| migration B (R2) | 5 tests |
| migration C (R3) | ~12 tests |
| R6 test update | 5 tests |
| R5 decision | 7 tests |
| R4 (defer/RPC) | 2 tests |

Applying migrations A+B+C to the remote DB + the R6 test update would take the
Unit-tests job from 62 → ~9 failing (R5 7 + R4 2), both of which are product/test
decisions rather than DB bugs.
