---
phase: 65-stripe-tax-payment-resilience
plan: 07
subsystem: lifecycle-emails
tags: [edge-fn, resend, posthog, stripe, lifecycle, can-spam, idempotency]
dependency_graph:
  requires:
    - 65-01 (lifecycle_emails_sent composite-PK table, email_lifecycle_exclusion)
    - 64-03 (grandfathered-policy-notice handler/index pattern — DI + bearer auth + CAN-SPAM guard)
    - 60-02 (slack-guardrail-alert helper)
    - 60-12 (newsletter-token HMAC envelope + constant-time-compare)
  provides:
    - supabase/functions/lifecycle-trial-ending (T-3d + T-1d Edge Fn)
    - supabase/functions/lifecycle-win-back (T+30d/T+60d/T+90d Edge Fn)
    - 12 email templates under _shared/email-templates/ (6 trial-ending + 6 win-back)
  affects:
    - Plan 65-10 (operator close-out: deploy Fns, register pg_cron schedules,
      create 3 Stripe coupons in Dashboard, set 7+ Function Secrets)
tech-stack:
  added:
    - stripe@19?target=denonext (lifecycle-win-back Stripe Promotion Code mint)
  patterns:
    - handler/index split + Deno.serve under import.meta.main (reference_deno_test_top_level_serve_trap)
    - DI seam via Deps interface (testability + vendor mocking)
    - PHYSICAL_ADDRESS runtime placeholder guard (feedback_placeholder_string_runtime_guard_pattern)
    - INSERT-BEFORE-SEND + DELETE-on-failure rollback (idempotency without losing retries)
    - PostHog A/B variant with fail-soft default ('a') — no hard PostHog dependency
key-files:
  created:
    - supabase/functions/lifecycle-trial-ending/handler.ts (395 lines)
    - supabase/functions/lifecycle-trial-ending/index.ts
    - supabase/functions/lifecycle-trial-ending/deno.json
    - supabase/functions/lifecycle-trial-ending/__tests__/handler.test.ts (17 tests pass)
    - supabase/functions/lifecycle-win-back/handler.ts (429 lines)
    - supabase/functions/lifecycle-win-back/index.ts
    - supabase/functions/lifecycle-win-back/deno.json
    - supabase/functions/lifecycle-win-back/__tests__/handler.test.ts (14 tests pass)
    - supabase/functions/_shared/email-templates/trial-ending-t3d-a.html
    - supabase/functions/_shared/email-templates/trial-ending-t3d-a.txt
    - supabase/functions/_shared/email-templates/trial-ending-t3d-b.html
    - supabase/functions/_shared/email-templates/trial-ending-t3d-b.txt
    - supabase/functions/_shared/email-templates/trial-ending-t1d.html
    - supabase/functions/_shared/email-templates/trial-ending-t1d.txt
    - supabase/functions/_shared/email-templates/winback-t30d.html
    - supabase/functions/_shared/email-templates/winback-t30d.txt
    - supabase/functions/_shared/email-templates/winback-t60d.html
    - supabase/functions/_shared/email-templates/winback-t60d.txt
    - supabase/functions/_shared/email-templates/winback-t90d.html
    - supabase/functions/_shared/email-templates/winback-t90d.txt
  modified: []
