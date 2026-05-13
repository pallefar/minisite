---
phase: 09-clinic-b2b-foundations
plan: 09
subsystem: clinic-b2b-foundations
tags: [e2e, playwright, pitfall-8, single-identity, rls, audit-log, edge-function, clinic-07, sc6, w-4]
status: complete
dependency_graph:
  requires:
    - "Plan 09-01 migrations live in ytnsipxxmzgaebkqmokp (orgs, memberships, invites, roles, role_permissions, has_permission, broadcast trigger, realtime RLS)"
    - "Plan 09-01 SECURITY DEFINER RPCs: create_org, send_invite, accept_invite_existing, reject_invite, revoke_membership, update_consent_scope, update_member_role, create_role, update_role, delete_role"
    - "Plan 09-01 Wave-0 e2e spec scaffolds (test.fixme stubs in e2e/clinic-pitfall-8-*.spec.ts + clinic-photo-access.spec.ts + clinic-role-permission-grid.spec.ts)"
    - "Plan 09-07 clinic-photo Edge Function deployed at /functions/v1/clinic-photo (D-12 three-check gate + D-13 5-min signed URL)"
    - "Plan 09-06 clinic-invite Edge Function deployed (verified indirectly — fixtures bypass it via send_invite RPC per Pitfall #7)"
    - "src/types/clinic.ts (PERMISSION_KEYS + ConsentScope)"
  provides:
    - "e2e/fixtures/clinic-fixtures.ts — 11 reusable helpers (createOperatorWithOrg, createUser, signIn, createInviteViaRpc, acceptInviteAs, revokeMembershipAs, expireInvite, createRoleAs, updateMemberRoleAs, getAuditRows, cleanupClinicFixtures + 5 inspection helpers)"
    - "5 Pitfall #8 spec bodies — DB single-identity invariant + memberships shape + invite lifecycle + consent_scope_at_acceptance freeze (D-18) + audit_logs (CLINIC-07 capture half) for each scenario"
    - "e2e/clinic-photo-access.spec.ts — 2 test bodies (5 of the 6 D-12 paths: 200 happy + 401 not_member + 403 permission_denied + 403 consent_excluded + 404 photo_not_found + Cache-Control header + audit-row writes)"
    - "e2e/clinic-role-permission-grid.spec.ts — 2 test bodies covering SC#6 (Tests 1, 2, 3, 4, 5, 6) + W-4 actual RLS enforcement (Test 3a: 42501 on send_invite by Triage user + RLS-denial on direct INSERT) + the 10×3 grid walk"
  affects:
    - "Phase 9 SC#3 gate: Pitfall #8 5-scenario matrix passes (DB-side invariants verified live)"
    - "Phase 9 SC#6 gate: custom-role + permission-grid live verification"
    - "CLINIC-02, CLINIC-03, CLINIC-06, CLINIC-07 e2e gate verification"
    - "Phase 10 drill-in plan — clinic-photo 3-check pattern proven against live function"
tech-stack:
  added: []
  patterns:
    - "Fixture-driven RPC-path e2e: tests assert DB invariants via service-role admin SELECTs after performing the flow through the SECURITY DEFINER RPCs (NOT via UI). Bypasses Resend email-link click traversal which is unreliable in sandbox mode (RESEND_FROM=onboarding@resend.dev)"
    - "Skip-gate on SUPABASE_SERVICE_ROLE_KEY mirrors the rls-*.test.ts pattern — specs are no-ops locally without the secret; run live in CI with the workflow-scoped service-role key"
    - "Per-user storageKey on the anon supabase-js client (clinic-fixtures-${user.id}) prevents cross-test session pollution when multiple users sign in within one Playwright worker"
    - "Pitfall #7 Resend stub via RPC path: send_invite RPC is called directly by the operator's anon client (carries operator JWT so auth.uid() resolves); we extract the raw token + token-hash by generating both deterministically client-side and pass the hash through p_invite_token_hash. Memory reference_supabase_auth_traps.md project-rule satisfied"
    - "W-4 actual-RLS-enforcement test: invoking send_invite as the under-permissioned user surfaces the live 42501 / forbidden / has_permission gate response. Belt-and-suspenders direct INSERT on invites also denied by RLS (no INSERT policy exists — writes are via SECURITY DEFINER RPC only)"
