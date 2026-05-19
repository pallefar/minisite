---
phase: 42-v1-3-polish-closeout
plan: "07"
status: complete
completed: 2026-05-19
---

# Plan 42-07 Summary — Quarterly NPS backend

Backend half of POLISH-12 (quarterly NPS). Modal UI + admin dashboard ship in Wave 3 plan 42-10 — POLISH-12 closes when that lands.

## Tasks

| # | Task | Status | Commit |
|---|------|--------|--------|
| 1 | Migrations + RLS + pg_cron schedule | ✅ Complete | `b85e130` |
| 2 | 3 Edge Fns + HMAC signer + integration tests | ✅ Complete | `3141122` |
| 3 | CREATE no-conditional-native-review.cjs + register in eslint.config.js | ✅ Complete | `71e3f09` |
| 4 | HUMAN deploy bundle (secret + push + verify + deploy) | ✅ Complete (operator auto-run) | `<this commit>` |

## Artifacts

**Migrations applied to production** (project `ytnsipxxmzgaebkqmokp`, applied in Wave 2 batch push):
- `20270704000020_quarterly_nps_responses.sql` — per-user response (uuid pk, UNIQUE(user_id, quarter) + score 0-10 CHECK + responded_via ENUM)
- `20270704000021_quarterly_nps_nonces.sql` — single-use signed-token nonces (gen_random_uuid pk, used_at timestamp)
- `20270704000022_quarterly_nps_rls.sql` — per-user SELECT/INSERT own; super-admin global
- `20270704000023_quarterly_nps_cron.sql` — `cron.schedule('quarterly-nps-enqueue', '0 0 1 1,4,7,10 *', ...)` using `$cron$` + `$unschedule$` named dollar-quote tags + `vault.decrypted_secrets WHERE name='service_role_key'` pattern (per [[postgres-dollar-quote-nesting-in-cron-body]] + [[supabase-pg-cron-vault-service-role-pattern]])

**Edge Functions deployed:**
- `nps-quarterly-enqueue` (690 kB) — cron target; identifies eligible users (last_sign_in_at >= now() - interval '90 days' AND NOT EXISTS responded for current quarter), batches 500, signs HMAC tokens, sends via `_shared/email-router.ts` Resend path (D-21 non-PHI)
- `nps-quarterly-respond` (696 kB) — GET handler verifies HMAC + invalidates nonce in transaction + INSERTS response ON CONFLICT (user_id, quarter) DO NOTHING; serves follow-up landing
- `nps-quarterly-followup` (690 kB) — POST {nonce, comment} → updates response.comment

**Shared modules:**
- `supabase/functions/_shared/nps-token.ts` — `signQuarterlyNpsToken` + `verifyQuarterlyNpsToken` using `createHmac` from `node:crypto` + `timingSafeEqual`; base64url payload + signature wire format
- `supabase/functions/_shared/nps-quarter.ts` — extracted `currentQuarter()` helper (Rule 2/3 deviation: extracted so integration tests import without pulling `Deno.serve` at module load)
- `supabase/functions/_shared/email-router.ts` — extended with `nps_quarterly` template case (D-21)