decisions:
  - "Used Supabase RPC (get_trial_ending_candidates, get_winback_candidates) for window+exclusion filtering at DB level. RPC bodies live in Plan 65-10 close-out (planner had window queries as SQL in PLAN.md; pulling them into RPCs centralizes the filter + LIMIT 200/stage logic and matches the grandfathered-notice DB-level-exclusion pattern. Tests mock the RPC directly so no DB migration is required from this plan)."
  - "PostHog flag eval uses POST /decide?v=3 (per PLAN.md interface). Defaults to variant 'a' on ANY error path (missing key, 5xx, parse error, null featureFlags). T-1d always uses variant 'a' (no A/B per CONTEXT D-10)."
  - "INSERT lifecycle_emails_sent BEFORE Resend send (and BEFORE Stripe mint on win-back) for composite-PK race protection. On downstream failure, DELETE the row so next cron retries with a fresh slot. Trade-off: a crashed Deno isolate between INSERT and Resend leaves a 'sent' row with no email + no message_id — caught later by analytics rollup (zero resend_message_id rows = retry candidates)."
  - "Stripe Promotion Code expires_at = now + 30 days. Acceptable orphan window when Resend fails after Stripe mint succeeds — Slack P2 fires for operator awareness, code self-expires."
  - "Templates use `Deno.readTextFile` resolved via `import.meta.url` so the same files work under `deno test` and `deno deploy`. Test fallback returns a minimal placeholder string when files are unreadable, but in this commit the real templates ship so the readFile succeeds in tests too."
metrics:
  duration: 35m
  tasks: 2
  files: 20
  commits: 2
  tests_passing: 31
completed: 2026-05-26
---

# Phase 65 Plan 65-07: Lifecycle Trial-Ending + Win-Back Edge Fns Summary

**One-liner:** Two cron-driven lifecycle Edge Fns (T-3d/T-1d trial-ending with PostHog A/B copy variant + T+30d/T+60d/T+90d win-back with per-user Stripe Promotion Codes), sharing the grandfathered-policy-notice handler/index/DI pattern; 31 deno tests pass; 12 email templates with CAN-SPAM guards.

## What Shipped

### Task 1 — lifecycle-trial-ending Fn (commit 4780097f)

`supabase/functions/lifecycle-trial-ending/handler.ts` (395 lines) executes a two-stage cron sweep:

- **Stage `trial_ending_t3d`**: queries via `rpc('get_trial_ending_candidates', { stage_key })`, evaluates PostHog flag `trial_ending_copy_variant` via `POST {host}/decide?v=3`, picks `t3d-a` or `t3d-b` template.
- **Stage `trial_ending_t1d`**: same query pattern but always uses variant `'a'` (no A/B per CONTEXT D-10).

PostHog uptime is NOT a hard dependency — any of `posthogApiKey` missing, non-200 response, parse error, or null `featureFlags.trial_ending_copy_variant` defaults to variant `'a'`. This was test-driven via Test 7 (`posthogFail: true` → asserts `sentRows[0].copy_variant === 'a'`).

**6 templates**: `trial-ending-t3d-a.{html,txt}`, `trial-ending-t3d-b.{html,txt}`, `trial-ending-t1d.{html,txt}`. Variant A and B encode visible markers (`Variant A` + `variant-a` class; `Variant B` + `variant-b` class) so test assertions discriminate without parsing copy. All 6 honor CAN-SPAM (physical address footer + unsubscribe link + List-Unsubscribe headers). CTA URL is `/settings/billing` across all 3 stages.

**17 tests pass** — 12 mandated by PLAN.md `<behavior>` + 5 supplementary (bearer-401, missing-address-503, healthz, Resend-failure-rollback, T-3d/T-1d CTA-URL-parity).

### Task 2 — lifecycle-win-back Fn (commit 9778be72)

`supabase/functions/lifecycle-win-back/handler.ts` (429 lines) executes a three-stage cron sweep with per-user Stripe Promotion Code mint:

- **Stage `winback_t30d`** → 10% off coupon (env `STRIPE_COUPON_WINBACK_10`)
- **Stage `winback_t60d`** → 25% off coupon (env `STRIPE_COUPON_WINBACK_25`)
- **Stage `winback_t90d`** → 50% off coupon (env `STRIPE_COUPON_WINBACK_50`)

Promotion Code mint shape:
```ts
stripe.promotionCodes.create({
  coupon: coupons[stage_short],
  max_redemptions: 1,                 // T-65-07-02 prevents sharing
  customer: stripe_customer_id,       // per-user scope
  code: 'WINBACK-XXXXXXXX',           // uuid8 suffix, human-readable
  expires_at: now + 30 * 86400,       // 30-day expiry
})
```

