---
phase: 28
slug: clinic-organizations-schema-rls-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-17
---

# Phase 28 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `28-RESEARCH.md` §Validation Architecture; addended by `28-ADDENDUM-orgs-reconciliation.md`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 1.x (existing per `src/lib/clinic.test.ts`) + Playwright (existing per `e2e/`) + `supabase db query --linked` for SQL fixture/seed verification |
| **Config file** | `vitest.config.ts` (existing) + `playwright.config.ts` (existing) |
| **Quick run command** | `npx vitest run src/lib/__tests__/rls-org-* src/lib/__tests__/with-org-scope src/lib/__tests__/org` |
| **Full suite command** | `npm test -- --run && npm run test:e2e -- --grep 'p28'` |
| **Estimated runtime** | ~45 seconds quick; ~3–4 min full (RLS suite parallelizable; e2e adds ~90s) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/lib/__tests__/rls-org-* src/lib/__tests__/with-org-scope src/lib/__tests__/org` (per `[[feedback_rls_per_file_slug_prefix]]` — file-scoped slug prefix protects parallelism).
- **After every plan wave:** Run `npm test -- --run` (full Vitest sweep) + `npm run test:e2e -- --grep 'p28'`.
- **Before `/gsd:verify-work`:** Full suite must be green; cross-tenant impersonation proof passes for all 8 tables; channel-auth e2e proves CHANNEL_ERROR on mismatched org_id; `supabase db query --linked --file tests/sql/p28-schema-shape.test.sql` returns 0 rows missing.
- **Max feedback latency:** 45 seconds for the quick path; 4 minutes for the full path.

---

## Per-Task Verification Map

| Task ID (illustrative) | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|------------------------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 28-00-01 | 00 | 0 | (RECONCILE) | — | Phase 9 `public.orgs` renamed; RLS preserved | SQL integration | `supabase db query --linked --file tests/sql/p28-rename-verification.test.sql` | ❌ W0 | ⬜ pending |
| 28-00-02 | 00 | 0 | (RECONCILE) | — | Pre + post `pg_dump --schema-only` diff shows only renamed objects + 3 added columns | shell | `bash scripts/p28-rename-diff.sh` | ❌ W0 | ⬜ pending |
| 28-01-01 | 01 | 1 | ORG-01 | V13-2(b) | 8 tables exist + columns + RLS enabled | SQL integration | `supabase db query --linked --file tests/sql/p28-schema-shape.test.sql` | ❌ W0 | ⬜ pending |
| 28-01-02 | 01 | 1 | ORG-01/05 | V13-2(a)(b) | organizations cross-tenant deny | unit | `npx vitest run src/lib/__tests__/rls-org-organizations.test.ts` | ❌ W0 | ⬜ pending |
| 28-01-03 | 01 | 1 | ORG-01/05 | V13-2(a)(b) | org_members cross-tenant deny | unit | `npx vitest run src/lib/__tests__/rls-org-members.test.ts` | ❌ W0 | ⬜ pending |
| 28-01-04 | 01 | 1 | ORG-01/05 | V13-2(a)(b) | org_invites cross-tenant deny + W-1 invariant | unit | `npx vitest run src/lib/__tests__/rls-org-invites.test.ts` | ❌ W0 | ⬜ pending |
| 28-01-05 | 01 | 1 | ORG-01/05 | V13-2(a)(b) | org_subscriptions cross-tenant deny (deny-all for v1.3) | unit | `npx vitest run src/lib/__tests__/rls-org-subscriptions.test.ts` | ❌ W0 | ⬜ pending |
| 28-01-06 | 01 | 1 | ORG-01/05 | V13-2(a)(b) | org_settings cross-tenant deny | unit | `npx vitest run src/lib/__tests__/rls-org-settings.test.ts` | ❌ W0 | ⬜ pending |
| 28-01-07 | 01 | 1 | ORG-01/05 | V13-2(a)(b) | org_branding cross-tenant deny | unit | `npx vitest run src/lib/__tests__/rls-org-branding.test.ts` | ❌ W0 | ⬜ pending |
| 28-01-08 | 01 | 1 | ORG-01/05 | V13-2(a)(b) | org_patient_links cross-tenant deny (incl. patient-self-read) | unit | `npx vitest run src/lib/__tests__/rls-org-patient-links.test.ts` | ❌ W0 | ⬜ pending |
| 28-01-09 | 01 | 1 | ORG-01/05 | V13-2(a)(b) | org_consent_grants cross-tenant deny + `_validate_consent_scope` re-use | unit | `npx vitest run src/lib/__tests__/rls-org-consent-grants.test.ts` | ❌ W0 | ⬜ pending |
| 28-02-01 | 02 | 1 | ORG-03 | V13-2(a) | `_createServiceRoleClientUnsafe().from('x')` typed `never` | static (tsd) | `npx tsc -p tsconfig.app.json --noEmit` | ✅ | ⬜ pending |
| 28-02-02 | 02 | 1 | ORG-03 | V13-2(a) | `withOrgScope` throws `OrgScopeBypassError` + Sentry fatal on missing `.eq('org_id', orgId)` | unit | `npx vitest run src/lib/__tests__/with-org-scope.test.ts` | ❌ W0 | ⬜ pending |
| 28-02-03 | 02 | 1 | ORG-03 | V13-2(a) | ESLint `no-raw-service-role-client` blocks raw `createClient(..., SERVICE_ROLE_KEY)` outside `src/server/with-org-scope.ts` | static (lint) | `npm run lint -- --rule 'leanshot/no-raw-service-role-client:error'` | ❌ W0 (rule + test) | ⬜ pending |
| 28-03-01 | 03 | 2 | ORG-02 | V13-2 | Custom Access Token Hook populates `app_metadata.org_ids` | integration | `npx vitest run src/lib/__tests__/jwt-org-ids-hook.test.ts` | ❌ W0 | ⬜ pending |
| 28-03-02 | 03 | 2 | ORG-02 (UI) | — | Skeleton + spinner during 600ms freshness window; explicit Retry after 600ms | e2e | `npx playwright test e2e/workspace-switcher-jwt-propagation.spec.ts` | ❌ W0 | ⬜ pending |
| 28-04-01 | 04 | 2 | ORG-04 | V13-2(c) | `channelNameFor(orgId, table)` deterministic 8-hex HMAC | unit | `npx vitest run src/lib/__tests__/org-realtime.test.ts` | ❌ W0 | ⬜ pending |
| 28-04-02 | 04 | 2 | ORG-04 | V13-2(c) | Cross-tenant subscribe to `channelNameFor(orgY, 'patients')` → CHANNEL_ERROR (DB-level invariant per `[[feedback_realtime_layer_e2e_pattern]]`) | e2e | `npx playwright test e2e/rls-org-realtime-channel.spec.ts` | ❌ W0 | ⬜ pending |
| 28-04-03 | 04 | 2 | ORG-04 | V13-2(c) | SECDEF helper `realtime_topic_authorized(topic, claims)` returns true only for valid HMAC + org_id in claims | unit | `supabase db query --linked --file tests/sql/p28-realtime-topic-authorized.test.sql` | ❌ W0 | ⬜ pending |
| 28-05-01 | 05 | 2 | ORG-06 | — | `useCurrentOrg`, `getCurrentOrgId`, `surfaceCheck`, `withOrgPath`, `overlayBrandingTokens` exposed + behave per CONTEXT D-02/D-03 | unit | `npx vitest run src/lib/__tests__/org.test.ts` | ❌ W0 | ⬜ pending |
| 28-06-01 | 06 | 2 | ORG-07 | V13-2 + V13-3 | `resolve_clinic_slug(slug)` returns `not_found` for non-existent AND existing-but-no-membership (anti-enumeration) | integration | `npx vitest run src/lib/__tests__/resolve-clinic-slug.test.ts` | ❌ W0 | ⬜ pending |
| 28-06-02 | 06 | 2 | ORG-07 | V13-2 | `/clinic/{slug}` member → surface; pending invite → accept UI; otherwise → generic 404 | e2e | `npx playwright test e2e/route-org-guard.spec.ts` | ❌ W0 | ⬜ pending |
| 28-07-* | 07 | 3 | (extension contract) | — | `28-EXTENSION-CONTRACT.md` checklist passes manual review | doc | manual | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> Task IDs are illustrative — exact IDs depend on planner's plan layout. The mapping requirement: every ORG-NN REQ and every CONTEXT D-NN trackable decision (A1..A5 from addendum included) MUST be covered by at least one row.

---

## Wave 0 Requirements

Test files and fixtures that MUST exist before Wave 1 begins (planner's Plan-01 creates them as red-pending stubs):

- [ ] `src/lib/__tests__/_fixtures/p28-rls-fixture.ts` — shared fixture helper: `sessionFor(userId)` (`admin.generateLink + plain fetch /auth/v1/verify` per `[[reference_rls_fixture_gotrueclient_flake]]`), `createTwoOrgsTwoUsers(slugPrefix)`, file-scoped slug prefix factory (per `[[feedback_rls_per_file_slug_prefix]]`), `afterAll` cleanup.
- [ ] `src/lib/__tests__/rls-org-organizations.test.ts` — covers ORG-01/05.
- [ ] `src/lib/__tests__/rls-org-members.test.ts` — covers ORG-01/05.
- [ ] `src/lib/__tests__/rls-org-invites.test.ts` — covers ORG-01/05 + Phase 9 W-1 invariant.
- [ ] `src/lib/__tests__/rls-org-subscriptions.test.ts` — covers ORG-01/05.
- [ ] `src/lib/__tests__/rls-org-settings.test.ts` — covers ORG-01/05.
- [ ] `src/lib/__tests__/rls-org-branding.test.ts` — covers ORG-01/05.
- [ ] `src/lib/__tests__/rls-org-patient-links.test.ts` — covers ORG-01/05 + patient-self-read path.
- [ ] `src/lib/__tests__/rls-org-consent-grants.test.ts` — covers ORG-01/05 + `_validate_consent_scope` re-use proof.
- [ ] `src/lib/__tests__/with-org-scope.test.ts` — covers ORG-03 runtime + compile-time (uses `expect-type` for tsd assertions if planner opts in).
- [ ] `src/lib/__tests__/org-realtime.test.ts` — covers ORG-04 HMAC determinism + 8-hex truncation.
- [ ] `src/lib/__tests__/jwt-org-ids-hook.test.ts` — covers ORG-02 hook behavior (Custom Access Token Hook per addendum A3).
- [ ] `src/lib/__tests__/org.test.ts` — covers ORG-06 (`useCurrentOrg`, `getCurrentOrgId`, `surfaceCheck`, `withOrgPath`, `overlayBrandingTokens`).
- [ ] `src/lib/__tests__/resolve-clinic-slug.test.ts` — covers ORG-07 anti-enumeration.
- [ ] `tests/sql/p28-schema-shape.test.sql` — covers ORG-01 column presence + RLS-enabled flag.
- [ ] `tests/sql/p28-rename-verification.test.sql` — covers addendum A1 (post-rename: `select count(*) from organizations`, `select count(*) from public.orgs` returns "does not exist", FK targets verified).
- [ ] `tests/sql/p28-realtime-topic-authorized.test.sql` — covers helper unit-test per addendum A4.
- [ ] `scripts/p28-rename-diff.sh` — pre + post `pg_dump --schema-only` diff for addendum A1.
- [ ] `e2e/route-org-guard.spec.ts` — covers ORG-07.
- [ ] `e2e/workspace-switcher-jwt-propagation.spec.ts` — covers ORG-02 UI.
- [ ] `e2e/rls-org-realtime-channel.spec.ts` — covers ORG-04 channel-auth.
- [ ] `eslint-rules/no-raw-service-role-client.js` + test fixture in `eslint-rules/__tests__/` — covers ORG-03 lint path (addendum A1 doesn't change this).
- [ ] `npm install --save-dev expect-type` — optional, only if planner wants explicit type-level assertions for ORG-03 (otherwise `// @ts-expect-error` comments suffice).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Enable Custom Access Token Hook in Supabase Dashboard (Auth → Hooks) | ORG-02 | Dashboard-only enable per addendum A3 / Q-A4 | (1) Deploy hook migration. (2) Open Supabase Dashboard → Auth → Hooks → Custom Access Token. (3) Select function `public.custom_access_token_hook`. (4) Save. (5) Verify via `select raw_app_meta_data->'org_ids' from auth.users where id = auth.uid()` after a fresh login by a multi-org test user. |
| Confirm Vault secret `org_realtime_channel_secret` is set | ORG-04 | Vault values are deployment secrets; planner cannot mint | (1) Supabase Dashboard → Vault. (2) Create / verify secret `org_realtime_channel_secret` (32-byte random hex). (3) Verify via `select length(decode(decrypted_secret, 'hex')) from vault.decrypted_secrets where name = 'org_realtime_channel_secret'` returns 32. |
| Pre-rename audit row counts captured for Plan-0 SUMMARY | (RECONCILE) | Live DB state must be captured BEFORE migration runs (irreversible after) | Run the audit SQL from addendum A1 Plan-0 task #1; paste rows into `28-00-SUMMARY.md`. |

---

## Validation Sign-Off

- [ ] Every plan task has `<automated>` verify OR a Wave 0 dependency tracked above.
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (RLS test sweep keeps cadence).
- [ ] Wave 0 covers all 19 MISSING references above.
- [ ] No `--watch` flags in any test command.
- [ ] Feedback latency < 45s quick / < 4min full.
- [ ] `nyquist_compliant: true` set in frontmatter ONLY after all 8 RLS suites + 4-vector defense tests + addendum A1/A4 SQL fixtures + 3 e2e suites pass.

**Approval:** pending
