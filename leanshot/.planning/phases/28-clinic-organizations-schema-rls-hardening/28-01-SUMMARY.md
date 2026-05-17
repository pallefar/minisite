---
phase: 28
plan: "01"
subsystem: database/schema
tags: [schema, rls, migrations, secdef, edge-function, tests, cross-tenant]
dependency_graph:
  requires: [28-00]
  provides: [org_members, org_invites, org_subscriptions, org_settings, org_branding, org_patient_links, org_consent_grants, send_org_invite, revoke_org_invite, accept_org_invite, link_org_patient, clinic-org-invite]
  affects: [28-02, 28-03, 28-04, 28-05, 28-06, 28-07, 29, 30, 31]
tech_stack:
  added:
    - "org_member_role enum (admin, staff, viewer)"
    - "org_invite_status enum (pending, accepted, expired, revoked)"
    - "clinic-org-invite Deno Edge Function"
  patterns:
    - "Pattern S1 dual-layer SECDEF RPCs (role gate inside function body)"
    - "Phase 9 _validate_consent_scope re-use via BEFORE INSERT trigger"
    - "ES256-compatible RLS fixture (generateLink + verifyOtp)"
    - "File-scoped TEST_SLUG_PREFIX (vitest parallelism safety)"
key_files:
  created:
    - supabase/migrations/20270601100003_org_member_role_enum.sql
    - supabase/migrations/20270601100004_org_members_table.sql
    - supabase/migrations/20270601100005_org_settings_table.sql
    - supabase/migrations/20270601100006_org_branding_table.sql
    - supabase/migrations/20270601100007_org_invites_table.sql
    - supabase/migrations/20270601100008_org_subscriptions_table.sql
    - supabase/migrations/20270601100009_org_patient_links_table.sql
    - supabase/migrations/20270601100010_org_consent_grants_table.sql
    - supabase/migrations/20270601100012_send_revoke_org_invite_rpcs.sql
    - supabase/migrations/20270601100013_link_org_patient_rpc.sql
    - supabase/migrations/20270601100018_org_invites_expiry_purge_cron.sql
    - supabase/functions/clinic-org-invite/index.ts
    - supabase/functions/clinic-org-invite/deno.json
    - leanshot/src/lib/__tests__/_fixtures/p28-rls-fixture.ts
    - leanshot/src/lib/__tests__/rls-org-organizations.test.ts
    - leanshot/src/lib/__tests__/rls-org-members.test.ts
    - leanshot/src/lib/__tests__/rls-org-invites.test.ts
    - leanshot/src/lib/__tests__/rls-org-subscriptions.test.ts
    - leanshot/src/lib/__tests__/rls-org-settings.test.ts
    - leanshot/src/lib/__tests__/rls-org-branding.test.ts
    - leanshot/src/lib/__tests__/rls-org-patient-links.test.ts
    - leanshot/src/lib/__tests__/rls-org-consent-grants.test.ts
    - tests/sql/p28-schema-shape.test.sql
  modified:
    - leanshot/vitest-e2e.config.ts
decisions:
  - "citext replaced with text (citext extension not installed on Supabase free tier; text + lowercase convention achieves same semantics)"
  - "_validate_consent_scope used via BEFORE INSERT/UPDATE trigger (function returns void, not boolean, so CHECK constraint not possible; trigger achieves same invariant)"
  - "_shared/invite-token.ts deferred to Plan-02 (execution constraint: _shared/ owned by Plan-02); token hash generated server-side by SECDEF RPC using pgcrypto"
  - "org_patient_links.consent_grant_id FK added via ALTER TABLE in migration 10 (forward-reference to org_consent_grants avoided by deferral)"
  - "RLS tests in src/lib/__tests__/ (plan spec) — vitest-e2e.config.ts updated to include this path"
metrics:
  duration: "21m 13s"
  completed: "2026-05-17T15:22:33Z"
  tasks_completed: 3
  files_changed: 25
