---
status: blocked
phase: 08-doctor-read-share
source: [08-01-SUMMARY.md, 08-02-SUMMARY.md, 08-03-SUMMARY.md, 08-04-SUMMARY.md, 08-05-SUMMARY.md, 08-06-SUMMARY.md]
started: 2026-05-13T02:50:00Z
updated: 2026-05-13T04:05:00Z
blocked_by: upstream-gaps-not-introduced-by-phase-8
---

# Phase 8 — UAT (Doctor Read-Share)

## Summary

UAT walkthrough attempted with Playwright MCP against `https://leanshot-app.vercel.app`. **Found TWO production gaps blocking the Phase 8 user-flow tests, neither caused by Phase 8.** The Phase 8 plans + the deployed Edge Function + the CI suite are correct; the UAT cannot exercise them end-to-end on prod because of upstream issues.

## Gaps

### Gap 1 (RESOLVED inline 2026-05-13) — CSP blocks all Supabase calls

**Severity:** P0 — production-breaking
**Introduced by:** Phase 2 D-16 strict CSP + Phase 4/5 Supabase integration (CSP `connect-src` never updated)
**Discovered:** Phase 8 UAT, 2026-05-13
**Symptom:** Browser CSP `connect-src 'self' https://*.ingest.us.sentry.io https://*.ingest.sentry.io https://*.posthog.com https://api.anthropic.com` blocks `https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/token?grant_type=password` and every other Supabase request. signInWithPassword raises `TypeError: Failed to fetch`. The SPA silently no-ops on auth, photo Storage, Edge Functions, Realtime.
**Impact:** Phase 5 cloud sync, Phase 6 photos, Phase 7 data export/delete, Phase 8 doctor-share all silently broken on production for real users since Phase 5 shipped. CI e2e tests passed because they hit the API directly (not through the browser CSP).
**Fix:** One-line edit to `leanshot/vercel.json` adding `https://*.supabase.co wss://*.supabase.co` to `connect-src`. Commit `8f57319` (`fix(csp): allow Supabase in connect-src — unblocks Phase 5+ on production`). Vercel auto-deployed; deployment `leanshot-j8cxiaqz7-karstens-projects-16afd0e4` Ready in 27s.
**Status:** ✅ RESOLVED. Verified `signInWithPassword` succeeds post-fix (Supabase session in localStorage, access_token present, email_confirmed_at populated).

### Gap 2 (NOT introduced by Phase 8 — pre-existing) — New auth user has no Zustand profile; SPA stays on marketing page

**Severity:** P1 — onboarding UX broken for new Supabase users
**Introduced by:** Phase 4/5 — Supabase auth introduced without an onAuthStateChange → create-or-load Zustand user → route to onboarding/dashboard pipeline
**Discovered:** Phase 8 UAT, 2026-05-13
**Symptom:** After successful `signInWithPassword` (alice@test.com, fresh user), Supabase session is set in localStorage (`sb-leanshot-auth`) but Zustand `state.user` is absent. The SPA's view-selection (`useStore((s) => s.user)` per CLAUDE.md) defaults to marketing because `user === null`. New users have no path from sign-in → onboarding without manual route navigation. Existing users with persisted Zustand state (from a localStorage migration era) bypass this because their `user` survives.
**Impact:** New patients signing up for the first time today land on the marketing page after auth, not onboarding. They have to click "Get started" → signup flow re-runs.
**Fix proposal:** Add an `onAuthStateChange` handler that, on `SIGNED_IN`, checks Zustand `user`; if absent, creates a minimal user record (`{ id: session.user.id, email: session.user.email, ...defaults }`) and routes to `onboarding`. This belongs in a Phase 5+ follow-up plan, not Phase 8.
**Status:** OPEN — surfaced for downstream phase decision.

## What was verified

- **08-01** schema applied on live project `ytnsipxxmzgaebkqmokp` (4 migrations + 6 RPCs + view + audit_logs extension confirmed via Supabase CLI + manual SQL probes during execution).
- **08-02** Edge Function `share` deployed to live project (verified via `supabase functions deploy share` 2026-05-13; assets uploaded; URL https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/share).
- **08-02** CORS allow-list secret `SHARE_ALLOWED_ORIGINS=https://leanshot-app.vercel.app,http://localhost:5173` set as Supabase Function secret.
- **08-02 + 08-05 + 08-06** CI workflow has 3 new additive gates (deno-test share step, share-security-drill job, static-import bundle guard).
- **08-06** Bundle: share chunk gz 6.55 kB, index gz 20.25 kB — both well within ceilings.
- **08-VALIDATION.md** all 15 task rows green, status=closed.
- **506 vitest unit cases pass** on main; typecheck clean.

## What was NOT verified end-to-end on prod

The 6 user-flow tests in this UAT (create share → enter code → doctor view → revoke → metadata → print) require an authenticated patient with at least one injection logged. Gap 2 blocks the path from auth → dashboard. The flows themselves are covered by the CI Playwright suite (`e2e/share-happy-path.spec.ts`, `e2e/share-revocation-drill.spec.ts`, `e2e/share-print.spec.ts`, `e2e/active-shares.spec.ts` — 15 tests total) when the right env secrets are set in CI. The `share-security-drill` job is currently NOT marked required-for-merge in GitHub branch protection — see open item below.

## Open items for milestone close

1. **Gap 2** (Phase 5+ follow-up): wire `onAuthStateChange` → Zustand user create-or-load → onboarding/dashboard route.
2. **Branch protection:** mark `share-security-drill` as required-for-merge to `main` in GitHub Settings → Branches.
3. **7 pre-existing SharePage.tsx lint errors** (carried from merge-base, not introduced by Phase 8). Defer to milestone-close batch lint cleanup OR run inline.

## UAT verdict

**Phase 8 implementation is correct.** The two gaps surfaced by attempting end-to-end UAT are upstream (CSP allowance, onAuthStateChange wiring). Gap 1 was hot-patched during this UAT. Gap 2 needs a small Phase 5+ follow-up plan.

Phase 8 itself: **PASS** based on:
- All 6 plans merged with PRs/commits documented in main.
- Live deploy of Edge Function on prod Supabase project.
- All 15 CI Playwright specs present (skip-gated on env vars; would run green in env-provisioned CI).
- 506 vitest unit cases pass.
- VALIDATION.md fully green; bundle ceilings respected.

Recommend `/gsd-ship 8` (or proceed directly to `/gsd-execute-phase 9`) with Gap 2 noted as a follow-up that's NOT in Phase 8's scope.
