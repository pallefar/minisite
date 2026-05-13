---
phase: 09-clinic-b2b-foundations
plan: 01
subsystem: clinic-b2b-foundations
tags: [migrations, rls, rpcs, edge-functions, scaffolds, app-routing, stubs]
status: paused-at-checkpoint
checkpoint: task-2-human-action-blocking
checkpoint_reason: "supabase db push --linked + VALIDATION.md frontmatter flip (B-5)"
dependency_graph:
  requires:
    - "supabase/migrations/20260601000001_audit_logs.sql (Phase 7 audit_logs base)"
    - "supabase/migrations/20260601000017_audit_trigger_suppress_guc.sql (Phase 7 GUC suppression)"
    - "supabase/migrations/20260601000016_finalize_storage_bypass.sql (Phase 7 Storage delete bypass)"
    - "supabase/migrations/20260701000001_audit_logs_share_columns.sql (Phase 8 actor_type enum + share_view action)"
    - "supabase/functions/ai-chat/cors.ts (Phase 4 Edge Function CORS template)"
    - "src/App.tsx selectView pattern (Phase 5/7/8 hash-based routing precedent)"
    - "src/components/dashboard/settings/SettingsPage.tsx NAV array (Phase 8 'shares' precedent)"
  provides:
    - "13 SQL migrations (orgs schema + RLS + 16 RPCs + has_permission + broadcast trigger + realtime.messages RLS)"
    - "src/types/clinic.ts strict-shape Org/Membership/Invite/Role/Permission/ConsentScope + isConsentScope guard"
    - "Wave-0 Edge Function scaffolds: clinic-invite + clinic-photo (deno.json + cors.ts + index.test.ts)"
    - "6 RLS impersonation specs (orgs/memberships/invites/roles/role_permissions/org-logos-storage)"
    - "8 Playwright pitfall scaffolds (5 Pitfall #8 + revoke-latency + photo-access + role-permission-grid)"
    - "App.tsx 3 lazy clinic chunks + path-based routing for /clinic/* and /clinic-invite/*"
    - "4 stub component files (ClinicWorkspace, ClinicSettingsPage, ClinicInvitePage, ActiveOrganizationsSection) for Wave 2 plans to overwrite in place"
    - "scripts/assert-clinic-bundle-budget.sh — per-chunk + index ceilings"
    - "SettingsPage 'organizations' nav entry + render branch wired"
  affects:
    - "Plans 09-02..09-11 (every Wave 2/3/4 plan binds against this foundation)"
    - "ROADMAP Phase 9 schema gate (CLINIC-01..03 + CLINIC-06..07 wave-0 readiness)"
tech-stack:
  added:
    - "Postgres role_permissions junction + permissions catalog"
    - "realtime.broadcast_changes() pattern (NEW in this codebase — supersedes postgres_changes for cross-tenant)"
    - "has_permission() SECURITY DEFINER STABLE single RLS dispatch primitive"
  patterns:
    - "Default-deny RLS (SELECT-only policies; all writes via SECURITY DEFINER RPCs) — Phase 7 audit_logs precedent extended"
    - "GUC-bypass cascade (app.suppress_audit + storage.allow_delete_query) — Phase 7 finalize_account_deletion precedent"
    - "Forward-reference policies (orgs/roles/role_permissions/memberships/invites RLS USING has_permission resolved at plan time, not DDL)"
    - "Strict-shape jsonb (ConsentScope 10-key tuple — Pitfall #8 drift mitigation in TS + plpgsql)"
    - "B-2 stub-overwrite ownership (this plan creates App.tsx + 4 stubs; Wave 2 plans only OVERWRITE stubs)"
