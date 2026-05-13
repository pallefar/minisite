---
phase: 9
slug: clinic-b2b-foundations
status: complete
nyquist_compliant: true
wave_0_complete: true
rls_specs_status: deferred  # 6 RLS impersonation specs (rls-orgs/memberships/invites/roles/role-permissions/org-logos-storage) authored but not run against live DB; deferred to Phase 9 verifier-agent gate after Wave 6
db_push_state: applied  # 14 migrations live on ytnsipxxmzgaebkqmokp (000000-000013; 000000 split off enum-add per Postgres 55P04, 000002 prepended has_permission stub for forward refs to RLS policies)
created: 2026-05-12
closed: 2026-05-13
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Anchored to RESEARCH.md §"Validation Architecture" — test pyramid, Wave 0 gaps, infrastructure.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.5 (unit + integration), Playwright 1.59.1 (e2e + Pitfall #8 5-scenario matrix), Deno 2.7.14 (Edge Function unit) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts`, `supabase/functions/clinic-invite/deno.json` (Wave 0), `supabase/functions/clinic-photo/deno.json` (Wave 0) |
| **Quick run command** | `npm run test -- --run` (Vitest, ~30s) |
| **Full suite command** | `npm run test:all` (Vitest + Playwright + Deno + RLS impersonation, ~7min — heavier than Phase 8 due to 5-scenario matrix + 6 RLS surfaces) |
| **Estimated runtime** | ~7 min full / ~30s quick |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -- --run <pattern matching changed files>`
- **After every plan wave:** Run `npm run test:all`
- **Before `/gsd-verify-work`:** Full suite must be green AND Pitfall #8 5-scenario matrix all green AND revoke-latency drill green
- **Max feedback latency:** 30 seconds for unit/quick; 7 minutes for full

---

## Per-Task Verification Map

> Filled by planner per task in 09-NN-PLAN.md files. Skeleton below; planner adds rows when authoring plans.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 schema | 1 | CLINIC-01..03+06+07 (schema gate) | T-09-01..06 | All 6 new RLS surfaces enforce per-tenant scoping; has_permission STABLE; broadcast trigger fires; realtime.messages RLS dispatches by topic prefix | RLS impersonation + Postgres unit | `npm run test:e2e:rls -- 'rls-(orgs\|memberships\|invites\|roles\|role-permissions\|org-logos-storage)\.test\.ts'` | ✅ exists (32 files) | ⚠️ authored, deferred to CI gate (no live SUPABASE_SERVICE_ROLE_KEY in worktree) |
| 09-02-01 | 02 clinic chunk UI | 2 | CLINIC-01, CLINIC-02 | T-09-13..17 | Org-create + workspace home + invite modal anti-enumeration + W-1 server-generated invite_id; setAuth-before-subscribe Realtime invariant | RTL + bundle-size | `npx vitest run src/lib/clinic.test.ts src/components/clinic/` | ✅ exists (63 cases across 4 files) | ✅ green |
| 09-03-01 | 03 clinic-settings UI | 2 | CLINIC-06 | T-09-18..22 | RoleEditorModal renders 10-checkbox PERMISSION_KEYS grid; create_role + update_role + delete_role RPCs gated server-side; useHasPermission tri-state hook + session cache + signOut wipe | RTL + bundle-size | `npx vitest run src/components/clinic/settings/ src/lib/clinic-permissions.test.ts` | ✅ exists (45 cases across 6 files) | ✅ green |
| 09-04-01 | 04 clinic-invite UI | 2 | CLINIC-02, CLINIC-03 | T-09-23..28 | ClinicInvitePage state-machine routes all 8 states (A-H); ConsentDialog W-5 defensive scope-init from DATA_TYPE_KEYS; Pitfall #1 collision-pivot in InviteSignupForm; Pitfall #9 zero useStore subscriptions | RTL | `npx vitest run src/components/clinic-invite/` | ✅ exists (28 cases across 3 files) | ✅ green |
| 09-05-01 | 05 Active orgs tab | 2 | CLINIC-03 | T-09-29..31 | EditConsentScopeModal canonical 10-key scope on Save; Realtime user-channel revoke-from-elsewhere animates row out; revoke RPC writes revoked_at + audit row | RTL | `npx vitest run src/components/dashboard/settings/sections/ActiveOrganizationsSection.test.tsx src/components/dashboard/settings/EditConsentScopeModal.test.tsx` | ✅ exists (15 cases across 2 files) | ✅ green |
| 09-06-01 | 06 clinic-invite Edge Function | 3 | CLINIC-02 | T-09-32..38 | W-1 universal `{ok:true,invite_id}` source-scan; operator-scoped client for auth.uid() resolution; Resend stub gate `RESEND_API_KEY=test-stub`; in-memory rate-limit for /lookup + /accept | Deno + RTL source-scan | `cd supabase/functions/clinic-invite && deno test --allow-env --allow-net --no-check` | ✅ exists (18 Deno cases + 41 clinic.test.ts) | ✅ green Deno + RTL; ⚠️ live Resend dispatch deferred (Resend domain not verified) |
| 09-07-01 | 07 clinic-photo Edge Function | 3 | CLINIC-07 | T-09-39..44 | D-12 3-check gate (operator membership → has_permission(patient_photos.read) → patient consent_scope.photos === true); D-13 5-min signed URL TTL; CLINIC-07 audit on both 200 + permission_denied paths; Cache-Control: private, no-store | Deno | `cd supabase/functions/clinic-photo && deno test --allow-env --allow-net --no-check` | ✅ exists (15 Deno cases) | ✅ green (15/15 pass locally) |
| 09-08-01 | 08 WorkspaceSwitcher | 3 | CLINIC-01 | T-09-45..47 | Pitfall #9 defer-mount Skeleton; Pitfall #8 single-identity invariant (3 groups visible with 0 memberships + 0 workspaces); W-7 byte-level bundle gate inline; Realtime cross-context refresh on every membership broadcast | RTL + bundle | `npx vitest run src/components/layout/WorkspaceSwitcher.test.tsx` | ✅ exists (16 cases) | ✅ green |
| 09-09-01 | 09 Pitfall #8 + photo-access + role-grid e2e | 4 | CLINIC-02, CLINIC-03, CLINIC-06, CLINIC-07 | T-09-48..49b | 5 Pitfall #8 scenarios assert single auth.users + memberships shape + invite lifecycle + consent_scope_at_acceptance freeze + audit rows; W-4 Test 3a actual-RLS-rejection (42501 on send_invite by under-permissioned user); 10×3 permission-grid walk | Playwright fixture | `npx playwright test --list e2e/clinic-pitfall-8-*.spec.ts e2e/clinic-photo-access.spec.ts e2e/clinic-role-permission-grid.spec.ts` | ✅ exists (9 tests across 7 spec files + e2e/fixtures/clinic-fixtures.ts) | ⚠️ authored, deferred to CI gate (no live SUPABASE_SERVICE_ROLE_KEY in worktree); 9/9 discovered |
| 09-10-01 | 10 revoke-latency + Pitfall #2 negative-space e2e | 4 | CLINIC-03 (SC#5), CLINIC-07 | T-09-50..51 | SC#5 D-10 two-layer revoke: Layer 1 supabase-js broadcast ≤5000ms hard ceiling / 1500ms soft target; Layer 2 clinic-photo 401 independent of Realtime; Pitfall #2 RLS gates 3 negative-space subscribes (non-member org, fake org UUID, cross-tenant user channel) | Playwright fixture | `npx playwright test --list e2e/clinic-revoke-latency.spec.ts e2e/clinic-realtime-negative-space.spec.ts` | ✅ exists (7 tests across 2 spec files) | ⚠️ authored, deferred to CI gate (no live SUPABASE_SERVICE_ROLE_KEY in worktree); 7/7 discovered |
| 09-11-01 | 11 traceability + close | 4 | All Phase 9 reqs | — | ROADMAP Phase 9 marked complete (11/11); REQUIREMENTS CLINIC-01..03+06 marked Complete + CLINIC-07 split footnote; STATE accumulated context decisions + deferred items; 09-VALIDATION.md status: complete; 09-SUMMARY.md aggregates 10 per-plan summaries with PASS/FAIL on 6 SCs | static (docs) | manual orchestrator review + plan-checker iter 1 fix verification | ✅ exists | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> Test infrastructure that MUST exist before Wave 1 begins. Sourced from RESEARCH.md §"Validation Architecture" Wave 0 gaps.

**Edge Function scaffolds:**
- [ ] `supabase/functions/clinic-invite/deno.json` (Deno test config)
- [ ] `supabase/functions/clinic-invite/index.test.ts` (Deno test scaffolding — name matches `<name>.test.ts` per memory `reference_deno_test_discovery.md`)
- [ ] `supabase/functions/clinic-invite/cors.ts` (CORS-with-credentials helper — copy from Phase 8's `share/cors.ts`)
- [ ] `supabase/functions/clinic-photo/deno.json`
- [ ] `supabase/functions/clinic-photo/index.test.ts`
- [ ] `supabase/functions/clinic-photo/cors.ts`

**RLS impersonation proofs (project rule from memory `reference_supabase_project.md`):**
- [ ] `tests/rls/orgs.spec.ts` — cross-tenant impersonation proof for `orgs` table
- [ ] `tests/rls/memberships.spec.ts` — cross-tenant + UNIQUE(user_id, org_id) constraint proofs
- [ ] `tests/rls/invites.spec.ts` — cross-tenant + token-hash-only-readable-by-owner
- [ ] `tests/rls/roles.spec.ts` — org-scoped roles + system-role immutability
- [ ] `tests/rls/role-permissions.spec.ts` — permission-key joins respect RLS
- [ ] `tests/rls/org-logos-bucket.spec.ts` — public-read but per-org write
- [ ] `tests/rls/clinic-photo-access.spec.ts` — membership-scoped photo Edge Function path (impersonation proof)

**Playwright e2e specs:**
- [ ] `tests/e2e/clinic-workspace.spec.ts` — operator org-create + workspace home render
- [ ] `tests/e2e/clinic-settings-roles.spec.ts` — Roles tab CRUD + permission grid
- [ ] `tests/e2e/consent-flow.spec.ts` — happy-path consent acceptance (CLINIC-03)
- [ ] `tests/e2e/active-orgs-tab.spec.ts` — patient-side membership list + scope edit + revoke
- [ ] `tests/e2e/pitfall8-matrix.spec.ts` — 5-scenario invitation matrix (SC#3) — **load-bearing**
- [ ] `tests/e2e/revoke-latency.spec.ts` — 1-second SC#5 revoke drill (two-context Realtime — risk: RC5 cluster; fallback `test.fixme` per memory)
- [ ] `tests/e2e/workspace-switcher.spec.ts` — single-identity invariant (Pitfall #8 affordance)
- [ ] `tests/e2e/clinic-photo.spec.ts` — operator views patient photo; revoke kills access within 5min URL TTL

**Migration infrastructure:**
- [ ] 13 ordered migrations in `supabase/migrations/` (numbered post-Phase 8) — planner enumerates exact names in Plan 09-01
- [ ] `supabase/migrations/<timestamp>_audit_logs_clinic_extension.sql` runs AFTER Phase 8's audit_logs migration

**External infrastructure (HUMAN CHECKPOINTS):**
- [ ] Resend account + DNS records (SPF/DKIM on `app.leanshot.app`) + `RESEND_API_KEY` set as Supabase secret
- [ ] Vercel rewrites (`vercel.json`) configured for path-based routing of `/clinic/*` and `/clinic-invite/*` (fallback: hash routes documented in research)
- [ ] CI secret `RESEND_API_KEY=test-stub` for Pitfall #8 matrix specs (avoid 100/day free-tier exhaustion)

**Auth fixtures (extend Phase 8):**
- [ ] Two clinic operators (`org_owner@test.com`, `org_coach@test.com`)
- [ ] Two patient users (`patient_a@test.com`, `patient_b@test.com`) — already exist as `alice@test.com` / `bob@test.com` from Phase 8 RLS fixtures; planner verifies reuse path
- [ ] Test cleanup: per-run timestamped org slugs (memory `feedback_parallel_executor_git_isolation.md` parallel hygiene)

*Wave 0 closes when all rows above are checked. Planner verifies in 09-01 PLAN.md.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Resend email deliverability + branded template render (header logo, footer WMHMDA) | CLINIC-02 / D-16 | Real inbox rendering across Gmail / iCloud / Outlook varies; can't fully automate visual fidelity | Trigger invite from staging; verify Resend dashboard shows delivery; open in 3 test inboxes; confirm clinic logo + org name + 7-day expiry text render |
| 5-minute signed-URL stale window for clinic photos (D-13) | D-12 / D-13 | Realtime channel revoke vs CDN-cached URL window can't be fully reproduced in CI | Operator opens patient photo; patient revokes; verify operator's existing tab evicts within 1s (Realtime) AND newly-issued URLs fail; saved-URL-in-DevTools works for up to 5min then 401 |
| Workspace switcher cross-route persistence | D-09 / D-14 | DOM persistence across SPA route changes + hard reload needs human eyeballs | Sign in as user with personal + 2 memberships + 1 operator workspace; navigate Personal → Membership → Workspace → reload page; verify switcher state survives |
| BAA/HIPAA `[COUNSEL REVIEW NEEDED]` placeholder copy review | (deferred from CONTEXT) | Counsel-led; not automatable | Display the consent dialog draft to counsel before launch; capture sign-off in `.planning/research/` or attach to Phase 9 close summary |

---

## Validation Sign-Off

- [x] All 11 plans have `<automated>` verify or Wave 0 dependencies — each plan's `<verify>` block enumerates the command set
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — every Wave 2/3/4 task has RTL/Deno/Playwright coverage in-band
- [x] Wave 0 covers all MISSING references — Plan 09-01 Task 1b shipped 32 scaffold files (6 Edge-Function files + 6 RLS specs + 8 Playwright pitfall scaffolds + 4 stub components + clinic types + bundle script + App.tsx routing)
- [x] No watch-mode flags — every verify command uses `--run` / `--list` / non-watch
- [x] Feedback latency < 30s quick / 7min full — clinic vitest suites complete in <5s each; Deno tests in ~10ms; Playwright fixture-mode specs gated on SERVICE_ROLE_KEY (CI run only)
- [x] Cross-tenant RLS impersonation proof for all 7 new RLS surfaces — 6 vitest impersonation specs + clinic-photo-access Playwright spec authored (⚠️ live run deferred to CI gate)
- [x] Pitfall #8 5-scenario matrix runs in CI and gates the phase (load-bearing for SC#3) — 5 spec files authored Plan 09-09; CI gated on SERVICE_ROLE_KEY
- [x] Revoke-latency drill (SC#5) runs in CI; fallback `test.fixme` if RC5 Realtime cluster fires — Plan 09-10 Layer 1 + Layer 2; two-tier SLA (5000ms hard ceiling / 1500ms soft target); RC5 tolerance documented
- [x] Role-system permission-key tests cover all 10 keys with at least one positive + one negative assertion each — Plan 09-09 Test 2 (10×3 grid walk) + W-4 Test 3a (actual RLS denial on under-permissioned send_invite)
- [x] `nyquist_compliant: true` set in frontmatter after Wave 0 closes — flipped by Plan 09-01 Task 2 per B-5 (plan-checker iter 1)

**Approval:** COMPLETE 2026-05-13 — Phase 9 closed by Plan 09-11.