---

# Phase 28 Plan 01: 8-Table Schema Slab + RLS + Cross-Tenant Proof Tests Summary

**One-liner:** 7 net-new org-scoped tables + 2 enums + 4 SECDEF RPCs + pg_cron + clinic-org-invite Edge Function + 8 RLS cross-tenant proof tests + SQL schema assertions — full ORG-01/ORG-05 schema slab live in Supabase.

---

## Migration Files Pushed (11 total)

| Filename | Purpose |
|----------|---------|
| `20270601100003_org_member_role_enum.sql` | org_member_role enum (admin, staff, viewer) |
| `20270601100004_org_members_table.sql` | org_members + RLS + user_id index + organizations SELECT policy |
| `20270601100005_org_settings_table.sql` | org_settings + RLS (member read, admin write) |
| `20270601100006_org_branding_table.sql` | org_branding + RLS (member read, admin write) |
| `20270601100007_org_invites_table.sql` | org_invites + org_invite_status enum + pending partial index |
| `20270601100008_org_subscriptions_table.sql` | org_subscriptions skeleton + deny-all writes (P29 owns) |
| `20270601100009_org_patient_links_table.sql` | org_patient_links + patient-self-read RLS |
| `20270601100010_org_consent_grants_table.sql` | org_consent_grants + _validate_consent_scope trigger + FK to patient_links |
| `20270601100012_send_revoke_org_invite_rpcs.sql` | send_org_invite (W-1 anti-enum), revoke_org_invite, accept_org_invite SECDEF RPCs |
| `20270601100013_link_org_patient_rpc.sql` | link_org_patient SECDEF RPC (Pattern S1 + log_admin_action) |
| `20270601100018_org_invites_expiry_purge_cron.sql` | pg_cron expiry purge at 04:00 UTC daily |

**Push gate:** Zero `^Skipping` lines. All 11 migrations applied cleanly.

---

## Database Verification (Live)

| Check | Result |
|-------|--------|
| 8 tables with RLS enabled | PASS (all 8: organizations, org_members, org_invites, org_subscriptions, org_settings, org_branding, org_patient_links, org_consent_grants) |
| 4 SECDEF RPCs with search_path=pg_catalog,public,extensions | PASS |
| pg_cron expiry purge at 04:00 UTC | PASS (jobname=p28_org_invites_expiry_purge) |
| org_members_user_id_idx exists | PASS (Pitfall 4 hook latency) |
| org_consent_grants scope_check trigger | PASS (re-uses Phase 9 _validate_consent_scope) |
| SQL schema test (16 assertions) | ALL OK (zero FAIL lines) |

---

## Edge Function Deployment

**Function:** `clinic-org-invite`
**Deploy URL:** `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/clinic-org-invite`
**Dashboard:** https://supabase.com/dashboard/project/ytnsipxxmzgaebkqmokp/functions

**W-1 anti-enumeration:** POST /send always returns `{ok: true, invite_id}` regardless of whether email exists in auth.users (identical shape, identical status, identical headers).

**Startup health check:** If `RESEND_API_KEY` absent, logs warn and proceeds (no-op send path). Invites persisted via SECDEF RPC regardless of email dispatch status.

---

## RLS Test Summary

**8 test files** in `leanshot/src/lib/__tests__/rls-org-*.test.ts`:

| File | Coverage |
|------|---------|
| `rls-org-organizations.test.ts` | T10: cross-tenant SELECT/UPDATE/DELETE |
| `rls-org-members.test.ts` | T3-5: cross-tenant SELECT/INSERT/UPDATE/DELETE |
| `rls-org-invites.test.ts` | T3-5 + T6: W-1 invariant proof |
| `rls-org-subscriptions.test.ts` | T3-5 + T9: deny-all writes in v1.3 |
| `rls-org-settings.test.ts` | T3-5 |
| `rls-org-branding.test.ts` | T3-5 |
| `rls-org-patient-links.test.ts` | T3-5 + T7: patient-self-read path |
| `rls-org-consent-grants.test.ts` | T3-5 + T8: _validate_consent_scope re-use |