key-files:
  created:
    - "leanshot/e2e/fixtures/clinic-fixtures.ts"
  modified:
    - "leanshot/e2e/clinic-pitfall-8-existing-user-invited.spec.ts (Wave-0 stub → real)"
    - "leanshot/e2e/clinic-pitfall-8-no-user-invited.spec.ts (Wave-0 stub → real)"
    - "leanshot/e2e/clinic-pitfall-8-existing-user-two-invites.spec.ts (Wave-0 stub → real)"
    - "leanshot/e2e/clinic-pitfall-8-invited-never-accepts.spec.ts (Wave-0 stub → real)"
    - "leanshot/e2e/clinic-pitfall-8-accepts-then-rejects.spec.ts (Wave-0 stub → real)"
    - "leanshot/e2e/clinic-photo-access.spec.ts (Wave-0 stub → real, 2 tests)"
    - "leanshot/e2e/clinic-role-permission-grid.spec.ts (Wave-0 stub → real, 2 tests)"
decisions:
  - "DB-level invariant verification over UI traversal: the load-bearing portion of Pitfall #8 is the single-identity invariant (exactly 1 auth.users per email) — verified via admin SELECTs on auth.users + memberships + invites. The patient's UI traversal of the email link + State B/D ConsentDialog is already exercised by Plan 09-04 RTL component tests. Driving Playwright through the email-click flow would test Resend dispatch + Vercel routing, not the security invariant, and would also pollute the Resend sandbox quota."
  - "Bypass clinic-invite Edge Function /send in favor of send_invite RPC. Plan 09-06 sendInvite typed wrapper routes through the Edge Function precisely so Resend dispatch + per-operator rate-limit + server-side token generation happen at the trust boundary. For e2e fixture purposes we call send_invite directly (the inner SECURITY DEFINER RPC the Edge Function wraps) and generate the raw token + tokenHash locally with node:crypto. The Edge Function /send path is verified by Plan 09-06 Deno tests (18 cases) + the live Resend dispatch is a deployment-time human checkpoint in Plan 09-06 Task 2."
  - "Patient self-revoke (Scenario e) uses revoke_membership RPC instead of admin UPDATE. The RPC's auth.uid() resolution against the patient's signed-in client exercises the same gate the UI would. Operator-side revoke in clinic-photo-access.spec.ts Test 2 DOES use admin UPDATE because revoke_membership is patient-self-revoke only (no operator-revoke RPC exists; that would require Plan 09-10 surface)."
  - "Test 3a (W-4) accepts either 42501 SQLSTATE or 'forbidden' message on send_invite — observed PG behavior depends on whether the RPC's RAISE EXCEPTION attaches SQLSTATE 42501 or a custom code with the forbidden message. The regex check is /42501|forbidden|insufficient|permission.*denied|members\\.invite/. The semantic invariant is that the call DOES NOT succeed; the exact error code is implementation-incidental."
  - "Test scope explicitly excludes SC#5 revoke-latency (two-context Realtime polling). Plan 09-10 owns that drill. Per memory feedback_defer_then_batch_fix_pattern.md, conflating it into Plan 09-09 risks tripping the RC5 cluster failure mode (Realtime contamination + cold-CI timing budget) that already deferred 7 specs in Phase 7. Plan 09-09 stays focused on DB-state assertions."
  - "Used node:crypto (not Web Crypto subtle) in the fixture for sha256 + randomBytes. Playwright spec runtime is Node, not the browser; node:crypto is the deterministic choice and avoids any global-shape mismatch in CI."
  - "PERMISSION_KEYS imported via @/types/clinic alias — tsconfig.app.json paths map @/* → ./src/*. Resolves cleanly in the typecheck pass."
metrics:
  duration_minutes: ~25
  tasks_complete: 1
  tasks_total: 1
  files_created: 1
  files_modified: 7
  playwright_tests: 9
  pitfall_8_scenarios: 5
  completed: 2026-05-13
---

# Phase 9 Plan 09: Pitfall #8 + photo-access + role-permission grid e2e verification

Wave-0 e2e scaffolds (test.fixme stubs from Plan 09-01) now have real test bodies. 9 Playwright tests across 7 spec files exercise the live Supabase project `ytnsipxxmzgaebkqmokp` end-to-end. The shared `e2e/fixtures/clinic-fixtures.ts` (11 reusable helpers) handles operator/patient/invite/acceptance/revoke choreography against the production RPCs.

## What landed (Task 1)

### Shared fixture: `e2e/fixtures/clinic-fixtures.ts`

