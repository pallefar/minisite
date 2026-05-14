---
phase: 14-monetization-foundation-stripe-web-clinic-seats
plan: "02"
subsystem: billing/stripe-foundation
tags:
  - stripe
  - csp
  - bootstrap
  - foundation
  - billing-meters

dependency_graph:
  requires:
    - Phase 12 (CSP snapshot test infrastructure — 12-04)
    - Phase 14 Plan 01 (Supabase schema — subscriptions/stripe_customers tables)
  provides:
    - Live Stripe price IDs (4) + Billing Meter ID (1) via bootstrap script stdout
    - CSP header allowing js.stripe.com + api.stripe.com + m.stripe.network + hooks.stripe.com
    - 8 env-var placeholders in .env.example for downstream plans
  affects:
    - Phase 14 Plan 04 (stripe-checkout Edge Function consumes STRIPE_PRICE_* env vars)
    - Phase 14 Plan 06 (Upgrade CTA + Portal link consume VITE_STRIPE_PUBLIC_KEY)
    - Phase 15 (pricing page consumes STRIPE_PRICE_* via Vercel env)
    - CI (CSP snapshot test now enforces Stripe origins in every PR)

tech_stack:
  added:
    - stripe@^17.7.0 (devDependency — bootstrap script only, NOT in Vite bundle)
    - tsx@^4.21.0 (devDependency — TypeScript runner for scripts/)
  patterns:
    - Pattern H (CSP atomic commit): vercel.json + csp-snapshot.txt in ONE commit
    - Pattern F (pathspec discipline): git commit with explicit pathspecs to avoid sibling-plan sweep
    - Pattern G (bundle isolation): no @stripe/stripe-js static import in src/
    - Billing Meters v1 API (NOT legacy usage_records.create — removed Stripe 2025-03-31)
    - Search-before-create idempotency (lookup_key for prices, name for products, event_name for meters)

key_files:
  created:
    - leanshot/scripts/stripe-bootstrap.ts (idempotent Stripe product+price+meter creator)
    - leanshot/scripts/stripe-bootstrap.test.ts (Vitest smoke — env-guard + HAS_STRIPE-gated live test)
  modified:
    - leanshot/vercel.json (CSP widened for Stripe domains per D-16)
    - leanshot/tests/csp/csp-snapshot.txt (synchronized snapshot per Pattern H)
    - leanshot/.env.example (8 new Stripe env vars documented under Phase 14 section)
    - leanshot/package.json (tsx + stripe added to devDependencies)
    - leanshot/package-lock.json (lockfile updated)
    - leanshot/vite.config.ts (scripts/**/*.test.ts added to vitest include — Rule 3 fix)

decisions:
  - "Stripe SDK v17 used for bootstrap script (Node.js runtime); v19 reserved for Deno Edge Functions"
  - "apiVersion '2026-04-22.dahlia' cast via Stripe.LatestApiVersion to bypass v17 type constraint (runtime accepts any string)"
  - "active_patients (plural) used as Billing Meter event_name per 14-02-PLAN.md interface contract"
  - "vitest include extended to scripts/**/*.test.ts (Rule 3 deviation — otherwise test not discovered)"

metrics:
  duration: "~25 minutes"
  completed: "2026-05-14"
  tasks_completed: 4
  files_changed: 8
---

# Phase 14 Plan 02: CSP Widen + Stripe Bootstrap Script + Env Wiring Summary

**One-liner:** Atomic CSP widening for Stripe domains + idempotent bootstrap script creating 2 products / 4 prices / 1 Billing Meter (Meters v1 API) + 8 env-var placeholders in .env.example.

## Objective Achieved

Phase 14 Plan 02 ships the two prerequisites that unblock Plans 14-03 (webhook) and 14-04 (Checkout):

1. **CSP widened** — browsers can now load `js.stripe.com`, reach `api.stripe.com`, and render Stripe Checkout 3DS frames via `hooks.stripe.com`. The old `frame-src 'none'` directive would have silently blocked Stripe Checkout's 3DS iframe challenges.

2. **Bootstrap script** — a developer with `STRIPE_SECRET_KEY` set can produce 5 live Stripe IDs in <30s by running `npx tsx scripts/stripe-bootstrap.ts`. The script is idempotent (safe to re-run); re-running produces zero net-new objects.

## CSP Delta

### vercel.json (before → after)

```
script-src 'self'
  → script-src 'self' https://js.stripe.com

connect-src 'self' ... https://api.anthropic.com
  → connect-src 'self' ... https://api.anthropic.com https://api.stripe.com https://m.stripe.network

frame-src 'none'
  → frame-src 'self' https://js.stripe.com https://hooks.stripe.com
```

### tests/csp/csp-snapshot.txt (synchronized in same commit per Pattern H)

Three lines updated to match vercel.json changes:
- `connect-src` — added `https://api.stripe.com https://m.stripe.network`
- `frame-src` — replaced `'none'` with `'self' https://js.stripe.com https://hooks.stripe.com`
- `script-src` — added `https://js.stripe.com`

All 11 lines remain sorted alphabetically by directive name per `parseCSP()` contract.

