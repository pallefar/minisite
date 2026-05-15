---
phase: 19-affiliate-program-stripe-connect
verified: 2026-05-15T20:36:32Z
verifier: gsd-verifier
verdict: tech_debt
score: 12/12 REQ-IDs code-shipped; 5/5 SC code-shipped; 5 deferred vendor passes block go-live; 1 cosmetic carry-over
routing_recommendation: validate-phase  # per feedback_infra_phase_validate_not_verify + 19-VALIDATION.md I-2
head_commit: 318480f9a086da43a42783237df4a12dcfa0ff6e
supabase_project: ytnsipxxmzgaebkqmokp
migrations_live: 14
edge_functions_deployed: 10
plans_shipped: 10
must_haves:
  truths:
    - "Visitor clicks /r/{code} → server-side _aff cookie set → lands on co-branded page → signs up → subscribes → conversion row → partner dashboard reflects ≤ 10 min (SC#1)"
    - "Affiliate completes Stripe Connect Express onboarding → W-9/W-8BEN collected → day-60+ payout batch via Edge Fn + cron → 1099-NEC auto at year-end ≥ $500 (SC#2)"
    - "Suspicious conversion gets flagged=true and routes to admin review queue data path (SC#3 — P22 surfaces it)"
    - "Two overlapping Stripe subs reconcile to MAX(current_period_end) via tier_effective view; third RC row joins cleanly (SC#4 reformulated D-02)"
    - "Account-deletion cascade: 10 ordered steps via account-delete Edge Fn; payouts retained 7 yr; auth.admin.deleteUser last (SC#5)"
  artifacts:
    - path: supabase/migrations/20270101000004_tier_effective_view.sql
      provides: MONEY-07 tier_effective view + provider column forward-compat
    - path: supabase/functions/affiliate-attribute/index.ts
      provides: AFF-02 attribution Edge Fn + cookie + cold-start cap + Referer fraud filter
    - path: supabase/functions/stripe-connect-onboard/index.ts
      provides: AFF-03 JIT account_link
    - path: supabase/functions/partner-account-status/index.ts
      provides: AFF-03 4-state status mirror
    - path: supabase/functions/stripe-webhook/events/invoice-paid.ts
      provides: AFF-02 conversion attribution with D-36 renewal filter
    - path: supabase/functions/affiliate-apply/index.ts
      provides: AFF-05 apply form + Resend transactional (direct HTTPS, no SDK)
    - path: supabase/functions/affiliate-impression/index.ts
      provides: AFF-08 D-38 impression tracking (table now, ratio detector v1.3)
    - path: supabase/functions/affiliate-payout/index.ts
      provides: AFF-06 monthly batch payout
    - path: supabase/functions/account-delete/index.ts
      provides: AFF-10 + MONEY-10 10-step cascade
    - path: leanshot/src/components/partner/PartnerDashboard.tsx
      provides: AFF-04 partner dashboard
    - path: leanshot/src/components/landing/AffiliateLandingResolver.tsx
      provides: AFF-09 co-branded landing pages (coach/story/method)
    - path: leanshot/src/components/affiliate/AffiliateApplyForm.tsx
      provides: AFF-05 apply-form UI
    - path: leanshot/src/components/admin/AdminAffiliatesScaffold.tsx
      provides: AFF-05 admin scaffold (P22 ADMIN-06 builds full UX on top)
    - path: leanshot/src/App.tsx
      provides: BL-4 single-writer wiring of AFFILIATE_APPLY_ROUTES + PARTNER_ROUTES + LANDING_ROUTES
deferred_vendor_passes:  # NOT verification failures — documented per CONTEXT
  - id: vault-service-role-key
    description: Vault `service_role_key` loaded for affiliate-payout pg_cron auth
    blocks: monthly payout cron firing (1st of month 00:00 UTC); first payout window = Aug-Sep 2026
    where: VALIDATION.md task 19-09-T0
  - id: vercel-rewrite-smoke
    description: D-37 #1 — /r/:code rewrite preserves Set-Cookie Domain=.leanshot.app
    blocks: SC#1 end-to-end attribution (code shipped + rewrite line present in vercel.json:5; smoke not yet curl-verified)
    where: VALIDATION.md task 19-02-T1
  - id: stripe-transfers-capability
    description: D-37 #2 — confirm Stripe platform has transfers + tax-form capabilities enabled
    blocks: SC#2 first batch payout if Phase 12 stripe-done only enabled card_payments
    where: VALIDATION.md task 19-03-T1
  - id: resend-domain-verify
    description: noreply@app.leanshot.app Resend domain DNS verification
    blocks: AFF-05 approval email + AFF-06 payout-failure admin alert (deliverability)
    where: Phase 12 12-05 vendor checkpoint chain
  - id: cron-job-presence
    description: 3 pg_cron rows live (affiliate-payout / payouts-materialize / click-baseline-refresh)
    blocks: monthly-batch firing + matview freshness
    where: VALIDATION.md inferred from 19-09 SUMMARY (W-3 + BL-11) + migration 20270101000009
