---
phase: 26
slug: multi-tier-affiliate-standard-gold-lifetime
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-17
---

# Phase 26 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Planner populates Per-Task Verification Map after PLAN.md files exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (unit + DB-invariant) + Playwright 1.x (e2e + screenshot diff) + deno test (Edge Functions) |
| **Config file** | `vitest.config.ts`, `vitest-e2e.config.ts`, `playwright.config.ts` (+ snapshot config — NET-NEW per RESEARCH), `supabase/functions/affiliate-lifetime-recurring/deno.json` |
| **Quick run command** | `npm run test -- --run --bail src/lib/affiliate scripts/affiliate-tier-test` |
| **Full suite command** | `npm run test && npm run lint && npm run typecheck && deno test supabase/functions/affiliate-lifetime-recurring supabase/functions/stripe-webhook && npx playwright test --grep affiliate` |
| **Estimated runtime** | ~120s quick · ~600s full |

Notes
- RLS integration test fixture: [[reference_rls_fixture_gotruechient_flake]] applied.
- Per-file slug prefix per [[feedback_rls_per_file_slug_prefix]].
- Deno test filename: `<name>.test.ts` per [[reference_deno_test_discovery]].
- Playwright state seeding via addInitScript per [[reference_playwright_state_seeding]].
- **NEW Wave-0:** `playwright.config.ts` snapshot config (zero baselines exist today per RESEARCH).

---

## Sampling Rate

- **After every task commit:** Run quick command (file-scoped, bail on first fail).
- **After every plan wave:** Run full command.
- **Before `/gsd:verify-work`:** Full suite + `supabase db query --linked` cron presence + manual Stripe Connect transfer probe.
- **Max feedback latency:** ~120 seconds per task.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 26-NN-NN | NN | W | AFFTIER-XX | T-26-XX | — | — | — | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> **Planner instruction:** populate this table once PLAN files exist. Every plan task must have ≥1 row (automated `<automated>` block OR ❌ W0 marker). Nyquist Dimension 8: no 3 consecutive tasks without automated verify.

---

## Wave 0 Requirements

- [ ] `playwright.config.ts` — snapshot config added (`toHaveScreenshot` threshold + per-template baseline dirs) — AFFTIER-06 (NET-NEW infrastructure per RESEARCH)
- [ ] `tests/integration/afftier-historical-immutability.test.ts` — vitest DB-invariant test proving retroactive tier upgrade DOES NOT mutate historical conversion rows — AFFTIER-02 Success Criterion #1 (load-bearing)
- [ ] `tests/integration/affiliate-tier-trigger.test.ts` — BEFORE INSERT trigger stamps tier_at_conversion_time + commission_cents correctly — AFFTIER-02
- [ ] `tests/integration/affiliate-fraud-signals.test.ts` — Z-score >3σ flag insertion + 7-day admin SLA timer — AFFTIER-05
- [ ] `supabase/functions/affiliate-lifetime-recurring/lifetime-recurring.test.ts` — Deno tests for cron Edge Fn idempotency (same billing_period_yyyymm produces ONE row) + Stripe-active gating + plan-change scaling — AFFTIER-04
- [ ] `supabase/functions/stripe-webhook/refund-chargeback.test.ts` — Deno tests for refund + chargeback claw-back into `payouts.adjustments` (NEW column per RESEARCH) — AFFTIER-04 + D-06
- [ ] `tests/e2e/affiliate-tier-grant.spec.ts` — Playwright: superadmin grants Lifetime; row updated; audit_logs entry written; reversible within 7d/first-payout window — AFFTIER-01 + D-14
- [ ] `tests/e2e/affiliate-gold-landing.spec.ts` — Playwright: `/r/{code}/landing` with Gold partner code resolves to premium template; `toHaveScreenshot` baseline matches — AFFTIER-06 Success Criterion #5
- [ ] `tests/integration/affiliate-anomaly-queue.test.ts` — flagged conversion appears in /admin/affiliates Anomaly Review tab; superadmin confirm_fraud writes claw-back to payouts.adjustments — AFFTIER-05

*Planner owns Wave-0 stub creation per the mapping above (recommend Plan 26-01 owns trigger + immutability tests; Plan 26-02 owns anomaly tests; Plan 26-04 owns Playwright + screenshot config; Plan 26-06 owns cron Deno tests; Plan 26-07 owns webhook tests).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Stripe webhook subscribed to `charge.refunded` + `charge.dispute.created` events | AFFTIER-04 + D-06 | Stripe Dashboard config | Founder enables both event types in Stripe Dashboard → Developers → Webhooks → endpoint settings; records test event delivery in `vendor_baa_chain` notes (per RESEARCH pitfall — currently unsubscribed) |
| First Lifetime grant + first recurring payout production proof | AFFTIER-04 + D-08 | Real Stripe Connect transfer | After first Gold partner promoted to Lifetime (admin grant) + their subscriber's first active month elapses: cron runs day-1 03:00 UTC; verify Stripe transfer ID landed in `affiliate_lifetime_recurring_payments.stripe_payout_id`; confirm partner sees commission in `payouts` table |
| Reversible-grant window proof (7d / first-payout) | D-14 | Time-based + integration with cron | Two manual probes: (a) superadmin grants Lifetime + reverses within 7d → assert reversal works + audit-logged; (b) superadmin grants Lifetime + cron writes first recurring payout → assert reverse-button disabled per D-14 ratchet |
| Gold landing template screenshot baseline approval | AFFTIER-06 | Visual baseline | Designer + founder review the committed `tests/e2e/screenshots/affiliate-gold-landing-baseline.png` for premium-theme correctness; PR-approve before merging baseline |
| Stripe Connect platform capabilities active | D-08 | Vendor portal | Already verified during v1.2 P14; spot-check via `curl /v1/account` per [[reference_stripe_platform_capabilities_endpoint]] before first Lifetime payout |
| Anomaly review 7-day SLA email reminder | D-09 | Cron-driven | Set test conversion with anomaly_flagged=true + created_at = now() - 5 days; trigger nightly SLA cron; verify admin gets reminder email |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (Playwright snapshot infra is BLOCKING for AFFTIER-06)
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s per task
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
