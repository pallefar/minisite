---
phase: 40
slug: cancellation-save-offers-flow
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-21
updated: 2026-05-21
---

# Phase 40 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Deno test 1.x (Edge Fns); pgTAP / supabase test db (RLS proofs + status enum); Playwright (e2e at verify-work time) |
| **Config file** | `supabase/functions/_shared/deno.json` (existing); no `vitest.config.*` in leanshot/ (intentional per project posture — see RESEARCH §Validation) |
| **Quick run command** | `$HOME/.deno/bin/deno test --no-check supabase/functions/cancellation-decide-offer/` |
| **Full suite command** | `$HOME/.deno/bin/deno test --no-check supabase/functions/ && supabase test db --linked && bash scripts/assert-bundle-budget.sh` |
| **Estimated runtime** | ~30s (quick), ~300s (full) |

---

## Sampling Rate

- **After every task commit:** Run owning-Fn Deno test in isolation
- **After every plan wave:** Full Deno sweep + RLS proofs + bundle-budget guard (per `feedback_post_merge_deno_sweep_pattern`)
- **Before `/gsd:verify-work`:** Full suite green + Stripe webhook end-to-end smoke via `stripe trigger customer.subscription.updated`
- **Max feedback latency:** ~30s (quick), ~300s (full)

---

## Per-Task Verification Map