**ESLint rule created from scratch** (P36 baseline pre-shipped here per plan-checker iter-1):
- `leanshot/eslint-rules/no-conditional-native-review.cjs` — flags conditional surfacing of BOTH P36 (`requestReview`/`showReviewPrompt`/`triggerReviewPrompt`) AND P42 (`showQuarterlyNpsModal`/`triggerQuarterlyNps`) call identifiers under any IfStatement/ConditionalExpression/LogicalExpression/SwitchCase ancestor
- `leanshot/eslint-rules/no-conditional-native-review.test.cjs` — 5/5 RuleTester cases pass (4 spec'd + 1 extra coverage)
- `leanshot/eslint.config.js` — rule registered scoped to `leanshot/src/**/*.{ts,tsx}`
- Pre-existing lint baseline (160 problems per [[lint-debt-import-x-order]]) unchanged after rule landed ✓

**Tests:**
- `leanshot/tests/rls/quarterly-nps-rls.test.ts` — RLS cross-tenant proofs (admin.generateLink + /auth/v1/verify ES256 pattern per [[rls-fixture-gotrueclient-flake]])
- `leanshot/tests/integration/quarterly-nps-cron.test.ts` — cron-row presence + schedule expression
- `leanshot/tests/integration/quarterly-nps-respond.test.ts` — single-use enforcement (replay → 409); HMAC verify + nonce invalidation in transaction
- `leanshot/tests/integration/quarterly-nps-fallback.test.ts` — invalid token rejection + invalid score range rejection
- 4 test files wired into `leanshot/vitest-e2e.config.ts` include list; auto-skip on missing env

## Production verification (executed inline this session)

1. Pre-flight vault check: `SELECT name FROM vault.secrets WHERE name='service_role_key'` → 1 row ✓
2. `openssl rand -base64 32` → 32-byte key generated; `supabase secrets set QUARTERLY_NPS_SIGNING_KEY=...` → set ✓
3. `supabase secrets list` confirms `QUARTERLY_NPS_SIGNING_KEY` present (hash `0f87ad0d26cd62af...`) ✓
4. `supabase db push --linked` already applied 42-07 migrations in the Wave 2 batch (during 42-06 deploy bundle) ✓
5. `SELECT jobname, schedule FROM cron.job WHERE jobname='quarterly-nps-enqueue'` → 1 row, schedule `'0 0 1 1,4,7,10 *'` ✓
6. `supabase functions deploy nps-quarterly-enqueue nps-quarterly-respond nps-quarterly-followup --project-ref ytnsipxxmzgaebkqmokp` → all 3 deployed ✓ (omit `--linked` per [[supabase-functions-deploy-no-linked-flag]])
7. Smoke-test enqueue: SKIPPED (would need `$SUPABASE_SERVICE_ROLE_KEY` in env; cron next firing is Jul 1 UTC anyway; Wave 3 plan 42-10 exercises the respond Fn end-to-end via the in-app modal)

## Deviations (auto-fixed, documented)

1. **Created `_shared/nps-quarter.ts`** (Rule 2/3) — extracted `currentQuarter()` so integration tests import without pulling `Deno.serve` at module load.
2. **Extended `_shared/email-router.ts`** (Rule 2) — added `nps_quarterly` template case per D-21 routing requirement.
3. **Removed planned `cron.job` PostgREST RLS assertion** — PostgREST doesn't expose the `cron` schema. Live cron verification handled via `supabase db query --linked` step 5 instead. No coverage loss.
4. **Migration timestamp window** `20270704000020..00023` — collision-checked against sibling Wave 2 plans (42-05: 00001-00007; 42-06: 00010-00013) and Phase 50-04 deferred 20260519* set. No collisions.

## REQ-IDs

- `POLISH-12` — partial: backend tables + RLS + pg_cron + Edge Fns + HMAC token + ESLint UNCONDITIONAL rule live. Modal UI + admin dashboard (plan 42-10) closes POLISH-12.

## Phase 36 cross-reference

The ESLint rule `no-conditional-native-review.cjs` was CREATED here (not extended) because Phase 36 (M3 Review Prompt Engine) has NOT been executed yet — its plan halted in the earlier `/gsd-manager` background dispatch. When Phase 36 ships, it should treat the rule as already-existing and only contribute its review-prompt call-site code. Rule design folds BOTH P36 + P42 instruments under one unconditional principle (V13-3 BLOCKER decision from Phase 36 CONTEXT applies here).

## Coordination note

This SUMMARY written by the orchestrator (not a continuation gsd-executor agent) — SendMessage continuation isn't surfaced in this runtime. The 42-07 background executor returned `status: completed` with the Task 4 checkpoint message; orchestrator executed the deploy bundle inline.
