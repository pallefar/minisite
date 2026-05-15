---
phase: 19
slug: affiliate-program-stripe-connect
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-15
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> See `19-RESEARCH.md § Validation Architecture` for full per-task derivation.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (web)** | vitest 4.1.x (jsdom) — existing |
| **Framework (Edge Function)** | deno test (`<name>.test.ts` — per `reference_deno_test_discovery.md`) |
| **Framework (e2e)** | Playwright @1.49 — existing |
| **Config file** | `vitest.config.ts`, `playwright.config.ts`, `supabase/functions/<name>/deno.json` |
| **Quick run command** | `npm run test -- --run` |
| **Full suite command** | `npm run test && npm run test:e2e && deno test supabase/functions/affiliate-*` |
| **Estimated runtime** | ~120 s (vitest) + ~90 s (e2e) + ~30 s (deno) ≈ 4 min |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -- --run --reporter=verbose <affected-spec>`
- **After every plan wave:** Run full vitest + deno; e2e if any plan touched routes
- **Before `/gsd:verify-work`:** Full suite + Playwright cascade-deletion spec must be green
- **Max feedback latency:** 30 s per affected spec

---

## Per-Task Verification Map

> Populated by planner during plan-phase. Placeholder rows below — planner expands per PLAN.md task.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 schema | 1 | AFF-01..AFF-10, MONEY-07 | T-19-01 | RLS prevents cross-affiliate read | sql + vitest | `supabase migration up && npm run test affiliates-rls` | ❌ W0 | ⬜ pending |
| 19-02-01 | 02 affiliate-attribute | 1 | AFF-02 | T-19-02 | HttpOnly cookie set; no XSS path | deno test | `deno test supabase/functions/affiliate-attribute/index.test.ts` | ❌ W0 | ⬜ pending |
| 19-03-01 | 03 stripe-connect-onboard | 1 | AFF-03 | T-19-03 | account_link single-use | deno test | `deno test supabase/functions/stripe-connect-onboard/index.test.ts` | ❌ W0 | ⬜ pending |
| 19-04-01 | 04 tier_effective view | 1 | MONEY-07 | T-19-04 | security_invoker honors RLS | sql + vitest | `npm run test tier-effective` | ❌ W0 | ⬜ pending |
| 19-05-01 | 05 stripe-webhook affiliate | 2 | AFF-04 (conv), D-36 | T-19-05 | renewal filter (no double-pay) | deno test | `deno test supabase/functions/stripe-webhook/affiliate.test.ts` | ❌ W0 | ⬜ pending |
| 19-06-01 | 06 partner dashboard | 2 | AFF-04 | T-19-06 | role='affiliate' route gate | vitest + Playwright | `npm run test PartnerDashboard && npm run test:e2e partner-dashboard.spec.ts` | ❌ W0 | ⬜ pending |
| 19-07-01 | 07 apply + admin scaffold | 2 | AFF-05 | T-19-07 | rate-limit on /affiliate POST | vitest | `npm run test affiliate-apply` | ❌ W0 | ⬜ pending |
| 19-08-01 | 08 fraud signals | 3 | AFF-07, AFF-08 | T-19-08 | IP /24 + fingerprint matching | sql + vitest | `npm run test fraud-flagging` | ❌ W0 | ⬜ pending |
| 19-09-01 | 09 monthly payout cron | 3 | AFF-06 | T-19-09 | 60-day eligibility filter | deno test + sql | `deno test supabase/functions/affiliate-payout/index.test.ts` | ❌ W0 | ⬜ pending |
| 19-10-01 | 10 account-delete cascade | 3 | MONEY-10 | T-19-10 | payouts retained; affiliate_ledger anonymized | Playwright | `npm run test:e2e account-deletion-cascade.spec.ts` | ❌ W0 | ⬜ pending |
| 19-11-01 | 11 landing-page templates | 3 | AFF-09 | T-19-11 | initials fallback (no XSS in name) | vitest | `npm run test landing-template-coach` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] **Vercel rewrite smoke** (per D-37 #1): deploy stub Edge Function + `vercel.json` rewrite + curl `https://<preview>.vercel.app/r/test` → assert `Set-Cookie: _aff=test; Domain=.leanshot.app` present
- [ ] **Phase 12 stripe-done capability check** (per D-37 #2): `stripe accounts retrieve <platform_id> --expand capabilities` → assert `capabilities.transfers='active'`; if not, enable in dashboard
- [ ] `supabase/functions/affiliate-attribute/index.test.ts` — cookie-setting stub
- [ ] `supabase/functions/stripe-connect-onboard/index.test.ts` — account_link stub
- [ ] `supabase/functions/affiliate-payout/index.test.ts` — payout-cron stub
- [ ] `supabase/functions/stripe-webhook/affiliate.test.ts` — invoice.paid + billing_reason filter
- [ ] `tests/e2e/partner-dashboard.spec.ts`, `tests/e2e/account-deletion-cascade.spec.ts` — Playwright stubs
- [ ] `src/lib/affiliate/__tests__/` — apply form, fraud signals, tier_effective consumer

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Stripe Connect Express hosted-onboarding UI (W-9 / W-8BEN forms) | AFF-03 | Stripe-hosted UI; cannot Playwright into Stripe domain | Test affiliate in Stripe Test Mode walks through onboarding → screenshots saved to `19-UAT.md` |
| Resend email rendering (approval/rejection/payout-paid templates) | AFF-05 | Email-client rendering varies; visual diff in actual Gmail/Outlook | Send approval email to test inbox → screenshot 3 clients → attach to `19-UAT.md` |
| 1099-NEC auto-generation at year-end | AFF-06 | Stripe runs the cron; we can only verify config | Confirm Stripe Connect dashboard shows tax-reporting enabled for platform |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30 s per spec
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