> Plan-phase finalized: Task IDs map to concrete plans + waves below.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 40-03-T1a | 40-03 | 2 | POLISH-01 | — | `<30d` user gets pause+discount only; `30-180d` all 4; `>180d` no extended-trial | Edge Fn unit | `$HOME/.deno/bin/deno test --no-check supabase/functions/cancellation-decide-offer/resolve-rule.test.ts` | ❌ created in 40-03 T1 | ⬜ pending |
| 40-03-T1b | 40-03 | 2 | POLISH-01 D-02 | T-40-03-03 | 3rd non-pause take returns `OFFER_INELIGIBLE_LIFETIME_CAP`; pause exempt | Edge Fn unit | `$HOME/.deno/bin/deno test --no-check supabase/functions/cancellation-decide-offer/anti-gaming.test.ts` | ❌ created in 40-03 T1 | ⬜ pending |
| 40-03-T1c | 40-03 | 2 | POLISH-01 D-03 | T-40-03-03 | Take within 365d returns `OFFER_INELIGIBLE_COOLDOWN` | Edge Fn unit | `$HOME/.deno/bin/deno test --no-check supabase/functions/cancellation-decide-offer/anti-gaming.test.ts` | ❌ created in 40-03 T1 | ⬜ pending |
| 40-03-T1d | 40-03 | 2 | POLISH-01 D-04 | — | Clinic-org user sees only `contact_csm` + `discount`; no pause/extended/downgrade | Edge Fn unit | `$HOME/.deno/bin/deno test --no-check supabase/functions/cancellation-decide-offer/clinic-fork.test.ts` | ❌ created in 40-03 T1 | ⬜ pending |
| 40-03-T1e | 40-03 | 2 | POLISH-01 D-18 | — | Reason captured even when offer declined OR no offer available | DB integration | `$HOME/.deno/bin/deno test --no-check supabase/functions/cancellation-decide-offer/log-insert.test.ts` | ❌ created in 40-03 T1 | ⬜ pending |
| 40-04-T3 | 40-04 | 2 | POLISH-01 D-21 | — | Service-quality-issue + cancel-complete → P37 helpdesk ticket created (user JWT forwarded, NOT service-role per Pitfall 4) | Edge Fn unit (mock) | `$HOME/.deno/bin/deno test --no-check supabase/functions/cancellation-feedback-to-ticket/` | ❌ created in 40-04 T3 | ⬜ pending |
| 40-01-T1a | 40-01 | 1 | POLISH-02 | T-40-01-02 | `cancellation_offers_log` append-only RLS; cross-tenant impersonation denied | RLS proof (pgTAP) | `supabase db query --linked --file supabase/tests/p40_offers_log_rls_proof.sql` | ❌ created in 40-01 T1 | ⬜ pending |
| 40-01-T2 | 40-01 | 1 | POLISH-02 | T-40-01-03 | `save_offer_rules` admin-only write; non-admin gets 403 | RLS proof (pgTAP) | `supabase db query --linked --file supabase/tests/p40_save_offer_rules_rls_proof.sql` | ❌ created in 40-01 T2 | ⬜ pending |
| 40-06-T1 | 40-06 | 3 | POLISH-02 | T-40-06-01 | ROI view returns correct counts for shown/accepted/declined per offer_type; clinic-org excluded | SQL test | `supabase db query --linked --file supabase/tests/p40_roi_view_test.sql` | ❌ created in 40-06 T1 | ⬜ pending |
| 40-01-T1b | 40-01 | 1 | POLISH-01 / POLISH-04 | T-40-01-01 | `cancellation_offers_log.status` + `save_offer_rules.offer_type` + reason CHECK enums list ALL values at table creation (no later widening) | pgTAP | `supabase db query --linked --file supabase/tests/p40_enum_check.sql` | ❌ created in 40-01 T1 | ⬜ pending |
| 40-03-T2a | 40-03 | 2 | POLISH-03 D-06 | T-40-03-09 | `pause_collection.resumes_at` set correctly for 1/2/3-mo presets (Stripe mocked); A5 trial-reject path graceful | Edge Fn unit | `$HOME/.deno/bin/deno test --no-check supabase/functions/cancellation-accept-offer/apply-pause.test.ts` | ❌ created in 40-03 T2 | ⬜ pending |
| 40-02-T2a | 40-02 | 1 | POLISH-03 webhook mirror | T-40-02-01 | `customer.subscription.updated` with `pause_collection` → mirrors `subscriptions.paused_until` + `is_paused` (NO new case arms in index.ts per RESEARCH §Pitfall 1) | Edge Fn unit (extend) | `$HOME/.deno/bin/deno test --no-check supabase/functions/stripe-webhook/events/subscription-updated.test.ts` | ✅ existing extension in 40-02 T2 | ⬜ pending |
| 40-02-T2b | 40-02 | 1 | POLISH-03 auto-resume | T-40-02-04 | `customer.subscription.updated` with `pause_collection: null` → mirrors `is_paused=false` + fires T-0 email | Edge Fn unit (extend) | `$HOME/.deno/bin/deno test --no-check supabase/functions/stripe-webhook/events/subscription-updated.test.ts` | ✅ existing extension in 40-02 T2 | ⬜ pending |
| 40-02-T3 | 40-02 | 1 | POLISH-03 T-7d email | T-40-02-03 | pg_cron fires `pause-reminder-fire` Fn; email sent via `_shared/email-router.ts` with PHI flag derived from clinic_id | Cron + Fn integration | `$HOME/.deno/bin/deno test --no-check supabase/functions/pause-reminder-fire/index.test.ts` | ❌ created in 40-02 T3 | ⬜ pending |
| 40-02-T2c | 40-02 | 1 | POLISH-03 T-0 email | — | Subscription auto-resume → confirmation email sent (assert sendEmail called with template='pause_resumed_t0') | Integration | `$HOME/.deno/bin/deno test --no-check supabase/functions/stripe-webhook/events/subscription-updated.test.ts` | ✅ existing extension | ⬜ pending |
| 40-03-T2b | 40-03 | 2 | POLISH-03 D-10 | T-40-03-03 | Extending pause increments take counter; initial pause does not | Edge Fn unit | `$HOME/.deno/bin/deno test --no-check supabase/functions/cancellation-accept-offer/extend-pause-counter.test.ts` | ❌ created in 40-03 T2 | ⬜ pending |
| 40-03-T2c | 40-03 | 2 | POLISH-04 coupon stacking | T-40-03-08 | Existing affiliate coupon preserved in `discounts[]`; new save coupon appended (NEVER singular `discount:` field — Pitfall 2) | Stripe integration (mocked) | `$HOME/.deno/bin/deno test --no-check supabase/functions/cancellation-accept-offer/apply-discount.test.ts` | ❌ created in 40-03 T2 | ⬜ pending |
| 40-03-T1f | 40-03 | 2 | POLISH-04 D-15 clamp | T-40-03-04 | 10% affiliate + 30% save → server clamps so combined effective = 35%; pure-fn unit test with 5 scenarios | Edge Fn unit | `$HOME/.deno/bin/deno test --no-check supabase/functions/cancellation-decide-offer/anti-gaming.test.ts` | ❌ created in 40-03 T1 | ⬜ pending |
| 40-04-T2 | 40-04 | 2 | POLISH-01 bundle | T-40-04-07 | `cancellation` chunk ≤ 13 kB gz at build; admin chunk delta within ceiling | bundle | `cd leanshot && bash scripts/assert-bundle-budget.sh cancellation` | ❌ baseline set in 40-04 T2 | ⬜ pending |
| 40-05-T1 | 40-05 | 3 | POLISH-01 admin | T-40-05-01 | SECDEF RPCs gate at is_admin_at_least; staff cannot create; admin can create+update+reorder; only superadmin can archive; catalog regex validates coupon_id | pgTAP | `supabase db query --linked --file supabase/tests/p40_save_offer_rpc_roles.sql` | ❌ created in 40-05 T1 | ⬜ pending |
| 40-01-T3 | 40-01 | 1 | POLISH-04 coupon seed | T-40-01-04 | Stripe coupon seed idempotent: first run creates 6; re-run skips 6 via `resource_already_exists` catch | Edge Fn unit | `$HOME/.deno/bin/deno test --no-check --allow-env --allow-net supabase/functions/cancellation-seed-coupons/index.test.ts` | ❌ created in 40-01 T3 | ⬜ pending |
| 40-06-T2 | 40-06 | 3 | POLISH-02 CSV | T-40-06-02 | CSV export streams admin-only; non-admin gets 403; Content-Disposition attachment + filename includes yyyymmdd | Edge Fn unit | `$HOME/.deno/bin/deno test --no-check supabase/functions/download-cancellation-roi-csv/` | ❌ created in 40-06 T2 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/functions/cancellation-decide-offer/{index.ts, index.test.ts, resolve-rule.ts, resolve-rule.test.ts, anti-gaming.ts, anti-gaming.test.ts, clinic-fork.test.ts, log-insert.test.ts}` — Fn skeleton + 5 test files (created by 40-03 T1)
- [ ] `supabase/functions/cancellation-accept-offer/{index.ts, index.test.ts, apply-pause.ts, apply-pause.test.ts, apply-discount.ts, apply-discount.test.ts, extend-pause.ts, extend-pause-counter.test.ts, apply-extended-trial.ts, apply-downgrade.ts}` — Fn skeleton + 5 test files (created by 40-03 T2)
- [ ] `supabase/functions/cancellation-feedback-to-ticket/{index.ts, index.test.ts}` — Fn + 1 test (created by 40-04 T3)
- [ ] `supabase/functions/cancellation-seed-coupons/{index.ts, index.test.ts}` — Fn + 1 test (created by 40-01 T3)
- [ ] `supabase/functions/pause-reminder-fire/{index.ts, index.test.ts}` — Fn + 1 test (created by 40-02 T3)
- [ ] `supabase/functions/stripe-webhook/events/subscription-updated.test.ts` EXTEND — pause_collection mirror + auto-resume detection (extended by 40-02 T2)
- [ ] `supabase/functions/download-cancellation-roi-csv/{index.ts, index.test.ts}` — Fn + 1 test (created by 40-06 T2)
- [ ] `supabase/tests/p40_offers_log_rls_proof.sql` — cross-tenant impersonation deny (created by 40-01 T1)
- [ ] `supabase/tests/p40_save_offer_rules_rls_proof.sql` — admin-only write (created by 40-01 T2)
- [ ] `supabase/tests/p40_save_offer_rpc_roles.sql` — RPC role gating (created by 40-05 T1)
- [ ] `supabase/tests/p40_roi_view_test.sql` — view aggregation correctness (created by 40-06 T1)
- [ ] `supabase/tests/p40_enum_check.sql` — enum CHECK values at creation (created by 40-01 T1)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Stripe coupon D-16 next-invoice timing | POLISH-04 | Requires Stripe test-mode subscription with cycle anchor; automated mocks can't verify Stripe's billing semantics | (1) Create test subscription; (2) accept save-offer; (3) advance time via Stripe CLI; (4) verify discount applies to next invoice only |
| Stripe webhook end-to-end (signed payload) | POLISH-03 webhook | HMAC signature verification requires real Stripe-signed payload | `stripe trigger customer.subscription.updated` against deployed dispatcher; assert local mirror updates |
| CancellationModal a11y + reduced-motion | POLISH-01 | No vitest-config in leanshot/; React testing is project-deferred | Playwright MCP smoke + manual keyboard-nav walkthrough — surfaced in 40-06 Task 3 HUMAN-UAT signal A |
| Admin ROI dashboard render + CSV export | POLISH-02 | Requires admin role + browser context | 40-06 Task 3 HUMAN-UAT signal D |
| Admin rule editor CRUD walkthrough | POLISH-01 admin | Requires admin role + interaction | 40-06 Task 3 HUMAN-UAT signal E |
| D-21 helpdesk ticket creation end-to-end | POLISH-01 D-21 | Requires real cancellation flow + helpdesk module + email send | 40-06 Task 3 HUMAN-UAT signal F |
| D-15 stacking notice visible with real affiliate coupon | POLISH-04 D-15 | Requires affiliate coupon fixture | 40-06 Task 3 HUMAN-UAT signal C |
| Stripe Dashboard webhook subscription review (belt-and-suspenders) | POLISH-03 | Stripe Dashboard UI only | 40-06 Task 3 HUMAN-UAT signal G (per RESEARCH §"Runtime State Inventory" — recommended SKIP since `.paused`/`.resumed` never fire for pause_collection) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every plan has ≥1 Deno or pgTAP automation hook)
- [x] Wave 0 covers all MISSING references (12 files created during plan execution, mapped to specific tasks)
- [x] No watch-mode flags
- [x] Feedback latency < 30s (quick) / < 300s (full)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