overrides: []
gaps: []
deferred:
  - truth: "Phase 16 iOS App Store referral-code first-launch entry (AFF-02 mobile fallback)"
    addressed_in: Phase 16 (resume when domain + Supabase Pro live)
    evidence: "CONTEXT.md D-22 + project_phase16_research_complete.md; v1.2 ships web-only fallback via aff_manual_entry flag"
  - truth: "Phase 22 ADMIN-06 admin review queue UX (full triage surface on top of P19 scaffold)"
    addressed_in: Phase 22
    evidence: "CONTEXT.md D-07 + ROADMAP Phase 22 ADMIN-06; P19 ships data path + read-only /admin/affiliates scaffold"
  - truth: "Phase 22 DEL-01 account-deletion user-facing surface"
    addressed_in: Phase 22
    evidence: "CONTEXT.md D-33 + ROADMAP Phase 22 DEL-01; P19 ships the Edge Fn the surface calls"
  - truth: "AFF-08 impression-to-click ratio Z-score detector (v1.3)"
    addressed_in: v1.3 milestone
    evidence: "Addendum D-38 — hybrid split: v1.2 ships table + impression-insert; v1.3 adds ratio detector"
  - truth: "payouts.status='reversed' + transfer.reversed webhook (v1.3)"
    addressed_in: v1.3 milestone
    evidence: "Addendum D-39 — v1.2 enum drops 'reversed'"
  - truth: "Multi-tier commissions / per-affiliate personalized banner gen / affiliate API / full Phase 15 builder access for affiliates"
    addressed_in: v1.3 milestone
    evidence: "CONTEXT.md deferred list"
carry_overs:
  - id: latent-s-user-nonnull-assertions
    description: 10 `s.user!` non-null assertions remain in leanshot/src/ (existing milestone-v1.1 debt; not P19-introduced)
    target: v1.2 closeout audit batch alongside MedLevelChart.tsx:13
    severity: latent
  - id: cron-row-presence-verification
    description: Post-deploy verification that 3 pg_cron rows are live; migration 20270101000009 + 20270101000012 add them but presence not asserted by an automated test
    target: validate-phase smoke (`select count(*) from cron.job where jobname in (...)`)
    severity: vendor-pass
---

# Phase 19: Affiliate Program + Stripe Connect — Verification Report

**Phase Goal:** Ship the full affiliate program (apply form → Stripe Connect Express onboarding → co-branded landing pages → partner dashboard → fraud detection → payouts → cascade-delete) plus the unified `tier_effective` view reconciling Stripe + RevenueCat subscriptions.

**Verified:** 2026-05-15T20:36:32Z
**HEAD:** `318480f` (main)
**Verdict:** `tech_debt` — all 12 REQ-IDs + 5 SCs are code-shipped and code-evidence-verified, but five **deferred vendor passes** (Vault key, Vercel rewrite smoke, Stripe transfers capability, Resend domain verify, cron presence) gate the SCs at go-live. None is a code defect; all are infra/operational steps the team chose to defer until closer to launch (consistent with project memory `project_phase16_deferred_to_v1.2_milestone_tail`).

**Routing recommendation:** Phase 19 is a **mixed user-story + infra phase** (apply form + dashboard + landing pages are observable user-facing surfaces; cascade + payout + RLS + cron are infra). 19-VALIDATION.md I-2 explicitly routes Phase 19 to `/gsd-validate-phase` per project memory `feedback_infra_phase_validate_not_verify` because (a) the inherited `Mode: mvp` user-story guard halts on the infra facets, and (b) the deferred vendor passes block end-to-end user-story verification. **This `verify-work` pass scores code-shipping completeness only; the operational SCs are documented as deferred vendor passes.**

---

## REQ-ID Coverage