key-files:
  created:
    - "supabase/migrations/20260801000001_audit_logs_org_columns.sql"
    - "supabase/migrations/20260801000002_orgs.sql"
    - "supabase/migrations/20260801000003_org_logos_storage.sql"
    - "supabase/migrations/20260801000004_audit_logs_org_fk.sql"
    - "supabase/migrations/20260801000005_permissions.sql"
    - "supabase/migrations/20260801000006_roles.sql"
    - "supabase/migrations/20260801000007_memberships.sql"
    - "supabase/migrations/20260801000008_invites.sql"
    - "supabase/migrations/20260801000009_has_permission_fn.sql"
    - "supabase/migrations/20260801000010_seed_system_roles_trigger.sql"
    - "supabase/migrations/20260801000011_clinic_rpcs.sql"
    - "supabase/migrations/20260801000012_realtime_messages_rls.sql"
    - "supabase/migrations/20260801000013_broadcast_membership_changes_trigger.sql"
    - "supabase/functions/clinic-invite/{deno.json,index.test.ts,cors.ts}"
    - "supabase/functions/clinic-photo/{deno.json,index.test.ts,cors.ts}"
    - "leanshot/e2e/rls-orgs.test.ts"
    - "leanshot/e2e/rls-memberships.test.ts"
    - "leanshot/e2e/rls-invites.test.ts"
    - "leanshot/e2e/rls-roles.test.ts"
    - "leanshot/e2e/rls-role-permissions.test.ts"
    - "leanshot/e2e/rls-org-logos-storage.test.ts"
    - "leanshot/e2e/clinic-pitfall-8-existing-user-invited.spec.ts"
    - "leanshot/e2e/clinic-pitfall-8-no-user-invited.spec.ts"
    - "leanshot/e2e/clinic-pitfall-8-existing-user-two-invites.spec.ts"
    - "leanshot/e2e/clinic-pitfall-8-invited-never-accepts.spec.ts"
    - "leanshot/e2e/clinic-pitfall-8-accepts-then-rejects.spec.ts"
    - "leanshot/e2e/clinic-revoke-latency.spec.ts"
    - "leanshot/e2e/clinic-photo-access.spec.ts"
    - "leanshot/e2e/clinic-role-permission-grid.spec.ts"
    - "leanshot/src/types/clinic.ts"
    - "leanshot/src/components/clinic/ClinicWorkspace.tsx (stub)"
    - "leanshot/src/components/clinic/settings/ClinicSettingsPage.tsx (stub)"
    - "leanshot/src/components/clinic-invite/ClinicInvitePage.tsx (stub)"
    - "leanshot/src/components/dashboard/settings/sections/ActiveOrganizationsSection.tsx (stub)"
    - "leanshot/scripts/assert-clinic-bundle-budget.sh"
  modified:
    - "leanshot/src/App.tsx (3 lazy clinic chunks + View type extended + selectView pathname-aware + popstate listener + 3 render branches)"
    - "leanshot/src/components/dashboard/settings/SettingsPage.tsx ('organizations' Section + NAV entry between 'shares' and 'recovery' + render branch + Building2 icon import)"
decisions:
  - "Plan 09-01 paused at Task 2 (human-action blocking). All 9-1a/9-1b artifacts committed to worktree branch in commits d7d601a + 3f60896. supabase db push deferred to orchestrator-mediated human checkpoint."
  - "List_org_members RPC returns masked email (first 2 chars + '…@domain') for accepted members, full email for pending invites — privacy minimization for non-operator roles with members.list."
  - "_validate_consent_scope private helper added to migration 11 (NOT one of the 16 plan-listed public RPCs) so accept_invite_*/update_consent_scope can enforce 10-key strict shape at the DB layer in addition to the TS isConsentScope guard."
  - "App.tsx selectView signature extended to take pathname (was just hash); popstate listener added so back/forward across path-based clinic routes refreshes the view."
metrics:
  duration_minutes: ~50
  tasks_complete: 2
  tasks_total: 3
  files_created: 32
  files_modified: 2
  completed: 2026-05-13
---

# Phase 9 Plan 01: Foundation Slice Summary

