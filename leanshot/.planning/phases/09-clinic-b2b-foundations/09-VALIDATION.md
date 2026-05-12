---
phase: 9
slug: clinic-b2b-foundations
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-12
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
| 09-01-XX | 01 schema | 1 | CLINIC-01..06 (schema gate) | T-09-S1..S6 | All 6 new RLS surfaces enforce per-tenant scoping; cross-tenant impersonation blocked | RLS unit | `npm run test:rls -- --grep clinic` | ❌ W0 | ⬜ pending |
| 09-02-XX | 02 clinic chunk UI | 2 | CLINIC-01 / SC#1 | — | Workspace home lazy-loads; clinic-context bar renders | component + e2e | `npm run test -- ClinicWorkspace` | ❌ W0 | ⬜ pending |
| 09-03-XX | 03 clinic-settings UI | 2 | CLINIC-06 / SC#6 | T-09-A1 | Roles tab CRUD + permission grid works; role assignment writes membership.role_id | component + e2e | `npm run test -- RolesTab` | ❌ W0 | ⬜ pending |
| 09-04-XX | 04 clinic-invite UI | 2 | CLINIC-03 / SC#2 / SC#4 | T-09-I1 | Consent dialog renders 10 checkboxes; accept writes memberships.consent_scope jsonb | component + e2e | `npm run test -- ConsentDialog` + `npm run test:e2e -- consent-flow.spec.ts` | ❌ W0 | ⬜ pending |
| 09-05-XX | 05 Active orgs tab | 2 | CLINIC-03 / D-15 | — | Patient sees memberships scoped by user_id; revoke writes revoked_at | component + e2e | `npm run test -- ActiveOrgsTab` | ❌ W0 | ⬜ pending |
| 09-06-XX | 06 invite Edge Function | 3 | CLINIC-02 / SC#2 / SC#3 (Pitfall #8) | T-09-A2 | Token hash verified; auth.users existence branch correct; all 5 scenarios pass | integration (Deno) + e2e | `cd supabase/functions/clinic-invite && deno test` | ❌ W0 | ⬜ pending |
| 09-07-XX | 07 clinic-photo Edge Function | 3 | CLINIC-01 / D-05 / D-12 | T-09-S5 | Operator gets 401 on revoked membership; signed URL TTL 5min; consent_scope.photos respected | integration (Deno) + e2e | `cd supabase/functions/clinic-photo && deno test` | ❌ W0 | ⬜ pending |
| 09-08-XX | 08 WorkspaceSwitcher | 3 | CLINIC-01 / D-09 / D-14 (Pitfall #8 invariant) | T-09-I2 | Switcher renders all 3 groups (Personal / Memberships / Workspaces I run); single auth.users invariant visible | component + e2e | `npm run test -- WorkspaceSwitcher` | ❌ W0 | ⬜ pending |
| 09-09-XX | 09 Pitfall #8 matrix | 4 | CLINIC-02 / SC#3 (load-bearing) | T-09-A2 / T-09-I3 | 5 scenarios pass: existing-user + invited / new-user + invited / existing-user + 2-invites / invited-but-never-accepts / accepts-then-rejects | e2e + RLS | `npm run test:e2e -- pitfall8-matrix.spec.ts` + `npm run test:rls -- --grep impersonation` | ❌ W0 | ⬜ pending |
| 09-10-XX | 10 revoke-latency drill | 4 | CLINIC-03 / SC#5 | T-09-A3 | 401 returned + roster row removed within 1s of patient revoke (5s drill timeout, 1s SLA assertion) | e2e (security drill) | `npm run test:e2e -- revoke-latency.spec.ts` | ❌ W0 | ⬜ pending |
| 09-11-XX | 11 traceability + sync | 4 | All Phase 9 reqs | — | ROADMAP + REQUIREMENTS + 09-CONTEXT cross-refs intact; no orphan plans | static | `npm run test:traceability` (or manual orchestrator review) | ❌ W0 | ⬜ pending |

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

- [ ] All 11 plans have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (~30 items above)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s quick / 7min full
- [ ] Cross-tenant RLS impersonation proof for all 7 new RLS surfaces (orgs, memberships, invites, roles, role_permissions, org-logos bucket, clinic-photo-access)
- [ ] Pitfall #8 5-scenario matrix runs in CI and gates the phase (load-bearing for SC#3)
- [ ] Revoke-latency drill (SC#5) runs in CI; fallback `test.fixme` if RC5 Realtime cluster fires
- [ ] Role-system permission-key tests cover all 10 keys with at least one positive + one negative assertion each
- [ ] `nyquist_compliant: true` set in frontmatter after Wave 0 closes

**Approval:** pending — planner to refine per-task verification map and Wave 0 list when authoring 09-NN-PLAN.md files.