| REQ-ID    | Description (REQUIREMENTS.md)                                                                  | Status   | Evidence                                                                                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AFF-01    | `affiliates` table + status lifecycle + RLS                                                    | PASSED   | `supabase/migrations/20270101000001_affiliates_schema.sql` + `20270101000006_affiliate_rls.sql` (live); 19-01-SUMMARY.md confirms RLS cross-tenant tests                                                                       |
| AFF-02    | Server-side `_aff` HttpOnly cookie via /r/{code} + manual-entry fallback                       | PASSED   | `affiliate-attribute/index.ts` + `cookie.ts` + `referer.ts` (cold-start cap + Referer filter); `vercel.json:5` rewrite; `SignUpForm.tsx:40` `aff_manual_entry` field; `feature-flags.ts` cache wired                            |
| AFF-03    | Stripe Connect Express onboarding + JIT account_link + 4-state machine                         | PASSED   | `stripe-connect-onboard/index.ts` + `partner-account-status/index.ts` + tests; `StripeConnectOnboardingCard.tsx` 4-state component (overwrites 19-06a placeholder per 19-06b)                                                  |
| AFF-04    | Partner dashboard (clicks/conversions/commissions/payouts/assets)                              | PASSED   | `src/components/partner/` (11 components: Layout, Dashboard, KPI, Trend, Feed, Links, Payouts, Assets, Customize, Onboarding, TemplatePicker); 10-min SWR poll per D-10                                                       |
| AFF-05    | Apply form + admin scaffold + manual approval + Resend confirmation                            | PASSED   | `affiliate-apply/index.ts` (direct HTTPS Resend, 0 SDK refs per W-5); `AffiliateApplyForm.tsx` + `AffiliateApplyPage.tsx`; `AdminAffiliatesScaffold.tsx` read-only `/admin/affiliates`; P22 ADMIN-06 deferred per D-07         |
| AFF-06    | Monthly batch payout + 60-day chargeback hold + $500 W-9 threshold                             | PASSED   | `affiliate-payout/index.ts` + `retry.ts`; migration `20270101000012_payouts_materialization_and_cron.sql` (3 cron jobs); `20270101000014_service_role_key_vault_load.sql` (Vault auth scaffold; **vendor pass deferred**)         |
| AFF-07    | Conversion fraud: IP/24 + fingerprint + email-domain trigger with public-email allowlist       | PASSED   | `20270101000008_fraud_trigger_conversion.sql` (`flag_conversion_fraud` + `trg_flag_conversion_fraud` BEFORE INSERT); `src/lib/affiliate/fingerprint.ts` (lazy ThumbmarkJS)                                                     |
| AFF-08    | Click-rate fraud + Referer-based filter (v1.2 hybrid: impression table now, ratio v1.3)        | PASSED   | `affiliate-impression/index.ts` (DNT honor, /24 truncation, UA SHA-256 hash); `20270101000007_affiliate_click_baseline_mv.sql` (Z-score matview); `affiliate-attribute/referer.ts`. Ratio detector deferred per D-38           |
| AFF-09    | Co-branded landing pages (3 templates: coach/story/method)                                     | PASSED   | `src/components/landing/{LandingTemplateCoach,Story,Method,AffiliateLandingResolver}.tsx`; `20270101000010_affiliate_landing_template_seeds.sql` (3 template instances); `affiliates_public_view` (8 non-PII columns, BL-3)    |
| AFF-10    | Account-deletion cascade: anonymize ledger, retain payouts                                     | PASSED   | `account-delete/index.ts` (10-step orchestrator, steps 1/2/5/6/7/8/9/10 enumerated; 3+4 passive via FK ON DELETE SET NULL + retention); `20270101000013_account_delete_affiliate_cascade.sql` (`finalize_affiliate_cascade`)   |
| MONEY-07  | `tier_effective` view reconciling Stripe + RevenueCat by MAX(current_period_end)               | PASSED   | `20270101000004_tier_effective_view.sql` (security_invoker=true; D-03 safe); `20270101000003_subscriptions_provider_guard.sql` (provider text column idempotent ADD COLUMN IF NOT EXISTS — P16-06 forward-compat per D-04)      |
| MONEY-10  | Stripe customer/Connect/PaymentIntent cleanup + Resend audience remove + Storage delete        | PASSED   | `account-delete/index.ts` steps 5-9 (Stripe customer + Connect + PaymentIntent cancel + Resend contact remove + Storage prefix delete) + 19-09-SUMMARY.md key-files listing                                                    |

**Result: 12/12 REQ-IDs code-shipped.**

---

## Success Criteria