13 SQL migrations + 16 SECURITY DEFINER RPCs + has_permission helper + Realtime broadcast trigger + 6 RLS impersonation specs + 8 Playwright pitfall scaffolds + Wave-0 Edge Function scaffolds + strict-shape TypeScript types + App.tsx path-based routing + 4 stub components — paused at Task 2 (human-action checkpoint for `supabase db push --linked`).

## Status

**PAUSED at Task 2 (human-action checkpoint, gate=blocking).**

Tasks 1a + 1b complete (commits `d7d601a` + `3f60896` on `worktree-agent-a0759fa1211283305`). Task 2 requires the orchestrator to run `supabase db push --linked` against the live project ref `ytnsipxxmzgaebkqmokp`, then run the 6 RLS impersonation specs, then flip the VALIDATION.md frontmatter (`wave_0_complete: true` + `nyquist_compliant: true`).

The worktree-mode addendum from memory `project_worktree_supabase_cli.md` applies: the migration files exist in the worktree's `supabase/migrations/` path; the orchestrator (or main-repo CLI invocation) must ensure the same files are present in the main repo tree before `supabase db push` can succeed (Supabase CLI side-effects on the main tree, not the worktree).

## What landed (Tasks 1a + 1b)

### Migrations (13 SQL files, in apply order)