The minted code lands in `lifecycle_emails_sent.promo_code` and is rendered into the email body + `reactivate_url` query string (`/pricing?promo=<code>`). The 3 coupon IDs MUST be created in Stripe Dashboard BEFORE deploy — operator carry-over for Plan 65-10.

**Rollback semantics**:
- Stripe mint failure → DELETE the `lifecycle_emails_sent` row, push `stripe_failed:*` error, continue to next user.
- Resend failure after successful Stripe mint → DELETE the row + log orphaned code via Slack P2 alert (per T-65-07-06 disposition). The code self-expires in 30 days; the next cron run mints a fresh code and retries.

Defensive guard: users without `stripe_customer_id` (pre-Stripe-launch cancellees) are skipped at the in-handler check even though the RPC filter also excludes them.

**6 templates**: `winback-t{30,60,90}d.{html,txt}` with escalating-urgency subjects:
- t30d: "We miss you — 10% off if you come back"
- t60d: "25% off your return"
- t90d: "Last chance: 50% off"

All 6 honor CAN-SPAM + render `{{promo_code}}` + `{{reactivate_url}}` + `{{discount_pct}}`.

**14 tests pass** — 12 mandated by PLAN.md `<behavior>` + 2 supplementary (healthz, Resend-failure-orphan-coupon path).

## Test Results

```
lifecycle-trial-ending: ok | 17 passed | 0 failed (24ms)
lifecycle-win-back:     ok | 14 passed | 0 failed  (9ms)
TOTAL: 31 tests pass
```

Run command:
```bash
cd /Users/karstenhaldan/minisite && \
  $HOME/.deno/bin/deno test --no-check --allow-env --allow-net --allow-read \
    supabase/functions/lifecycle-trial-ending/__tests__/handler.test.ts \
    supabase/functions/lifecycle-win-back/__tests__/handler.test.ts
```

## Threats Mitigated

| Threat ID | Disposition | How |
|-----------|-------------|-----|
| T-65-07-01 (double-send via cron drift) | mitigated | `lifecycle_emails_sent (user_id, stage)` composite PK + `upsert(..., { onConflict: 'user_id,stage', ignoreDuplicates: true })`. Test 9 (both Fns) proves second invocation returns `skipped` without re-mint / re-send. |
| T-65-07-02 (promo code reuse / sharing) | mitigated | `max_redemptions: 1` + `customer: <stripe_customer_id>` scope + `expires_at: now + 30d`. Stripe Promotion Code mechanics enforce single-shot-per-customer redemption. |
| T-65-07-03 (CAN-SPAM violation) | mitigated | `PHYSICAL_ADDRESS` env var + `[`/`TODO`/`REPLACE_ME` regex placeholder guard → 503 + Slack P1. Test 2 + Test 2b (trial-ending) + Test 7 (win-back) cover both missing and placeholder paths. `email_marketing_consent` + `email_lifecycle_exclusion` are honored at the DB-level via the RPC predicate (LEGAL-09). |
| T-65-07-04 (PostHog flag leak) | accepted | distinct_id = `user.id` (UUID). PostHog already receives this via app-side instrumentation. |
| T-65-07-05 (runaway sends) | mitigated | RPC enforces `LIMIT 200/stage`; composite PK prevents repeat sends across daily cron runs. |
| T-65-07-06 (orphaned promo codes) | accepted | Slack P2 alert when Resend fails after Stripe mint. Code expires in 30 days. Operator can manually email the user or let it lapse. |

## Carry-Over to Plan 65-10 (Operator Close-Out)

1. **Create 3 Stripe coupons in Stripe Dashboard** (cannot be created via Edge Fn — these are platform-level resources):
   - 10% off → set env `STRIPE_COUPON_WINBACK_10` to coupon id
   - 25% off → set env `STRIPE_COUPON_WINBACK_25` to coupon id
   - 50% off → set env `STRIPE_COUPON_WINBACK_50` to coupon id