| #   | Criterion                                                                                            | Status                       | Evidence / Gap                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | /r/{code} → cookie → landing → signup → conversion → dashboard within 10 min                         | PASSED (code) / DEFERRED (E2E) | All artifacts shipped (attribute Edge Fn, vercel rewrite line, landing renderers, signup form, webhook conversion writer, partner dashboard 10-min SWR). **Vercel rewrite curl smoke (D-37 #1) deferred** — see `wave-0-vercel-rewrite-smoke.sh`        |
| 2   | Stripe Connect Express → W-9/W-8BEN → 60-90 day payout batch → 1099-NEC ≥ $500                       | PASSED (code) / DEFERRED (live) | `stripe-connect-onboard` + `partner-account-status` + `affiliate-payout` Edge Fns shipped; `tax_threshold_cents=50000` in schema. **Vault `service_role_key` load + Stripe transfers capability check (D-37 #2) deferred**                              |
| 3   | Suspicious conversion → admin review queue (P22 ADMIN-06; P19 ships data path)                       | PASSED (data path)            | `flag_conversion_fraud` trigger writes `status='flagged'`; `AdminAffiliatesScaffold.tsx` read-only scaffold ships in P19; full triage UX explicitly P22 ADMIN-06 per D-07                                                                                  |
| 4   | Two overlapping Stripe subs → tier reflects MAX(current_period_end); RC row joins cleanly            | PASSED                       | `tier_effective` view uses MAX + GROUP BY user_id + security_invoker; provider column on subscriptions with check constraint allows `('stripe','revenuecat')`. RC join is structural no-op when P16-06 inserts rows (D-04 forward-compat)                  |
| 5   | 10-step account-delete cascade; payouts retained 7 yr; auth.admin.deleteUser last                    | PASSED                       | `account-delete/index.ts` steps 1, 2, 5, 6, 7, 8, 9, 10 explicit in code (3+4 passive via FK ON DELETE SET NULL + payouts not touched); `e2e/account-deletion-cascade.spec.ts` (218 lines, 2 tests)                                                          |

**Result: 5/5 SCs code-shipped; SC#1 + SC#2 gated on deferred vendor passes (not code defects).**

---

## Deferred Vendor Passes

These are intentionally deferred per CONTEXT addendum D-37 and project memory `project_phase16_deferred_to_v1.2_milestone_tail`. **None is a phase verification failure** — but each one MUST run before go-live for SC#1/SC#2 to be observably true end-to-end.

| #   | Vendor Pass                                                                              | Blocks                                                   | Recovery                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Vault `service_role_key` loaded for affiliate-payout pg_cron auth                        | Monthly payout cron firing (first window Aug-Sep 2026)   | `psql "$DATABASE_URL" -c "select count(*) from vault.secrets where name = 'service_role_key';"` must return 1; load via Supabase Dashboard → Vault                                     |
| 2   | D-37 #1 — `/r/:code` Vercel rewrite preserves `Set-Cookie: _aff=…; Domain=.leanshot.app` | SC#1 end-to-end (cookie not set → no attribution)        | `bash leanshot/scripts/wave-0-vercel-rewrite-smoke.sh`; fallback = subdomain `r.leanshot.app` direct-pointed at Supabase fn URL (per D-37 #1)                                            |
| 3   | D-37 #2 — Stripe platform transfers + tax-form capabilities enabled                       | SC#2 batch payout (transfers.create fails if disabled)   | `bash leanshot/scripts/wave-0-stripe-transfers-capability.sh`; enable via Stripe dashboard or `stripe.accounts.update({ requested_capabilities: ['transfers'] })`                        |
| 4   | Resend `noreply@app.leanshot.app` domain DNS verification                                | Approval email (AFF-05) + payout-failure admin alert     | `curl api.resend.com/domains -H "Authorization: Bearer $KEY"` per `reference_resend_phase9_wiring.md`; sandbox `onboarding@resend.dev` works for self-test only                          |
| 5   | 3 `cron.job` rows live (affiliate-payout, payouts-materialize, click-baseline-refresh)   | Recurring schedule (monthly + daily)                     | `psql "$DATABASE_URL" -c "select jobname from cron.job where jobname like 'affiliate-%' or jobname like 'payouts-%' or jobname = 'affiliate-click-baseline-refresh';"` must return 3   |

---

## Deviations During Execute (Historical — no verification impact)

| Deviation                                                                                                                                  | Recovery                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Worktree-base drift on 19-07                                                                                                              | Cherry-pick onto main                                                                 |
| Absolute-path writes to main during 19-03 + 19-08 (parallel executor autonomy drift per `feedback_parallel_executor_autonomy_drift`)        | `cp` recovery + revert; no cross-plan file collisions                                 |
| Migration filename renumber: `000004a → 000005` + 9 downstream bumps (Supabase CLI strict 14-digit regex silently skips letter suffix)    | commit `c65fdd9 fix(19): renumber migrations`                                         |
| `block_tree → blocks` rename in 19-08 landing-seed migration (Phase 15 post-ship schema fix per `project_phase15_shipped`)                  | commit `e7b5250 fix(19-08)`                                                           |
| `comment on schema vault;` dropped from migration 14 (service_role doesn't own vault schema on managed Supabase)                          | commit `aa4f260 fix(19-09)`                                                           |

---

## Anti-Pattern Scan

| Scan                                                          | Result                                                                                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Debt markers (TBD/FIXME/XXX) in P19 source                    | **0 unresolved** in `supabase/functions/{affiliate-*,account-delete,partner-*,stripe-connect-onboard}` + `leanshot/src/{components/{affiliate,partner,landing},lib/affiliate}` |
| Resend SDK leakage in `affiliate-apply` (W-5)                 | **0 matches** for `esm.sh/resend` or `npm:resend` across the 4 files — direct HTTPS only ✓                                                                          |
| `s.user!` non-null assertion audit (informational)            | 10 occurrences across `leanshot/src/` — **pre-existing milestone-v1.1 debt** carried as v1.2 closeout item; not P19-introduced                                       |
| Route registry single-writer (BL-4)                           | `App.tsx:25-27` imports all 3 registries; `App.tsx:169-229` iterates all 3 into Suspense boundaries — confirmed single writer                                       |

---

## Carry-Overs

1. **Cron-row presence assertion** (vendor pass #5) — add to validate-phase smoke checklist; one-line psql query.
2. **10 `s.user!` non-null assertions** in `leanshot/src/` — batched audit at v1.2 closeout alongside `MedLevelChart.tsx:13`. Latent type-safety risk, not behavioral.
3. **5 deferred vendor passes** (Vault key, Vercel smoke, Stripe transfers, Resend DNS, cron presence) — all gate go-live; route via `/gsd-validate-phase 19 leanshot` once domain + Supabase Pro are live (per `project_phase16_deferred_to_v1.2_milestone_tail`).
4. **P22 ADMIN-06 + DEL-01 surfaces** — Phase 22 builds the operator UX on top of P19's data path + scaffold.
5. **AFF-08 ratio-detector + payouts `reversed` enum** — v1.3 milestone per D-38 + D-39.

---

## Routing Recommendation

**`/gsd-validate-phase 19 leanshot`** — NOT `/gsd-verify-work`.

Justification:
- 19-VALIDATION.md I-2 explicitly cites `feedback_infra_phase_validate_not_verify` and routes Phase 19 to validate-phase.
- Phase 19 is a mixed user-story + infra phase; the inherited `Mode: mvp` user-story guard halts on infra facets (Vault, cron, RLS, cascade) that have no observable user-story.
- The 5 deferred vendor passes are all infra/operational; validate-phase's CLI-driven approach (per `feedback_verify_human_uat_via_cli.md`) is the right tool — supabase CLI + `curl` smoke + psql cron-row query cover 4 of 5; only Resend DNS needs the user.

This `verify-work` pass scores **code-shipping completeness** (all 12 REQ-IDs + 5 SCs code-evidence-verified). The operational SCs (#1 and #2 end-to-end) await validate-phase + the 5 vendor passes.

---

## Verdict

**`tech_debt`** — code-complete; vendor passes pending.

- All 10 plans shipped with SUMMARY.md ✓
- All 14 migrations live on `ytnsipxxmzgaebkqmokp` ✓
- All 10 Edge Functions present in `supabase/functions/` ✓
- All 3 route registries wired into `App.tsx` (BL-4) ✓
- D-36 renewal filter wired in `invoice-paid.ts:104` ✓
- D-02 SC#4 reformulated and verified via `tier_effective` view structure ✓
- D-33 10-step cascade enumerated in `account-delete/index.ts` ✓
- Zero unresolved debt markers in P19 source ✓
- Zero Resend SDK leakage (W-5) ✓
- 5 deferred vendor passes documented + scripts present + recovery commands listed ✓

**Phase 19 is ready for `/gsd-validate-phase 19 leanshot` to clear vendor passes once domain + Supabase Pro are live.** No code fixes required.

---

*Verified: 2026-05-15T20:36:32Z*
*Verifier: Claude (gsd-verifier; Opus 4.7 1M context)*
*Head: 318480f9a086da43a42783237df4a12dcfa0ff6e*
