---
phase: 05
slug: patient-cloud-sync-slice-1-auth-injections
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-11
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Concrete fill from RESEARCH.md §11 "Validation Architecture". Planner expands per-task rows during planning.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Browser unit** | vitest 2.x (from Phase 1; 225/225 baseline preserved) |
| **Browser E2E** | Playwright (from Phase 1; project-level config at `leanshot/playwright.config.ts`) |
| **DB integration** | vitest + `@supabase/supabase-js` admin client (mirrors Phase 4 `rls-ai-messages.test.ts`) |
| **Edge runtime** | deno test (Phase 4 — UNCHANGED in Phase 5; auth doesn't touch Edge Function) |
| **Quick run** | `cd leanshot && npm test -- --run --reporter=dot` |
| **Full suite** | `npm run test:ci && npm run test:e2e -- --grep @phase05` |
| **Estimated runtime** | vitest ~30s · phase-05 e2e ~120s (5 multi-browser scenarios) · rls-injections.test.ts ~5s |

---

## Sampling Rate

- **After every task commit:** `npm test -- --run --reporter=dot` (vitest, ~30s)
- **After every plan wave:** full vitest + Playwright phase-05 grep + RLS integration
- **Before `/gsd-verify-work`:** all three runners green AND cross-tenant RLS assertion proven live AND 5 Playwright SC scenarios green
- **Max feedback latency:** ~30s for vitest; e2e gated to plan-end only

---

## Per-Task Verification Map

> Populated by `gsd-planner` during plan authoring. Each task in 05-01 / 05-02 / 05-03 PLAN.md gets a row mapping to a requirement and a concrete `<automated>` command.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-XX | 01 | 1 | SYNC-05 | T-05-01 cross-tenant | `injections` table created with RLS + 4 policies (select/insert/update/delete) + composite PK + `moddatetime` trigger; service-role admin client can seed; anon-key client cannot read other-user rows | source assertion + integration | `grep -c 'enable row level security' supabase/migrations/2026*_injections.sql && npm test -- --run e2e/rls-injections.test.ts` | ❌ W0 | ⬜ pending |
| 05-01-XX | 01 | 1 | SYNC-05 | — | `supabase db push` applies migration to remote DB (BLOCKING — requires DB password from 1Password) | integration | `npx supabase migration list \| grep injections` returns 1 | ❌ W0 | ⬜ pending |
| 05-02-XX | 02 | 2 | AUTH-01, AUTH-02 | — | Signup form authored; `supabase.auth.signUp({email, password, options:{emailRedirectTo}})`; password policy enforced (8 chars + 1 digit); email-confirm landing screen works | unit + e2e | `npm test -- --run src/lib/auth.test.ts src/components/auth/SignUpForm.test.tsx && npm run test:e2e -- e2e/auth-signup-verify-signin.test.ts` | ❌ W0 | ⬜ pending |
| 05-02-XX | 02 | 2 | AUTH-03 | — | `supabase.auth.signInWithPassword`; session persists across browser refresh via supabase-js's localStorage `sb-leanshot-auth` storage key; `onAuthStateChange` handler in App.tsx (`setTimeout(..., 0)` deadlock guard per RESEARCH §10) | unit + e2e | `npm test -- --run src/lib/auth.test.ts && npm run test:e2e -- --grep "session persist"` | ❌ W0 | ⬜ pending |
| 05-02-XX | 02 | 2 | AUTH-04 | — | Password reset flow: `resetPasswordForEmail` → emailed link → `updateUser({password})` on the new-password screen; previous password rejected server-side after reset | e2e | `npm run test:e2e -- e2e/password-reset.test.ts` | ❌ W0 | ⬜ pending |
| 05-02-XX | 02 | 2 | AUTH-05 | T-05-02 multi-account | `signOut({scope: 'local'})` clears Zustand user-data slices via `clearUserData()` action; preserves theme + onboarded + tour_seen + acknowledgedDisclaimer; localStorage re-keys to anon namespace on next anon-mint; sign-out destination = marketing view | unit + e2e | `npm test -- --run src/lib/store.test.ts -t "signOut clears"` + Playwright assertion no signed-in data visible post-signout | ❌ W0 | ⬜ pending |
| 05-02-XX | 02 | 2 | AUTH-06 | — | Email-verify gate (D-13): unverified-but-signed-in user can log injections locally, AI Coach works, banner visible with resend; cloud sync is blocked until `email_confirmed_at` is set | unit + e2e | Playwright covers banner + offline-log + post-verify catchup; vitest covers gate predicate `isSyncEnabled(session)` | ❌ W0 | ⬜ pending |
| 05-02-XX | 02 | 2 | AUTH-01..05 | T-05-03 anon-bleed | Anon→permanent UID promotion via `updateUser({email})` then verify then `updateUser({password})` re-enter; AI chat history follows automatically; pre-existing local injections silently upload via `upsert(onConflict:'user_id,log_id')` | e2e | Playwright covers full anon→permanent path; assertion `auth.users.is_anonymous=false` post-verify | ❌ W0 | ⬜ pending |
| 05-03-XX | 03 | 3 | SYNC-01 (partial — injections only) | T-05-04 stale-data | Realtime subscription wired: `channel('injections').on('postgres_changes', {filter: 'user_id=eq.<uid>'}, handler).subscribe()`; initial seed via explicit `select * where user_id=auth.uid()` (RESEARCH §5 — postgres_changes does NOT replay); cleanup on signout + unload | unit + e2e | Playwright multi-context: log injection on context-A, assert visible on context-B within 5s; vitest covers subscription lifecycle helpers | ❌ W0 | ⬜ pending |
| 05-03-XX | 03 | 3 | SYNC-01 | T-05-05 conflict | Offline write queue: Zustand `addInjection` enqueues `pendingSyncIds` via `pendingOps` slice; on reconnect+signed-in+verified, flush via `upsert(onConflict:'user_id,log_id')`; LWW resolution via server-side `updated_at` trigger | unit + e2e | Playwright offline-first scenario (`context.setOffline(true)`); vitest covers flush logic + LWW comparator | ❌ W0 | ⬜ pending |
| 05-03-XX | 03 | 3 | SYNC-05 | T-05-01 | Cross-tenant RLS test in CI: 2 anon users signed up via admin client; user A logs injection; user B (with their own anon JWT) cannot read user A's row | integration (vitest) | `npm test -- --run e2e/rls-injections.test.ts` exits 0 with `count = 0` assertion for cross-user reads | ❌ W0 | ⬜ pending |
| 05-03-XX | 03 | 3 | — | T-05-06 storage-bleed | STORAGE_VERSION 6→7 migration: existing `leanshot_v4` data namespaced under `leanshot_v4:<sha256(uid).slice(0,16)>` on first signin; old key deleted; `Injection` rows back-stamped with `crypto.randomUUID()` for `log_id` (existing rows have no `log_id`) | unit | `npm test -- --run src/lib/storage.test.ts -t "v6 to v7 migration"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `/Users/karstenhaldan/minisite/supabase/migrations/2026XXXX_injections.sql` — RLS-scoped table + 4 policies + composite PK `(user_id, log_id)` + `moddatetime` trigger + Realtime publication membership
- [ ] `/Users/karstenhaldan/minisite/leanshot/src/lib/auth.ts` — thin wrapper around supabase-js auth methods + `setTimeout(..., 0)` guard for `onAuthStateChange` deadlock per RESEARCH §10
- [ ] `/Users/karstenhaldan/minisite/leanshot/src/lib/sync.ts` — Realtime subscription + offline-queue flush + LWW resolver
- [ ] `/Users/karstenhaldan/minisite/leanshot/src/lib/auth-migration.ts` — silent migration helpers (D-05 anon→permanent promotion, D-06 local→cloud bulk-upload, D-12 storage re-key, log_id back-stamp)
- [ ] `/Users/karstenhaldan/minisite/leanshot/src/types/index.ts` — `Injection` interface gains `log_id: string` field; migration back-stamps existing rows
- [ ] `/Users/karstenhaldan/minisite/leanshot/src/components/auth/{AuthView,SignUpForm,SignInForm,VerifyEmailLanding,PostSignupSent,ForgotPasswordForm,SetNewPasswordForm,EmailVerificationBanner}.tsx` — 9 new component files per UI-SPEC
- [ ] `/Users/karstenhaldan/minisite/leanshot/src/components/layout/AvatarMenu.tsx` — D-04 topbar avatar dropdown
- [ ] `/Users/karstenhaldan/minisite/leanshot/e2e/auth-signup-verify-signin.test.ts` — SC#1 end-to-end Playwright smoke
- [ ] `/Users/karstenhaldan/minisite/leanshot/e2e/password-reset.test.ts` — SC#2 password reset flow
- [ ] `/Users/karstenhaldan/minisite/leanshot/e2e/signout-cache-clear.test.ts` — SC#3 cache clear verification
- [ ] `/Users/karstenhaldan/minisite/leanshot/e2e/offline-log-then-sync.test.ts` — SC#4 offline-first smoke
- [ ] `/Users/karstenhaldan/minisite/leanshot/e2e/rls-injections.test.ts` — SC#5 cross-tenant RLS proof (vitest + admin client; mirrors Phase 4's `rls-ai-messages.test.ts` pattern)
- [ ] `/Users/karstenhaldan/minisite/.github/workflows/ci.yml` — Playwright auth job (4 scenarios); RLS test runs alongside existing unit job; `SUPABASE_SERVICE_ROLE_KEY` secret required (user-setup checkpoint flagged by researcher)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `SUPABASE_SERVICE_ROLE_KEY` configured as GitHub Actions secret | SC#5 | Service-role key cannot be committed; cross-tenant RLS test requires it to seed two users via admin client | User adds secret via `gh secret set SUPABASE_SERVICE_ROLE_KEY --body "$(npx supabase projects api-keys --project-ref ytnsipxxmzgaebkqmokp --output json | jq -r '.[] | select(.id=="service_role") | .api_key')"` |
| Supabase Redirect URL allowlist updated for Vercel previews | AUTH-02 (verify), AUTH-04 (password reset) | Dashboard-only config; CLI doesn't expose Redirect URL list on free tier | User adds `https://*-karstens-projects-16afd0e4.vercel.app/**` + production URL via https://supabase.com/dashboard/project/ytnsipxxmzgaebkqmokp/auth/url-configuration |
| Vercel Preview UAT after deploy | SC#1 (E2E sync) | Real cross-browser sync requires actual deployed app + email-verified accounts; Playwright covers but a human smoke catches UX issues | User runs the 5 SC scenarios in two browsers; reports approved/failure |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify command or Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (5 e2e tests, RLS integration test, auth.ts + sync.ts + auth-migration.ts library files, 9 component files, migration SQL, CI workflow updates)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s for the post-commit smoke
- [ ] Cross-tenant RLS test exists with explicit assertion `count = 0` for cross-user reads
- [ ] All 5 SCs covered by at least one Playwright scenario
- [ ] `nyquist_compliant: true` set in frontmatter once planner fills per-task table