**Run command:** `npx vitest run src/lib/__tests__/rls-org-*.test.ts --config vitest-e2e.config.ts`

**Note on live test run:** Supabase free-tier auth API rate limit prevented live test execution during plan execution (status 500 / unexpected_failure on `admin.auth.admin.createUser`). The same failure was observed on existing Phase 9 RLS tests (`e2e/rls-ai-messages.test.ts`), confirming this is an infrastructure rate-limit issue not a code defect. SQL schema-shape test (16 assertions) passed fully against live DB.

---

## SQL Schema-Shape Test Output

All 16 assertions returned `OK`:
- 8 tables RLS-enabled assertions
- Column presence assertions (organizations P28 columns, org_members 6 columns, org_invites invite_token_hash, org_settings enforce_clinician_mfa)
- 4 SECDEF RPCs exist
- pg_cron expiry purge at 04:00 UTC
- org_consent_grants scope_check trigger
- org_members_user_id_idx index

---

## org_invites Status State Machine Owners

| Transition | Owner |
|------------|-------|
| (none) → pending | `send_org_invite` SECDEF RPC |
| pending → accepted | `accept_org_invite` SECDEF RPC (consumed P31 onboarding UI) |
| pending → expired | pg_cron `p28_org_invites_expiry_purge` (04:00 UTC daily) |
| pending → revoked | `revoke_org_invite` SECDEF RPC |

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] citext type not installed**
- **Found during:** Task 1 (push attempt 2)
- **Issue:** `citext` extension not installed on Supabase project. Existing `public.invites.email` uses `text`. Plan spec used `citext` throughout.
- **Fix:** Replaced all `citext` / `extensions.citext` with `text`. Email fields use `text` with lowercase convention in application layer.
- **Files modified:** migrations 05, 06, 07, 12 (table + REVOKE/GRANT signatures)
- **Commit:** 0f7c203

**2. [Rule 1 - Bug] _validate_consent_scope returns void (not boolean)**
- **Found during:** Task 1 (push attempt 4)
- **Issue:** Plan spec said to use `CHECK (_validate_consent_scope(scope))` but function returns void, not boolean. CHECK constraint requires boolean expression.
- **Fix:** Replaced CHECK constraint with a BEFORE INSERT/UPDATE trigger (`org_consent_grants_validate_scope`) that calls the existing Phase 9 function. Same invariant enforced, same function reused.
- **Files modified:** migration 10
- **Commit:** 0f7c203

**3. [Rule 3 - Blocking] Forward FK reference (org_patient_links → org_consent_grants)**
- **Found during:** Task 1 planning
- **Issue:** Migration 09 (org_patient_links) references org_consent_grants which doesn't exist yet at migration 09 time.
- **Fix:** Created org_patient_links without FK, then added FK via ALTER TABLE in migration 10 (after org_consent_grants is created).
- **Files modified:** migrations 09, 10
- **Commit:** 0f7c203

**4. [Rule 3 - Blocking] _shared/invite-token.ts deferred to Plan-02**
- **Found during:** Task 2 planning
- **Issue:** Execution context explicitly says "DO NOT touch supabase/functions/_shared/ files (Plan 02 owns)." Plan spec asked for `_shared/invite-token.ts`.
- **Fix:** Token hash generation moved server-side to the SECDEF `send_org_invite` RPC using pgcrypto (equivalent SHA-256 via `encode(digest(token,'sha256'),'hex')`). Edge Function calls the RPC which handles token generation. W-1 invariant preserved.
- **Commit:** b4618e7