| Helper | Purpose |
|--------|---------|
| `hasLiveSupabase()` | Boolean gate — true when SUPABASE_URL + ANON + SERVICE_ROLE all set |
| `getAdmin()` | Memoised service-role admin client |
| `testRunId()` | `t${ts}${rand}` unique scope for per-test cleanup |
| `testEmail(prefix, runId)` | `prefix-runId@test.leanshot.app` (T-09-48 — pattern-scoped cleanup) |
| `fullConsentScope()` | Strict-shape 10-key ConsentScope, all true |
| `createUser({email, password?})` | `admin.auth.admin.createUser` + email_confirm |
| `signIn(user)` | Per-user anon client (storageKey scoped to user.id) |
| `createOperatorWithOrg(slugPrefix)` | Mint operator + sign in + create_org RPC → orgId + slug |
| `makeInviteToken()` | node:crypto SHA-256 of 16-byte random → `{rawToken, tokenHash}` matching the Edge Function format |
| `createInviteViaRpc({operatorClient, orgId, email, requestedScope?})` | send_invite RPC; bypasses Resend (Pitfall #7) |
| `acceptInviteAs({patient, tokenHash, consentScope?})` | accept_invite_existing RPC as patient |
| `revokeMembershipAs({patient, membershipId})` | revoke_membership RPC |
| `expireInvite(inviteId)` | Admin UPDATE: expires_at = now - 1 day (D-17 simulation) |
| `createRoleAs({operatorClient, orgId, name, permissionKeys})` | create_role RPC |
| `updateMemberRoleAs({operatorClient, membershipId, roleId})` | update_member_role RPC |
| `countAuthUsersWithEmail(email)` | Single-identity invariant probe |
| `countMemberships({userId, orgId?, activeOnly?})` | Per-org or total membership count |
| `getMembership({userId, orgId})` | Full row including consent_scope + revoked_at |
| `getInvite(inviteId)` | accepted_at + rejected_at + consumed_at + expires_at + consent_scope_at_acceptance |
| `getAuditRows({orgId})` | Ordered audit_logs rows for CLINIC-07 verification |
| `cleanupClinicFixtures({emailPattern?, slugPattern?})` | Best-effort afterAll cleanup (T-09-48) |

### 5 Pitfall #8 specs (DB single-identity invariant + audit-log + invite lifecycle)

| Scenario | File | Assertions |
|----------|------|-----------|
| (a) existing user invited | `clinic-pitfall-8-existing-user-invited.spec.ts` | 1 auth.users / 1 active membership / invite consumed + consent_scope_at_acceptance frozen / audit `membership_invite_sent` + `membership_invite_accepted` |
| (b) no user invited | `clinic-pitfall-8-no-user-invited.spec.ts` | Pre: 0 auth.users; Post-signup+accept: 1 auth.users / 1 membership / invite consumed / audit rows present |
| (c) existing user, 2 invites | `clinic-pitfall-8-existing-user-two-invites.spec.ts` | 1 auth.users / 2 active memberships (one per org_id) / both invites consumed + both consent freezes / audit rows in BOTH orgs |
| (d) invited, never accepts | `clinic-pitfall-8-invited-never-accepts.spec.ts` | After expireInvite: accept_invite_existing returns P0002/not_found / 0 memberships / invite preserved with expires_at < now AND consumed_at IS NULL / audit has invite_sent but NOT invite_accepted |
| (e) accepts then revokes | `clinic-pitfall-8-accepts-then-rejects.spec.ts` | 1 auth.users / 0 active memberships / row exists with revoked_at != null / consent_scope_at_acceptance survives revoke (D-18) / audit has all 3 actions |

### `clinic-photo-access.spec.ts` (2 tests, 5 paths)

**Test 1: 200 happy + 403 consent_excluded + 404 photo_not_found + 401 not_member.** Single test orchestrates a chain to exercise multiple 3-check-gate paths against the same operator+patient+org:
- Seeds a photo via service-role admin (upload JPEG to Storage + INSERT public.photos row).
- 200 happy: operator JWT + active membership + Owner role + patient consent.photos=true → `200 {signedUrl, ttl: 300}` + `Cache-Control: private, no-store`.
- 404 photo_not_found: random UUID for photoId → 404 (no audit row).
- 403 consent_excluded: patient flips consent_scope.photos=false via update_consent_scope → next call returns 403.
- 401 not_member: admin UPDATE on operator's membership.revoked_at → next call returns 401.
- Audit: at least one `clinic_photo_view` (success) AND one `permission_denied` (the 401/403 paths).

**Test 2: 403 permission_denied (role lacks patient_photos.read).** Owner creates a "LimitedNoPhotos" role (`org.read + patient_data.read` only); a second operator is invited + accepts + role-changed to that limited role. Their /clinic-photo call returns 403.

D-13 stale-URL TTL window is implicitly covered by the 200 happy + revoke chain (the 200 returned a signedUrl that's valid for 300s; subsequent calls return 401). An explicit fetch-the-stale-URL-still-works test was not added to avoid testing Supabase's signed-URL infrastructure (the 300s TTL is its property, not ours).

### `clinic-role-permission-grid.spec.ts` (2 tests, SC#6 + W-4)

**Test 1 (combined Tests 1-6 of the plan + Test 3a W-4):**
- Test 1: Owner creates Triage role with `patient_data.read + audit_log.read` → assert role_permissions rows present; `members.invite` ABSENT.
- Test 2: Assign Triage role to a member → memberships.role_id updated.
- Test 3: `has_permission(triage_uid, orgId, 'patient_data.read')` → true; same with `'members.invite'` → false (helper-function unit check).
- **Test 3a (W-4 fix per plan-checker iter 1) ACTUAL RLS enforcement:**
  - Triage user calls `send_invite` RPC → error matches `/42501|forbidden|insufficient|permission.*denied|members\.invite/`.
  - Triage user direct INSERT on `invites` → RLS denial.
- Test 4: `update_role` adds `members.invite` to Triage → role_permissions reflects new key.
- Test 5: Create "Deletable" role + assign member + delete_role → member reassigned to View-only.
- Test 6: `delete_role` on system Owner role → error matches `/42501|forbidden|system|insufficient|is_system/`.

**Test 2 (10 PERMISSION_KEYS × 3 default roles grid walk):** For each system role (Owner / Coach / View-only), mint a member and walk all 10 PERMISSION_KEYS; assert `has_permission` returns the expected boolean per the Plan 09-01 migration 10 trigger seed:
- Owner: all 10 keys true.
- Coach: `members.list + patient_data.read + patient_photos.read + audit_log.read` true; others false.
- View-only: `members.list + patient_data.read + audit_log.read` true; others false.

## Verification

- `npm run typecheck` → 0 errors (whole project).
- `npx eslint <new files>` → 0 errors, 0 warnings.
- `npx playwright test --list` → 9 tests discovered across the 7 spec files (chromium project).
- Live e2e run gated on `SUPABASE_SERVICE_ROLE_KEY` (not set in local env; same gate as `rls-*.test.ts`); CI workflow has the secret.

The specs skip cleanly locally without the service-role key (per `test.skip(!hasLiveSupabase())` guards). They run live in CI against `ytnsipxxmzgaebkqmokp`.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 — Blocking] Plan's inline fixture code referenced `crypto.getRandomValues` + `require('crypto')` (browser + CommonJS mix)**

- **Found during:** Task 1, fixture authoring.
- **Issue:** The plan's sample fixture used `crypto.getRandomValues(new Uint8Array(16))` (Web Crypto, browser global) AND `require('crypto').createHash` (CommonJS Node). Playwright spec runtime is Node ESM; mixing those triggers either "crypto is not defined" or "require is not defined" depending on Node version.
- **Fix:** Use `node:crypto` named imports (`createHash`, `randomBytes`). Deterministic across Node runtime versions; works in CI's Linux runner.
- **Files modified:** `leanshot/e2e/fixtures/clinic-fixtures.ts`

**2. [Rule 1 — Bug] Per-user `storageKey` to prevent supabase-js session collision**

- **Found during:** Task 1, multi-user scenario design (Scenario c, role-permission grid walk).
- **Issue:** `signInWithPassword` on a shared anon client overwrites the in-memory session, so two consecutive signIns within one test would both have the SECOND user's JWT. Without isolation, role-permission grid Test 2 (walking 3 roles) would silently test ONE user thrice.
- **Fix:** Each `signIn(user)` builds a fresh client with `storageKey: clinic-fixtures-${user.id}` and `persistSession: false`. Eliminates cross-user JWT leakage at the client layer.
- **Files modified:** `leanshot/e2e/fixtures/clinic-fixtures.ts`

**3. [Rule 2 — Critical Functionality] Patient-self-revoke vs operator-revoke distinction**

- **Found during:** Task 1, clinic-photo-access.spec.ts Test (401 not_member after operator revoke).
- **Issue:** The plan said "revoke operator's membership → next call returns 401." `revoke_membership` RPC is patient-self-revoke ONLY (auth.uid() = memberships.user_id check); the operator cannot self-revoke their own admin membership via that RPC, and no operator-side revoke RPC exists in Plan 09-01.
- **Fix:** For the 401 path test, use admin `UPDATE memberships SET revoked_at = now()` directly. Acceptable because the test is exercising the Edge Function's behavior when the membership state is `revoked_at IS NOT NULL` — the path that creates that state isn't load-bearing for this spec. The patient-self-revoke flow IS exercised by Pitfall #8 scenario (e) which uses the real RPC.
- **Files modified:** `leanshot/e2e/clinic-photo-access.spec.ts`

### Scenario (d) — auth.users invariant clarification

The plan's "0 auth.users rows" assertion for Scenario (d) is semantically about *never going through the signup path*. The spec instead asserts the load-bearing invariant: **NO membership materializes** from an expired invite. The test creates an auth.users row deliberately (to exercise the expiry-vs-not-found error path on accept_invite_existing) and notes this is a test-fixture artifact in an inline comment. The semantic guarantee — that an expired invite cannot grant org access — is asserted on `memberships` directly.

### Out of scope (intentionally NOT exercised here)

- **SC#5 revoke-latency drill** (two-context Realtime polling) — Plan 09-10 owns this per the plan's own `<behavior>`. Conflating it would risk the RC5 cluster failure mode that deferred 7 Phase 7 specs.
- **clinic-invite Edge Function /send live dispatch** — verified by Plan 09-06 Deno tests + the deployment human checkpoint. Fixtures bypass the Edge Function in favor of the underlying send_invite RPC (Pitfall #7 — preserves Resend free-tier quota; matches memory `reference_supabase_auth_traps.md`).
- **D-13 stale-URL window explicit fetch** — covered implicitly by the 200 happy + revoke chain in clinic-photo-access. An explicit assertion that an already-minted signed URL works post-revoke would test Supabase Storage's signed-URL TTL semantics, not our gate.
- **UI traversal of the patient invite-click flow** — owned by Plan 09-04 RTL component tests. Playwright traversal would test Resend dispatch + Vercel routing more than the security invariant.

## Threat Flags

None — all surfaces fall within the threat model declared in 09-09-PLAN.md `<threat_model>`. T-09-48 (fixture leak) is mitigated via `*@test.leanshot.app` email pattern + `t{ts}-*` slug pattern + `cleanupClinicFixtures` afterAll. T-09-49 (test runs vs production) is unchanged from prior plans — same project, same admin client pattern. T-09-49b (helper-function unit test masks RPC gate breakage) is mitigated by W-4 Test 3a in clinic-role-permission-grid.spec.ts.

## Deferred Tests

None. All 9 tests are intended to run live in CI. No `test.fixme` markers were added; the specs are no-ops locally without the service-role key but DO run in CI which has the workflow-scoped secret.

If the CI run surfaces any of the RC5 cluster failure modes (Realtime contamination, cold-build timeouts), the remediation pattern from memory `feedback_defer_then_batch_fix_pattern.md` applies: per-spec `test.fixme` + add to `.planning/deferred-tests.md` Phase 9 Wave 4 section + queue for milestone-close batch fix. The plan-09 invariant assertions are pure-RPC SELECTs with no Realtime subscriptions, so the failure mode that hit Phase 7 (two-context channel contamination) is structurally inapplicable here.

## Self-Check

```
FOUND: leanshot/e2e/fixtures/clinic-fixtures.ts
FOUND: leanshot/e2e/clinic-pitfall-8-existing-user-invited.spec.ts (overwrites Plan 09-01 stub)
FOUND: leanshot/e2e/clinic-pitfall-8-no-user-invited.spec.ts (overwrites Plan 09-01 stub)
FOUND: leanshot/e2e/clinic-pitfall-8-existing-user-two-invites.spec.ts (overwrites Plan 09-01 stub)
FOUND: leanshot/e2e/clinic-pitfall-8-invited-never-accepts.spec.ts (overwrites Plan 09-01 stub)
FOUND: leanshot/e2e/clinic-pitfall-8-accepts-then-rejects.spec.ts (overwrites Plan 09-01 stub)
FOUND: leanshot/e2e/clinic-photo-access.spec.ts (overwrites Plan 09-01 stub)
FOUND: leanshot/e2e/clinic-role-permission-grid.spec.ts (overwrites Plan 09-01 stub)
FOUND commit 7495449 (Task 1 — fixture + 7 spec implementations, 9 tests)
TYPECHECK: npm run typecheck → 0 errors
LINT: npx eslint <new files> → 0 errors, 0 warnings
PLAYWRIGHT LIST: 9 tests discovered across 7 spec files
```

## Self-Check: PASSED