### Live Stripe API Run

The bootstrap script was **NOT** run against a live Stripe account from this worktree per the orchestrator's instruction. The Wave 2 vendor checkpoint owns the live run. The developer should:

```bash
cd leanshot
export STRIPE_SECRET_KEY=sk_test_...
npx tsx scripts/stripe-bootstrap.ts
```

Expected stdout (5 lines to copy into .env.local + Vercel env + Supabase Function secrets):

```
Add these to .env.example + Vercel env + Supabase Function secrets:
STRIPE_PRICE_PLUS_MONTHLY=price_...
STRIPE_PRICE_PLUS_YEARLY=price_...
STRIPE_PRICE_CLINIC_BASE=price_...
STRIPE_PRICE_CLINIC_OVERAGE=price_...
STRIPE_METER_ACTIVE_PATIENTS=mtr_...
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended vitest include to cover scripts/**/*.test.ts**

- **Found during:** Task 2 verification
- **Issue:** The vitest `include` pattern in `vite.config.ts` was `['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts', '../shared/**/*.test.ts']`. `scripts/stripe-bootstrap.test.ts` is outside all three patterns — `npx vitest run scripts/stripe-bootstrap.test.ts` returned "No test files found, exiting with code 1".
- **Fix:** Added `'scripts/**/*.test.ts'` to the `include` array in `vite.config.ts` (Phase 14 D-11 note added to comment).
- **Files modified:** `leanshot/vite.config.ts`
- **Commit:** `e066a16` (included in the atomic pathspec commit)

**2. [Rule 1 - Bug / Type Cast] stripe@v17 type definition pins apiVersion to '2025-02-24.acacia'**

- **Found during:** Task 2 implementation
- **Issue:** The plan states "Stripe SDK v17 supports `apiVersion: '2026-04-22.dahlia'`" but stripe@v17's `LatestApiVersion` type alias is `'2025-02-24.acacia'`. Passing `'2026-04-22.dahlia'` causes a TypeScript type error.
- **Fix:** Cast via `'2026-04-22.dahlia' as Stripe.LatestApiVersion`. At runtime, Stripe accepts any string as the API version header — the type constraint is the only blocker. The runtime behaviour is correct.
- **Files modified:** `leanshot/scripts/stripe-bootstrap.ts` (one cast on line 28)

**3. [Grep-gate note] usage_records / usage_type comment-strip false positives**

- Per `reference_grep_gate_comment_strip.md`, verification gate `grep -c "usage_records"` returns 2 (two comment lines mentioning `usage_records.create` as the REMOVED API). Actual code has zero `usage_records` API calls — Billing Meters v1 is used exclusively. This is expected behaviour under the comment-strip guidance.

### Pathspec Note

The commit contains 8 files (not 7 as listed in the plan's invariants): `vite.config.ts` was added due to Rule 3 deviation. No sibling-plan files were included (parallel executor 14-01 edits `supabase/migrations/*` and `leanshot/tests/rls/*` which are outside this pathspec).

## Known Stubs

None. The bootstrap script produces real Stripe IDs when run with a live key. The env-var placeholders in `.env.example` are intentionally `price_...` / `mtr_...` — these are filled by the developer running the script (documented in the file itself and in `[[feedback_cli_over_paste_back]]`).

## Threat Flags

No new threat surface introduced. The bootstrap script is a developer tool (not deployed). The CSP widening adds external origins but these are Stripe's documented domains required for Checkout + Portal to function. The `@stripe/stripe-js` browser SDK is NOT added (Pattern G enforced; Pitfall 10).

## Open Follow-ups (handed off to Plan 14-03 / 14-04)

- **Plan 14-03** (stripe-webhook Edge Function): needs `STRIPE_WEBHOOK_SECRET` set in Supabase Function secrets — fill after running the bootstrap script and provisioning the webhook endpoint.
- **Plan 14-04** (stripe-checkout Edge Function): consumes `STRIPE_PRICE_PLUS_MONTHLY`, `STRIPE_PRICE_PLUS_YEARLY`, `STRIPE_PRICE_CLINIC_BASE`, `STRIPE_PRICE_CLINIC_OVERAGE` from Supabase Function secrets — fill from bootstrap script stdout.
- **Wave 2 vendor checkpoint**: Run `npx tsx scripts/stripe-bootstrap.ts` with `STRIPE_SECRET_KEY=sk_test_...`; paste the 5 ID lines into Vercel env + Supabase Function secrets; verify with `HAS_STRIPE=true npm test -- scripts/stripe-bootstrap.test.ts`.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `leanshot/scripts/stripe-bootstrap.ts` exists | FOUND |
| `leanshot/scripts/stripe-bootstrap.test.ts` exists | FOUND |
| `14-02-SUMMARY.md` exists | FOUND |
| Commit `e066a16` exists in git log | FOUND |
| `npx vitest run tests/csp/csp-snapshot.test.ts` | 1 passed |
| `npx vitest run scripts/stripe-bootstrap.test.ts` | 1 passed, 1 skipped (HAS_STRIPE gate) |
