---
phase: 34-m2-onboarding-overhaul-activation-event
type: carry-over
created: 2026-05-21
deferred_to: v1.3-milestone-close
---

# Phase 34 — Deferred Items (carry to v1.3 milestone close)

Phase 34 shipped 9.25 of 10 plans. The following items are deferred per operator decision (2026-05-21).

## 34-08 — Admin onboarding-builder UX walkthrough

- **Disposition:** Operator-approved automated-verify-only ([[hitl-walkthrough-deferred-when-fixtures-missing]] pattern).
- **Why:** Local dev lacks superadmin/admin `auth.users` + `profiles.admin_role` rows; legacy login screen does not yet wire `signInWithOAuthProvider` (Plan 34-04 helper exists but call-site missing).
- **Re-test at:** staging deploy after fixture seeding lands.
- **Source:** `34-08-CHECKPOINT-NOTES.md` Resolution section.

## 34-10 Task 2 — Apple Services ID + .p8

- **Disposition:** Browser-only checkpoint, ~30 min, carried to milestone close.
- **Action required:** Apple Developer Portal → Identifiers → Services IDs → create `app.leanshot.web` with Domain `ytnsipxxmzgaebkqmokp.supabase.co` + Return URL `https://ytnsipxxmzgaebkqmokp.supabase.co/auth/v1/callback`; create Sign in with Apple Key (.p8) → note Key ID + Team ID; paste Services ID + Team ID + Key ID + .p8 contents into Supabase Dashboard → Auth → Providers → Apple; flip `VITE_AUTH_APPLE_ENABLED=true` env vars on Vercel (production + preview); redeploy.
- **Walkthrough:** `34-10-APPLE-CHECKPOINT.md` (verbatim script).
- **Side-effect if skipped:** ONBOARD-02 ships partial (magic-link + Google only). Apple OAuth web stays gated by tri-source `isAppleEnabled()` → `false`, no production traffic affected.

## 34-10 Task 3 — PostHog Personal API key + secrets

- **Disposition:** CLI-runnable checkpoint, ~10 min, carried to milestone close per operator.
- **Action required:** Create personal API key at `https://us.posthog.com/settings/user-api-keys` with `feature_flag:write` + `insight:read` scopes; then:
  ```bash
  supabase secrets set --project-ref ytnsipxxmzgaebkqmokp POSTHOG_PERSONAL_API_KEY=phx_...
  supabase secrets set --project-ref ytnsipxxmzgaebkqmokp POSTHOG_PROJECT_ID=<int>
  supabase functions deploy ship-winner-flag --import-map supabase/functions/import_map.json
  supabase functions deploy onboarding-funnel-query --import-map supabase/functions/import_map.json
  ```
- **Walkthrough:** `34-10-POSTHOG-CHECKPOINT.md` (verbatim script + curl smoke).
- **Side-effect if skipped:** `ship-winner-flag` + `onboarding-funnel-query` Edge Fns return 503 with logged warning (designed degradation per [[vendor-gated-send-via-health-check]]); admin A/B + Funnel tabs show "vendor unconfigured" banner. No production traffic affected; Ship Winner just can't flip the PostHog flag.

## 34-10 Task 4 — Final smoke

- **Disposition:** Blocked on Tasks 2 + 3. Runs after both resume signals are satisfied.
- **Action required:** `npm run lighthouse:onboard` → assert mobile score ≥90; `npx playwright test --grep onboarding`; full Deno + vitest sweep; `git push` after green.

## Cross-phase deferred (also milestone close)

- **38-08 HITL admin queue UX walkthrough** — parked since session start at `worktree-agent-a6da34fdfa334114b` (commit `6200c45`). Same fixture-gap pattern as 34-08; recommend same automated-verify-only disposition + same milestone-close re-test.

## Milestone-close audit checklist

When v1.3 closes:
1. Confirm fixture seeding (superadmin + admin rows on production) is in place.
2. Resume each signal above by following its walkthrough.
3. Run 34-10 Task 4 final smoke against the post-vendor-config state.
4. Re-test 34-08 + 38-08 admin UX walkthroughs against staging or production.
5. Mark this Phase 34 + Phase 38 as fully closed in ROADMAP.md / STATE.md.