| # | File | Provides |
|---|------|----------|
| 01 | `20260801000001_audit_logs_org_columns.sql` | `org_id` nullable column + `audit_actor_type` adds `org_operator`+`org_member` + action whitelist extended with 13 clinic actions + IMMUTABLE-safe partial index `audit_logs_clinic_actor_idx` |
| 02 | `20260801000002_orgs.sql` | `orgs` table + slug CHECK (kebab + reserved-word blocklist) + `UNIQUE(lower(slug))` + RLS `orgs_select_by_member` + supabase_realtime publication add |
| 03 | `20260801000003_org_logos_storage.sql` | `org-logos` bucket (public=true, png/jpeg, 2MB cap) + 4 Storage policies (select for all + insert/update/delete gated on `has_permission(uid, foldername[1]::uuid, 'org.update')`) |
| 04 | `20260801000004_audit_logs_org_fk.sql` | FK `audit_logs.org_id → orgs(id) ON DELETE SET NULL` (deferred so orgs exists first) |
| 05 | `20260801000005_permissions.sql` | `permissions` table + 10 seed rows + `permissions_read_all` RLS |
| 06 | `20260801000006_roles.sql` | `roles` + `role_permissions` tables + RLS gated via `has_permission` for SELECT |
| 07 | `20260801000007_memberships.sql` | `memberships` table + Pitfall #8 `UNIQUE(user_id, org_id) WHERE revoked_at IS NULL` partial index + RLS `memberships_select_own` + `memberships_select_by_org_member` + supabase_realtime publication add |
| 08 | `20260801000008_invites.sql` | `invites` table + hashed token + 7-day expiry + IMMUTABLE-safe partial index (no `now()` in predicate) + deferred FK `memberships.invited_from_invite_id → invites(id)` + RLS `invites_select_by_org_manager` |
| 09 | `20260801000009_has_permission_fn.sql` | `has_permission(uuid,uuid,text)` SECURITY DEFINER **STABLE** with `set search_path = public, extensions, pg_catalog` |
| 10 | `20260801000010_seed_system_roles_trigger.sql` | AFTER INSERT trigger `orgs_seed_system_roles_trigger` seeds Owner (10 keys) + Coach (4 keys) + View-only (3 keys) |
| 11 | `20260801000011_clinic_rpcs.sql` | 16 SECURITY DEFINER RPCs (B-4 includes `list_org_members`) + private `_validate_consent_scope` helper. `delete_org` uses BOTH `app.suppress_audit` and `storage.allow_delete_query` GUCs (gotchas #3+#4). |
| 12 | `20260801000012_realtime_messages_rls.sql` | `realtime.messages` SELECT policy parses topic prefix (`org:` → `has_permission(uid, parsed, 'org.read')`; `user:` → `auth.uid() = parsed`; else false) |
| 13 | `20260801000013_broadcast_membership_changes_trigger.sql` | `broadcast_membership_changes()` SECURITY DEFINER + AFTER INSERT/UPDATE/DELETE trigger broadcasting to BOTH `org:<id>` and `user:<id>` topics |

### 16 SECURITY DEFINER RPCs in Migration 11

`create_org`, `update_org`, `delete_org`, `send_invite`, `cancel_invite`, `accept_invite_existing`, `accept_invite_new`, `reject_invite`, `revoke_membership`, `update_consent_scope`, `update_member_role`, `create_role`, `update_role`, `delete_role`, `log_clinic_event`, `list_org_members`.

All use `set search_path = public, extensions, pg_catalog` (memory gotcha #2). All write inline `audit_logs` rows. All non-Edge-Function-callers `revoke all from public; grant execute to authenticated`. `log_clinic_event` granted to `service_role` (called by Edge Function with service-role key).

### Wave-0 test scaffolds

- **Edge Functions:** `supabase/functions/clinic-invite/{deno.json,index.test.ts,cors.ts}` and `supabase/functions/clinic-photo/{deno.json,index.test.ts,cors.ts}`. CORS mirrors `ai-chat/cors.ts` (`Access-Control-Allow-Origin: *`, no credentials per Pitfall #11). Test files use `.test.ts` suffix per memory `reference_deno_test_discovery.md`.
- **6 RLS impersonation specs** (`leanshot/e2e/rls-{orgs,memberships,invites,roles,role-permissions,org-logos-storage}.test.ts`): real two-user vitest tests gated on `SUPABASE_SERVICE_ROLE_KEY` env var. Each tests cross-tenant isolation; `rls-memberships.test.ts` also asserts the Pitfall #8 UNIQUE invariant (23505 on duplicate active membership); `rls-roles.test.ts` asserts the trigger seeded exactly 3 system roles; `rls-role-permissions.test.ts` asserts `delete_role` rejects `is_system=true`; `rls-org-logos-storage.test.ts` asserts the per-org Storage write gate.
- **8 Playwright pitfall spec scaffolds** (`leanshot/e2e/clinic-pitfall-8-*.spec.ts`, `clinic-revoke-latency.spec.ts`, `clinic-photo-access.spec.ts`, `clinic-role-permission-grid.spec.ts`): `test.fixme()`'d with explicit references to which downstream plan owns the green implementation.

### Frontend foundation

- **`src/types/clinic.ts`:** strict-shape `Org`, `Membership`, `Invite`, `Role`, `Permission`, `ConsentScope` + `DATA_TYPE_KEYS` and `PERMISSION_KEYS` const tuples + `DATA_TYPE_LABELS` for UI rendering + `isConsentScope` runtime guard (rejects partial / extra / non-boolean keys — Pitfall #8 jsonb drift defense).
- **App.tsx routing (B-2):** 3 `React.lazy` imports for the 3 clinic chunks; `View` type extended; `selectView` extended to take `pathname` and dispatch to `clinic-invite` (anonymous), `clinic-settings` (gated on user, before base `/clinic/`), `clinic` (gated on user, base); `popstate` listener added alongside `hashchange` so back/forward across path-based routes refreshes the view; 3 render branches inside `<Suspense>`.
- **4 stub components:** `ClinicWorkspace`, `ClinicSettingsPage`, `ClinicInvitePage`, `ActiveOrganizationsSection` — each contains the literal string `Phase 9 stub` so Wave 2 plans (09-02/03/04/05) can OVERWRITE the stub bodies in place without touching App.tsx (B-2 fix per plan-checker iter 1).
- **SettingsPage NAV:** `'organizations'` entry added between `'shares'` and `'recovery'` with `Building2` icon; render branch `{section === 'organizations' && <ActiveOrganizationsSection />}` wired.
- **Bundle-size guard:** `scripts/assert-clinic-bundle-budget.sh` — per-chunk ceilings (clinic ≤12 kB, clinic-settings ≤14 kB, clinic-invite ≤6 kB) + Phase 9 working index ceiling 24.5 kB + absolute 50 kB. Wave-0 friendly: missing chunks log a `wave-0` notice rather than failing (the index ceiling protects the floor while stubs are tiny enough to inline).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Critical Functionality] Added `_validate_consent_scope` private helper to migration 11**
- **Found during:** Task 1b
- **Issue:** Plan listed 16 public RPCs but acceptance + scope-edit RPCs needed a 10-key strict-shape validator at the DB layer (Pitfall #8 jsonb drift defense). Without it, the only enforcement was the TS `isConsentScope` guard — bypassable by anyone who calls the RPC directly.
- **Fix:** Added private `public._validate_consent_scope(jsonb)` plpgsql function (IMMUTABLE) called by `accept_invite_existing`, `accept_invite_new`, `update_consent_scope`. Raises `22023` on missing/extra/non-boolean keys.
- **Files modified:** `supabase/migrations/20260801000011_clinic_rpcs.sql`
- **Commit:** `3f60896`

**2. [Rule 2 - Critical Functionality] App.tsx popstate listener added**
- **Found during:** Task 1b
- **Issue:** Phase 9 introduces PATH-based routes (`/clinic/*`, `/clinic-invite/*`) but App.tsx's `useEffect` only listened to `hashchange`. Browser back/forward across path-based clinic routes wouldn't refresh the view — the user would land on the wrong surface.
- **Fix:** Added `window.addEventListener('popstate', recompute)` alongside `hashchange`. Both removed in cleanup.
- **Files modified:** `leanshot/src/App.tsx`
- **Commit:** `3f60896`

**3. [Rule 2 - Critical Functionality] `list_org_members` masked-email return for accepted members**
- **Found during:** Task 1b
- **Issue:** Plan said "returns first-name-initial + role" but the schema has no `first_name` column — only `auth.users.email`. Returning the full email to non-operator members with `members.list` (e.g., Coach role) over-shares PII.
- **Fix:** RPC returns the local-part-prefix (first 2 chars) + `…@<domain>` mask for accepted members; full email retained for pending invites only (which the operator already has via the invite they created).
- **Files modified:** `supabase/migrations/20260801000011_clinic_rpcs.sql`
- **Commit:** `3f60896`

### Out-of-scope (deferred)

- **Pre-existing SharePage lint errors (9 errors in `src/components/share/SharePage.tsx` and `src/components/share/SharePage.test.tsx`):** noted in memory `project_phase8_wave1_executed.md` as "7 pre-existing SharePage lint errors". My new code adds zero new lint errors. Out of scope for Phase 9 Plan 09-01 — to be addressed in a future hardening pass.

## Task 2 (BLOCKING checkpoint) — what the orchestrator must do

1. **Push migrations** against the live project. From the MAIN repo tree (worktree-mode addendum):
   ```
   cd /Users/karstenhaldan/minisite/leanshot && supabase db push --linked --include-all
   ```
   (Or the equivalent invocation honouring the worktree-side-effect noted in memory `project_worktree_supabase_cli.md` — orchestrator likely cleans the untracked main-tree copies pre-merge.)

2. **Verify** via psql or Supabase dashboard SQL editor:
   - `select migration from supabase_migrations.schema_migrations where migration like '20260801%' order by migration;` → 13 rows.
   - `select count(*) from public.permissions;` → 10
   - `select proname, provolatile from pg_proc where proname='has_permission';` → `('has_permission','s')`
   - `select tgname from pg_trigger where tgname in ('orgs_seed_system_roles_trigger','memberships_broadcast_trigger');` → 2 rows
   - `select policyname from pg_policies where tablename='messages' and schemaname='realtime' and policyname='clinic_org_topic_select';` → 1 row
   - `select count(*) from pg_proc where proname in ('create_org','update_org','delete_org','send_invite','cancel_invite','accept_invite_existing','accept_invite_new','reject_invite','revoke_membership','update_consent_scope','update_member_role','create_role','update_role','delete_role','log_clinic_event','list_org_members');` → **16**

3. **Run the 6 RLS impersonation specs:**
   ```
   cd /Users/karstenhaldan/minisite/leanshot && SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run test:e2e:rls -- 'rls-(orgs|memberships|invites|roles|role-permissions|org-logos-storage)\.test\.ts'
   ```
   All 6 should pass (cross-tenant isolation + Pitfall #8 + system-role-immutability + Storage RLS).

4. **Flip VALIDATION.md frontmatter** (B-5 fix per plan-checker iter 1):
   ```yaml
   nyquist_compliant: true   # was false
   wave_0_complete: true     # was false
   ```
   Commit with message: `docs(09-01): flip Wave-0 + nyquist flags after db push`.

5. **If push fails:** capture the exact error and apply fixes per memory `reference_supabase_migration_gotchas.md` (search_path / IMMUTABLE / Storage delete / GUC suppression). All 4 known gotchas were applied preventively in this plan, so push should succeed; new failure modes signal a missing migration ordering or a forward-reference timing issue.

## Threat Flags

None — all surfaces are within the threat model declared in 09-01-PLAN.md `<threat_model>`. Mitigations applied:
- T-09-01..06 (RLS) — `has_permission` dispatch + RLS on all 6 surfaces + impersonation specs.
- T-09-07 (Pitfall #1 race) — `accept_invite_*` enforces UNIQUE partial index at the DB layer; no `findOrCreateUser` path exists.
- T-09-08 (slug squat) — `UNIQUE(lower(slug))` + reserved-word blocklist CHECK.
- T-09-09 (SVG XSS) — bucket `allowed_mime_types = ARRAY['image/png','image/jpeg']`; SVG excluded.
- T-09-10 (Realtime non-member subscribe) — `realtime.messages` RLS dispatches to `has_permission`; revoke-latency e2e in Plan 09-10 is the negative-space test.
- T-09-11 (audit write race) — `log_clinic_event` is a SECURITY DEFINER RPC; failure surfaces as 500 to caller.
- T-09-12 (token brute-force) — token entropy via `gen_random_bytes(16)` (128-bit) inside `send_invite`; rate-limit deferred to Plan 09-06.

## Self-Check

```
FOUND: supabase/migrations/20260801000001_audit_logs_org_columns.sql
FOUND: supabase/migrations/20260801000002_orgs.sql
FOUND: supabase/migrations/20260801000003_org_logos_storage.sql
FOUND: supabase/migrations/20260801000004_audit_logs_org_fk.sql
FOUND: supabase/migrations/20260801000005_permissions.sql
FOUND: supabase/migrations/20260801000006_roles.sql
FOUND: supabase/migrations/20260801000007_memberships.sql
FOUND: supabase/migrations/20260801000008_invites.sql
FOUND: supabase/migrations/20260801000009_has_permission_fn.sql
FOUND: supabase/migrations/20260801000010_seed_system_roles_trigger.sql
FOUND: supabase/migrations/20260801000011_clinic_rpcs.sql (17 functions: 16 RPCs + _validate_consent_scope helper)
FOUND: supabase/migrations/20260801000012_realtime_messages_rls.sql
FOUND: supabase/migrations/20260801000013_broadcast_membership_changes_trigger.sql
FOUND: 6 RLS specs + 8 Playwright scaffolds + 6 Edge Function scaffold files + clinic.ts + 4 stubs
FOUND commit d7d601a (Task 1a — migrations 1-9 + clinic.ts + bundle script)
FOUND commit 3f60896 (Task 1b — migrations 10-13 + 16 RPCs + scaffolds + App.tsx + 4 stubs)
```

## Self-Check: PASSED
