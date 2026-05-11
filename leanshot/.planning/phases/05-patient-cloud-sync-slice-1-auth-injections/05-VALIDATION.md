---
phase: 05
slug: patient-cloud-sync-slice-1-auth-injections
status: planner-filled
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-11
updated: 2026-05-11
---

# Phase 05 — Validation Strategy

> Per-phase validation contract. Filled by planner during 05-01/05-02/05-03 plan authoring.

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
| **Estimated runtime** | vitest ~30s · phase-05 e2e ~120s (5 multi-browser scenarios) · rls-injections ~5s |

---

## Sampling Rate

- **After every task commit:** `npm test -- --run --reporter=dot` (vitest, ~30s)
- **After every plan wave:** full vitest + Playwright `@phase05` grep + RLS integration
- **Before `/gsd-verify-work`:** all three runners green AND cross-tenant RLS assertion proven live AND 5 Playwright SC scenarios green
- **Max feedback latency:** ~30s for vitest; e2e gated to plan-end only

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-T1 | 01 | 1 | SYNC-05 (preparation) | — | `Injection` interface gains `log_id: string` + optional `updated_at`/`user_id`; `PendingOp` type authored (DELEG-2 forward-compat) | unit | `cd leanshot && npm run typecheck && npm test -- --run` | ✅ planned | ⬜ pending |
| 05-01-T2 | 01 | 1 | SYNC-05 | T-05-01, T-05-05 | `injections` SQL migration: 4 RLS policies + composite PK + moddatetime trigger + Realtime publication membership | source assertion | `grep -v '^--' supabase/migrations/20260513000000_injections.sql \| grep -c 'create policy'` returns 4 | ✅ planned | ⬜ pending |
| 05-01-T3 | 01 | 1 | SYNC-05 | T-05-01 | `supabase db push` applies migration to remote DB (BLOCKING — requires DB password from 1Password unless SUPABASE_ACCESS_TOKEN already set) | integration | `cd /Users/karstenhaldan/minisite && npx supabase migration list --linked \| grep -c '20260513000000_injections'` returns 1 | ✅ planned | ⬜ pending |
| 05-01-T4 | 01 | 1 | SYNC-01 (preparation) | T-05-03, T-05-06 | STORAGE_VERSION 6→7 helpers — log_id back-stamp, namespacedKey, renameStorageNamespace; idempotent; multi-account-safe | unit | `npm test -- --run src/lib/storage.test.ts` (3 describe blocks: v6 to v7 migration / namespacedKey / renameStorageNamespace) | ✅ planned | ⬜ pending |
| 05-01-T5 | 01 | 1 | SYNC-05 | T-05-01 | Cross-tenant RLS proof — 2 anon users seeded via admin; A inserts; B's JWT-scoped client sees 0 rows | integration | `SUPABASE_SERVICE_ROLE_KEY=… npm test -- --run e2e/rls-injections.test.ts` exits 0 with 4/4 pass | ✅ planned | ⬜ pending |
| 05-02-T1 | 02 | 2 | AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05 | T-05-02, T-05-09 | `src/lib/auth.ts` wrapper — 11 functions; signOut MUST pass `{scope:'local'}`; anon-promote uses `updateUser`, NEVER `linkIdentity` | unit | `npm test -- --run src/lib/auth.test.ts` exits 0; assertion on `scope: 'local'` regression | ✅ planned | ⬜ pending |
| 05-02-T2 | 02 | 2 | AUTH-05, AUTH-06 | T-05-02, T-05-07 | Zustand `signedIn` slice + `clearUserDataSlices` PRESERVES `acknowledgedDisclaimer` (CONF-3); `isSyncEnabled()` D-13 gate; `pendingOps` partialized | unit | `npm test -- --run src/lib/store.test.ts -t "clearUserDataSlices preserves acknowledgedDisclaimer"` passes | ✅ planned | ⬜ pending |
| 05-02-T3 | 02 | 2 | AUTH-01..05 | — | 9 auth UI components — AuthView, 6 forms, EmailVerificationBanner, AvatarMenu; password regex `/^(?=.*\d).{8,}$/`; DELEG-1 password re-enter detection via `last_sign_in_at` | source assertion | `find src/components/auth -name "*.tsx" \| wc -l` returns 8; AvatarMenu has `role="menu"`; SignUpForm uses `attachEmailToAnon` for anon branch | ✅ planned | ⬜ pending |
| 05-02-T4 | 02 | 2 | AUTH-01..06 | T-05-04 | App.tsx state machine wired — onAuthStateChange with setTimeout(fn,0) guard + cleanup; hash routing; auto-anon-mint; auth-migration helpers | unit + source | `npm test -- --run src/lib/auth-migration.test.ts`; `grep -c 'setTimeout' src/App.tsx` ≥1; `grep -c 'TODO(05-03)' src/App.tsx` ≥2 (to be resolved by 05-03) | ✅ planned | ⬜ pending |
| 05-02-T5 | 02 | 2 | AUTH-01, AUTH-04 | T-05-08 | Supabase config push — `password_min_length = 8` + `password_required_characters` enforcing letter+digit; 4 redirect URLs allow-listed for previews+production | integration (BLOCKING checkpoint) | `curl https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/settings \| jq '.password_min_length'` returns 8 | ✅ planned | ⬜ pending |
| 05-02-T6 | 02 | 2 | AUTH-01..05 | T-05-02, T-05-09 | 3 Playwright SC scenarios — signup-verify-signin (SC#1 first leg), password-reset (SC#2), signout-cache-clear (SC#3 incl. CONF-2 + CONF-3) | e2e | `npm run test:e2e -- --grep @phase05` passes 3 of 5 SC scenarios after Task 6 of 05-03 adds the remaining 2 | ✅ planned | ⬜ pending |
| 05-02-T7 | 02 | 2 | — | — | D-14 account-deletion interim runbook in `.planning/decisions/account-deletion-interim.md` — manual procedure for beta; Phase 7 owns full GDPR UI | source | `test -f .planning/decisions/account-deletion-interim.md && grep -c 'on delete cascade' .planning/decisions/account-deletion-interim.md` ≥1 | ✅ planned | ⬜ pending |
| 05-03-T1 | 03 | 3 | SYNC-01 | T-05-04, T-05-05, T-05-07 | `src/lib/sync.ts` — 5 exports (pullInitial, subscribe, unsubscribe, flush, generic subscribeToTable); isSyncEnabled() gate; NEVER sends `updated_at` in upserts | unit | `npm test -- --run src/lib/sync.test.ts` — D-08 regression test (no updated_at in upsert) + T-05-07 gate test pass | ✅ planned | ⬜ pending |
| 05-03-T2 | 03 | 3 | SYNC-01 | T-05-05 | Replace store STUBs — LWW mergeServerInjections + applyRealtimePayload by `updated_at` comparison; addInjection/editInjection/removeInjection enqueue pendingOps + flushSyncQueue | unit | `npm test -- --run src/lib/store.test.ts` — new LWW + pendingOps enqueue tests pass; older-update-ignored regression covered | ✅ planned | ⬜ pending |
| 05-03-T3 | 03 | 3 | SYNC-01, AUTH-06 | T-05-04 | App.tsx SIGNED_IN handler subscribes + pulls + flushes; SIGNED_OUT unsubscribes; online event triggers flush; zero `TODO(05-03)` markers remain | source | `grep -c 'TODO(05-03)' src/App.tsx` returns 0; `grep -c 'subscribeInjections\|unsubscribeInjections' src/App.tsx` ≥2 | ✅ planned | ⬜ pending |
| 05-03-T4 | 03 | 3 | SYNC-01 | — | Multi-context Playwright — log on context A propagates to context B within 5s via Realtime postgres_changes (SC#1 completion) | e2e | `npm run test:e2e -- e2e/cross-device-sync.test.ts` passes with explicit `toBeLessThan(5000)` budget | ✅ planned | ⬜ pending |
| 05-03-T5 | 03 | 3 | SYNC-01, AUTH-06 | — | Offline-first Playwright — `context.setOffline(true)`, log 3 injections, all visible locally, `pendingOps` has 3 entries; reconnect → propagates to context B in <8s (SC#4) | e2e | `npm run test:e2e -- e2e/offline-log-then-sync.test.ts` passes | ✅ planned | ⬜ pending |
| 05-03-T6 | 03 | 3 | SYNC-05 | T-05-01 | CI workflow — SUPABASE_* secrets injected into test-unit (RLS test) + test-e2e (auth + sync tests) + VITE_* injected into build step | source + integration | YAML parses; `gh secret list \| grep -E 'SUPABASE_(URL\|ANON_KEY\|SERVICE_ROLE_KEY)'` shows 3 lines; CI PR run shows test-unit + test-e2e green | ✅ planned | ⬜ pending |
| 05-03-T7 | 03 | 3 | ALL | ALL | Manual UAT — 5 SC scenarios across two real browsers on Vercel preview deployment | manual checkpoint | User confirms each SC pass; user notes any UX surprises | ✅ planned | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

These artifacts must exist before any subsequent task can run. Sequenced by plan:

- [ ] (05-01-T2) `/Users/karstenhaldan/minisite/supabase/migrations/20260513000000_injections.sql`
- [ ] (05-01-T1) `/Users/karstenhaldan/minisite/leanshot/src/types/index.ts` — `Injection.log_id` + `PendingOp` interface
- [ ] (05-01-T4) `/Users/karstenhaldan/minisite/leanshot/src/lib/storage.ts` — STORAGE_VERSION=7, `namespacedKey`, `renameStorageNamespace`, `migrateV6ToV7`
- [ ] (05-01-T5) `/Users/karstenhaldan/minisite/leanshot/e2e/rls-injections.test.ts`
- [ ] (05-02-T1) `/Users/karstenhaldan/minisite/leanshot/src/lib/auth.ts` + `auth.test.ts` — 11-function supabase.auth wrapper
- [ ] (05-02-T2) `/Users/karstenhaldan/minisite/leanshot/src/lib/store.ts` extensions — signedIn, pendingOps, signOut, clearUserDataSlices, isSyncEnabled, mergeServerInjections + applyRealtimePayload STUBs
- [ ] (05-02-T3) `/Users/karstenhaldan/minisite/leanshot/src/components/auth/{AuthView,SignUpForm,SignInForm,VerifyEmailLanding,PostSignupSent,ForgotPasswordForm,SetNewPasswordForm,EmailVerificationBanner}.tsx`
- [ ] (05-02-T3) `/Users/karstenhaldan/minisite/leanshot/src/components/layout/AvatarMenu.tsx`
- [ ] (05-02-T4) `/Users/karstenhaldan/minisite/leanshot/src/lib/auth-migration.ts` + `auth-migration.test.ts`
- [ ] (05-02-T4) `/Users/karstenhaldan/minisite/leanshot/src/App.tsx` wired with auth handler + hashchange + auto-anon-mint + TODO(05-03) markers
- [ ] (05-02-T6) `/Users/karstenhaldan/minisite/leanshot/e2e/auth-signup-verify-signin.test.ts`
- [ ] (05-02-T6) `/Users/karstenhaldan/minisite/leanshot/e2e/password-reset.test.ts`
- [ ] (05-02-T6) `/Users/karstenhaldan/minisite/leanshot/e2e/signout-cache-clear.test.ts`
- [ ] (05-02-T7) `/Users/karstenhaldan/minisite/leanshot/.planning/decisions/account-deletion-interim.md`
- [ ] (05-03-T1) `/Users/karstenhaldan/minisite/leanshot/src/lib/sync.ts` + `sync.test.ts`
- [ ] (05-03-T4) `/Users/karstenhaldan/minisite/leanshot/e2e/cross-device-sync.test.ts`
- [ ] (05-03-T5) `/Users/karstenhaldan/minisite/leanshot/e2e/offline-log-then-sync.test.ts`
- [ ] (05-03-T6) `/Users/karstenhaldan/minisite/.github/workflows/ci.yml` — SUPABASE_* env wiring on test-unit + test-e2e + build step

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `SUPABASE_SERVICE_ROLE_KEY` configured as GitHub Actions secret | SC#5 | Service-role key cannot be committed; cross-tenant RLS test requires it to seed two users via admin client | User adds secret: `gh secret set SUPABASE_SERVICE_ROLE_KEY --body "$(npx supabase projects api-keys --project-ref ytnsipxxmzgaebkqmokp --output json \| jq -r '.[] \| select(.id==\"service_role\") \| .api_key')"` |
| Supabase Redirect URL allowlist updated for Vercel previews | AUTH-02, AUTH-04 | Dashboard-only config; CLI doesn't expose Redirect URL list on free tier | (Task 05-02-T5) User adds 4 entries (`http://localhost:5173/**`, `http://localhost:4173/**`, `https://leanshot-app.vercel.app/**`, `https://*-karstens-projects-16afd0e4.vercel.app/**`) via https://supabase.com/dashboard/project/ytnsipxxmzgaebkqmokp/auth/url-configuration |
| `supabase db push` requires DB password (or SUPABASE_ACCESS_TOKEN) | SC#5 | Interactive CLI prompt when token unset; mirrors Phase 4 04-03 Task 4 | (Task 05-01-T3) Executor first tries autonomous push with `SUPABASE_ACCESS_TOKEN`; falls back to user-action if missing |
| `supabase config push` is destructive | AUTH-01 password policy | Full overwrite, not merge — Phase 4 was bitten by this | (Task 05-02-T5) Executor runs `supabase config diff --linked` FIRST and surfaces drift before pushing |
| Vercel Preview UAT after deploy | SC#1..SC#5 | Real cross-browser sync requires deployed app + verified accounts; Playwright covers but human smoke catches UX issues | (Task 05-03-T7) User runs 5 SC scenarios in two browsers; reports approved/failure |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify command or are explicit human-checkpoints
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (worst gap is 1 — the BLOCKING db-push checkpoints have `migration list \| grep` as automated post-verification)
- [x] Wave 0 covers all MISSING references (5 e2e tests, RLS integration test, sync.ts, auth.ts, auth-migration.ts, 9 components, migration SQL, CI workflow updates)
- [x] No watch-mode flags
- [x] Feedback latency < 30s for the post-commit smoke
- [x] Cross-tenant RLS test exists with explicit assertion `count = 0` for cross-user reads
- [x] All 5 SCs covered by at least one Playwright/integration scenario:
  - SC#1: e2e/auth-signup-verify-signin.test.ts (first leg) + e2e/cross-device-sync.test.ts (completion)
  - SC#2: e2e/password-reset.test.ts
  - SC#3: e2e/signout-cache-clear.test.ts (+ CONF-2 marketing + CONF-3 acknowledgedDisclaimer assertions)
  - SC#4: e2e/offline-log-then-sync.test.ts
  - SC#5: e2e/rls-injections.test.ts (vitest integration with admin client) + CI gating in 05-03-T6
- [x] `nyquist_compliant: true` set in frontmatter (per-task table filled by planner)