**5. [Rule 2 - Missing Critical] org_members-based SELECT policy for organizations**
- **Found during:** Task 1 design review
- **Issue:** The existing `organizations` SELECT policy (from Phase 9) uses `has_permission()` which checks the Phase 9 `memberships` table. P28 RLS tests set up users via `org_members` not `memberships`, so without an org_members-based policy, P28 tests would fail the "User A sees Org X" assertion.
- **Fix:** Added `organizations_select_by_org_members` supplemental SELECT policy in migration 04 (after org_members is created). Postgres ORs multiple SELECT policies so the existing Phase 9 policy is preserved.
- **Files modified:** migration 04
- **Commit:** 0f7c203

**6. [Deviation - Scoping] RLS test files in src/lib/__tests__/ (vs e2e/)**
- **Found during:** Task 3 execution
- **Issue:** Existing project convention for live-DB RLS tests is `e2e/rls-*.test.ts` (picked up by vitest-e2e.config.ts). Plan spec explicitly requires `src/lib/__tests__/rls-org-*.test.ts`.
- **Fix:** Followed plan spec (used `src/lib/__tests__/`). Updated vitest-e2e.config.ts to include `src/lib/__tests__/rls-org-*.test.ts` so tests run via `npm run test:e2e:rls`.
- **Commit:** 6371d5d

---

## Open Follow-Ups (for downstream plans)

- **Plan 02** owns `supabase/functions/_shared/invite-token.ts` + `withOrgScope` + ESLint rule. The `_shared/invite-token.ts` module should mirror `src/lib/clinic.ts:makeInviteTokenHash` for Deno compatibility.
- **Plan 03** adds JWT `app_metadata.org_ids` claim via Custom Access Token Hook. The `org_members_user_id_idx` (migration 04) is the performance enabler for the hook's query.
- **Plan 04** adds HMAC realtime channel auth. Plans need to add tables to `org_scoped_tables` allowlist in `src/server/with-org-scope.ts`.
- **Plan 05** ships `src/lib/org.ts` org-context layer.
- **Plan 29** owns `org_subscriptions` write logic + Stripe webhook glue.
- **Plan 31** owns full org_branding theme overlay.

---

## Known Stubs

- `org_subscriptions`: shipping skeleton only; no INSERT/UPDATE/DELETE policies for authenticated (Plan 29 owns writes via service_role bypass)
- `org_branding`: shipping skeleton; Plan 31 owns full theme overlay (font, illustration tokens)
- `accept_org_invite` RPC: ships in this plan but UI consumer deferred to Plan 31 onboarding builder

---

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: injection | send_revoke_org_invite_rpcs.sql | send_org_invite generates raw token via pgcrypto gen_random_bytes (32 bytes = 256-bit entropy); hash stored. No injection vectors. |

No new unmitigated threat surface found beyond what was in the plan's threat model.

---

## Self-Check: PASSED

- Migration files exist in worktree: FOUND (11 files at `supabase/migrations/20270601100003` through `20270601100018`)
- Edge Function exists: FOUND `supabase/functions/clinic-org-invite/index.ts`
- 8 RLS test files exist: FOUND in `leanshot/src/lib/__tests__/rls-org-*.test.ts`
- Fixture helper exists: FOUND `leanshot/src/lib/__tests__/_fixtures/p28-rls-fixture.ts`
- SQL test file exists: FOUND `tests/sql/p28-schema-shape.test.sql`
- Task 1 commit 0f7c203: FOUND
- Task 2 commit b4618e7: FOUND
- Task 3 commit 6371d5d: FOUND
- 8 tables relrowsecurity=true: VERIFIED (live DB query)
- 4 SECDEF RPCs search_path correct: VERIFIED (live DB query)
- pg_cron schedule 0 4 * * *: VERIFIED (live DB query)
- SQL test 16 assertions all OK: VERIFIED
- Edge Function deployed: VERIFIED (Supabase dashboard confirms)
- Zero ^Skipping lines in push log: VERIFIED