2. **Create the 2 RPC functions** required by the handlers:
   - `public.get_trial_ending_candidates(stage_key text)` — returns rows where `subscriptions.status='trialing'` AND `trial_end_at` is in the stage-specific window AND consent/exclusion checks pass AND NOT in `lifecycle_emails_sent (user_id, stage)`. LIMIT 200/stage. SECURITY DEFINER, service_role only.
   - `public.get_winback_candidates(stage_key text)` — same shape but `status='canceled'` + JOIN `stripe_customers` to filter `stripe_customer_id IS NOT NULL`.
3. **Verify subscriptions schema columns** — handlers expect `trial_end_at` and `cancelled_at` columns (plus `status` enum widened to include `'trialing'`). The base table from Phase 14 has `trial_end` (no `_at`) and lacks `cancelled_at`. Close-out should add `ALTER TABLE` migrations or the RPCs MUST internally map to existing columns.
4. **Set Function Secrets** before first cron fire:
   - `RESEND_API_KEY`, `PHYSICAL_ADDRESS`, `NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY`
   - `POSTHOG_PROJECT_KEY`, `POSTHOG_HOST` (optional — defaults to variant 'a' on absence)
   - `STRIPE_SECRET_KEY`, `STRIPE_COUPON_WINBACK_{10,25,50}`
5. **Deploy** both Fns: `supabase functions deploy lifecycle-trial-ending lifecycle-win-back --project-ref ytnsipxxmzgaebkqmokp`.
6. **Register pg_cron** schedules pointing at the deployed Fns (per [[reference_supabase_pg_cron_vault_service_role_pattern]]). Daily for trial-ending, weekly for win-back (per CONTEXT.md).

## Deviations from Plan

### Rule 2 — Added Stripe presence guard (correctness)

PLAN.md required `stripe` in `WinBackDeps` but didn't specify behavior on missing client. Added explicit 503 with `error: 'stripe_not_configured'` when `deps.stripe` is null/undefined in production path (Function Secret missing). Without this, the handler would NPE on the first `stripe.promotionCodes.create()` call and leave half-formed state. Aligned with the PHYSICAL_ADDRESS guard pattern.

### Rule 3 — Added `--allow-read` to test runner

PLAN.md `<verify>` block specifies `--no-check --allow-env --allow-net`. Templates are loaded via `Deno.readTextFile()` (preferred over inline strings for maintainability), which requires `--allow-read`. Added to the verify command. Templates fall back to minimal placeholder when readFile fails, so tests still pass with the original flags, but real prod-shape templates only render when read permission is granted.

### Inferred RPC names (planner deferred to executor)

PLAN.md specifies the query SQL inline in `<interfaces>` but does NOT name the RPC. Chose:
- `get_trial_ending_candidates(stage_key text)`
- `get_winback_candidates(stage_key text)`

Mirrors the grandfathered-notice pattern (`get_grandfathered_notice_candidates(cutoff_date timestamptz)`). Close-out creates the RPCs.

## Threat Flags

None — all new surface declared in the plan's `<threat_model>` register.

## Self-Check: PASSED

**Files verified:**
- FOUND: supabase/functions/lifecycle-trial-ending/handler.ts (395 lines)
- FOUND: supabase/functions/lifecycle-trial-ending/index.ts
- FOUND: supabase/functions/lifecycle-trial-ending/deno.json
- FOUND: supabase/functions/lifecycle-trial-ending/__tests__/handler.test.ts
- FOUND: supabase/functions/lifecycle-win-back/handler.ts (429 lines)
- FOUND: supabase/functions/lifecycle-win-back/index.ts
- FOUND: supabase/functions/lifecycle-win-back/deno.json
- FOUND: supabase/functions/lifecycle-win-back/__tests__/handler.test.ts
- FOUND: 12 email templates under supabase/functions/_shared/email-templates/

**Commits verified:**
- FOUND: 4780097f — feat(65-07): lifecycle-trial-ending
- FOUND: 9778be72 — feat(65-07): lifecycle-win-back

**Tests verified:** 31/31 pass (17 trial-ending + 14 win-back).
