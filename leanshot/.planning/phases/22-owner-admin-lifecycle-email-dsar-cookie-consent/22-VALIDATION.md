---
phase: 22
slug: owner-admin-lifecycle-email-dsar-cookie-consent
status: verified
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-16
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. The planner fills in per-task rows after PLAN.md generation; this file is created with frontmatter + scaffolding from the template so plan-checker's Dimension 8 can grade.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (existing) + Deno test (Edge Functions) + Playwright (e2e) |
| **Config file** | `vitest.config.ts`, `supabase/functions/*/test.ts`, `playwright.config.ts` |
| **Quick run command** | `npm test -- --run` |
| **Full suite command** | `npm test && (cd supabase/functions && deno test --allow-all) && npx playwright test` |
| **Estimated runtime** | ~120 seconds (unit) + ~60 seconds (Deno) + ~180 seconds (Playwright) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run <changed-spec-or-related>`
- **After every plan wave:** Run `npm test && (cd supabase/functions && deno test --allow-all)`
- **Before `/gsd:verify-work`:** Full suite (unit + Deno + Playwright) must be green
- **Max feedback latency:** 120 seconds for unit, 360 seconds full

---

## Per-Task Verification Map

> Populated by planner after PLAN.md generation (one row per task). Rows below are seeded from the Nyquist map in 22-RESEARCH.md so the planner has anchors per REQ-ID.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 22-06-T1, 22-12-T1 | 22-06, 22-12 | 2, 3 | ADMIN-01 | T-22-AUTHZ | Only `is_staff=true` reaches admin scaffolding routes (AdminLayout is_staff probe + RPC gate dual-layer per Pattern S1); App.tsx /admin/* lazy routes wired in 22-12-T1 | unit + e2e | `npm test -- AdminMembersPage AdminMemberDetailPage MembersTable` | ✓ landed | ✅ green |
| 22-08-T1 | 22-08 | 2 | ADMIN-02 | T-22-FIN | Financial metrics use `tier_effective` view (not raw `tier`); AdminMetricsKpiStrip + MrrChart shipped | unit | `npm test -- AdminMetricsPage AdminMetricsKpiStrip AdminMetricsMrrChart` | ✓ landed | ✅ green |
| 22-09-T1, 22-09-T2, 22-12-T2 | 22-09, 22-12 | 2, 3 | ADMIN-03 | T-22-IMP | Read-only impersonation: A1 PROBE PASS `app_metadata.impersonator_id` direct read; 51 RLS deny policies (migration 12) block writes; useImpersonationReadOnly defense-in-depth; admin-impersonation-write-deny RLS test asserts 17 tables × INSERT all denied | live-DB RLS + unit | `npm run test:e2e:rls -- admin-impersonation-write-deny rls-audit-logs-impersonation` + `npm test -- ImpersonationBanner useImpersonationReadOnly` | ✓ landed | ✅ green |
| 22-03-T1, 22-03-T2 | 22-03 | 1 | ADMIN-04 | T-22-AUDIT | Refund/cancel/comp emit `audit_logs` row visible to both owner + affected user; Edge Fns admin-refund + admin-cancel + admin-comp wired | unit + Deno | `npm test -- RefundModal CancelSubModal CompSubModal` + `(cd supabase/functions && deno test admin-refund admin-cancel admin-comp)` | ✓ landed | ✅ green |
| 22-06-T2, 22-12-T1 | 22-06, 22-12 | 2, 3 | ADMIN-05 | T-22-FLAG | `feature_flag_overrides` consulted before PostHog SDK via `isFeatureEnabledWithOverride`; expired rows fall through; loadOverrides() wired into App.tsx post-auth hook in 22-12-T1; clearOverrideCache on SIGNED_OUT | unit + live-DB RLS | `npm test -- feature-flag-overrides MemberFlagsTab` + `npm run test:e2e:rls -- rls-feature-flag-overrides` | ✓ landed | ✅ green |
| 22-07-T1, 22-07-T2 | 22-07 | 2 | ADMIN-06 | T-22-AFFL | Affiliate review queue writes `confirmed` status; cron upstream sees `confirmed → payouts` (closes Phase 19 status-graph gap surfaced in [[feedback-status-machine-transition-owner]]) | unit + Deno | `npm test -- AdminAffiliatesReviewQueue` + `(cd supabase/functions && deno test affiliate-review)` | ✓ landed | ✅ green |
| 22-08-T2 | 22-08 | 2 | ADMIN-08 | T-22-RET | Cohort heatmap query returns expected `signup_week × week_offset → DAU%` matrix from fixture; k-anonymity min-bucket-size policy enforced | unit + SQL | `npm test -- CohortHeatmap AdminCohortsPage` | ✓ landed | ✅ green |
| 22-05-T1, 22-05-T2 | 22-05 | 2 | DEL-01 | T-22-CASC | 10-step cascade runs in order; SoftDeleteCountdownBanner mounted in 22-12-T1; CancelDeletionPage wired; cancel link HMAC-token RPC validates | Deno + cascade test | `(cd supabase/functions && deno test account-delete)` + `npm test -- SoftDeleteCountdownBanner DeleteAccountModal cancel-deletion` | ✓ landed | ✅ green |
| 22-01-T1, 22-12-T3 | 22-01, 22-12 | 0, 3 | DEL-02 | T-22-GRACE | 7-day soft-delete: cancellable from email; cron flips `pending → deleted` exactly on day 8 (back-date 8d → finalized; back-date 6d → row remains within grace) | live-DB cron + Deno | `npm run test:e2e:rls -- cron-finalize-7day` + `(cd supabase/functions && deno test soft-delete-grace)` | ✓ landed | ✅ green |
| 22-10-T2, 22-10-T3, 22-12-T1, 22-12-T3 | 22-10, 22-12 | 2, 3 | GDPR-01 | T-22-57 / T-22-60 / T-22-61 | Bottom slide-up cookie banner (vanilla-cookieconsent v3 + Consent Mode v2) with granular Essential/Analytics/Marketing/Personalization toggles; EU default off + US default analytics-on (CCPA); Pattern 4 dynamic-import gate keeps lib off index chunk; Pitfall 7 acceptedService() granularity; CookieConsentBootstrap mounted in App.tsx in 22-12-T1; Playwright covers banner + geo defaults | vitest unit + Playwright e2e | `npm test -- consent-defer consent-config CookieConsentBootstrap` + `npx playwright test e2e/cookie-consent.spec.ts e2e/cookie-consent-geo.spec.ts` | ✓ landed | ✅ green (12/12 unit + 3/3 playwright pass) |
| 22-10-T3, 22-12-T2 | 22-10, 22-12 | 2, 3 | GDPR-02 | T-22-56 / T-22-59 | `consent_records` table stores per-decision audit row server-side (append-only per GDPR Art. 7(1)); PostHog SDK loads via dynamic import only after `acceptedCategory('analytics')` returns true (existing telemetry-defer wiring respects gtag default state); RLS test asserts cross-tenant deny + DELETE blocked | vitest unit + live-DB RLS | `npm test -- consent-records` + `npm run test:e2e:rls -- rls-consent-records` | ✓ landed | ✅ green (7/7 unit + RLS green) |
| 22-04-T1, 22-04-T2, 22-11-T1, 22-11-T2, 22-12-T1, 22-12-T2 | 22-04, 22-11, 22-12 | 1, 2, 3 | GDPR-03 | T-22-DSAR | DSAR export bundle includes Postgres + Storage + Stripe + PostHog + affiliate (hashed for others); 30-day SLA via `dsar_requests`; cross-user emails SHA-256 redacted; 5-min cron tick (migration 21) picks up pending rows; DsarPortalPage mounted in 22-12-T1; RLS test covers `dsar_requests` + `dsar-exports` storage cross-tenant | Deno + bundle assertion + live-DB RLS | `(cd supabase/functions && deno test dsar-export)` + `npm test -- DsarPortalPage dsar-export-client` + `npm run test:e2e:rls -- rls-dsar-requests rls-dsar-exports-storage` | ✓ landed | ✅ green |
| 22-02-T1, 22-02-T2 | 22-02 | 1 | ON-02 | T-22-LIFECYCLE | 5 lifecycle Edge Fns share `_shared/resend-domain-health-check.ts`; pre-verify: log + skip + 200; post-verify: send. D-03 vendor-gated send pattern per [[reference-vendor-gated-send-health-check]] | Deno | `(cd supabase/functions && deno test resend-domain-health-check lifecycle-welcome-series lifecycle-behavior-triggered lifecycle-retention lifecycle-transactional lifecycle-preference-update)` | ✓ landed | ✅ green |
| 22-11-T3 | 22-11 | 2 | ON-03 | T-22-PREFS | Preference center: subscribe/unsubscribe writes consent_records.email_preferences via lifecycle-preference-update Edge Fn; lifecycle Fns consult it before send; EmailPreferencesPage mounted in 22-12-T1 | Deno + unit | `(cd supabase/functions && deno test preference-update)` + `npm test -- EmailPreferencesPage` | ✓ landed | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/admin/admin-members-table.test.ts` — REQ ADMIN-01 stubs
- [ ] `tests/admin/financial-metrics.test.ts` — REQ ADMIN-02 stubs
- [ ] `tests/rls/impersonation-write-deny.rls.test.ts` — REQ ADMIN-03 stubs (use service-role-minted JWT pattern; per-file slug prefix `IMP_`)
- [ ] `tests/admin/admin-actions-audit.test.ts` — REQ ADMIN-04 stubs
- [ ] `tests/feature-flags/feature-flag-overrides.test.ts` — REQ ADMIN-05 stubs
- [ ] `supabase/functions/affiliate-review/affiliate-review.test.ts` — REQ ADMIN-06 stubs (Deno; `.test.ts` not `-test.ts`)
- [ ] `tests/admin/cohort-heatmap-sql.test.ts` — REQ ADMIN-08 stubs (k-anonymity min-bucket-size policy)
- [ ] `supabase/functions/account-delete/cascade-completeness.test.ts` — REQ DEL-01 stubs
- [ ] `supabase/functions/account-delete/soft-delete-grace.test.ts` — REQ DEL-02 stubs (7-day, NOT 30-day)
- [ ] `supabase/functions/dsar-export/dsar-export.test.ts` — REQ GDPR-01 stubs
- [ ] `tests/e2e/cookie-consent.spec.ts` — REQ GDPR-02 stubs (Playwright)
- [ ] `tests/dsar/dsar-redaction.test.ts` — REQ GDPR-03 stubs (SHA-256 of foreign-user emails)
- [ ] `supabase/functions/_shared/resend-domain-health-check.test.ts` — REQ ON-02 shared helper
- [ ] `supabase/functions/preference-update/preference-update.test.ts` — REQ ON-03 stubs
- [ ] Verify vitest + Deno + Playwright present (no install required — all from prior phases)
- [ ] Add `dsar_requests`, `consent_records`, `feature_flag_overrides`, `email_preferences` to Wave 0 migration stubs so RLS tests compile

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cookie banner appearance on real EU IP | GDPR-02 | Geo-IP gating requires actual EU/US IP — CI cannot reproduce reliably | Use BrowserStack EU region OR `?force_geo=eu` query param helper added in Wave 0 |
| Resend DNS verification at domain `app.leanshot.app` | ON-02 | DNS verify is vendor-owned + one-time (deferred-from-P19 vendor pass) | `curl https://api.resend.com/domains -H "Authorization: Bearer $RESEND_API_KEY"` — verify `status=verified` |
| Stripe LIVE balance check before Connect delete | DEL-01 | Production-only Stripe state | Manual probe via Stripe dashboard for any test affiliate with simulated balance |
| Real Postman probe for `app_metadata` JWT propagation (research ASSUMPTION A1) | ADMIN-03 | Confirms whether new JWT mint carries `impersonator_id` claim within one request | Postman script in Wave 0 plan; fallback = Custom Access Token Hook |
| Visual regression on lifecycle email templates on new design tokens | ON-02 | Resend preview UI requires manual inspection | Send each template to test address; eyeball against design-token swatches |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (planner filled per-task rows in plan 22-12 Task 4)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (each plan's tasks have inline `<verify><automated>` blocks)
- [x] Wave 0 covers all MISSING references (35 scaffolds shipped in plan 22-01; all turned on by closing plans 22-02..22-12)
- [x] No watch-mode flags (npm test runs `vitest run`; e2e is one-shot Playwright)
- [x] Feedback latency < 120s (unit) / < 360s (full) — unit ~25s, Deno ~45s, Playwright ~3.6s for plan 22-12 spec set
- [x] `nyquist_compliant: true` set in frontmatter (flipped 2026-05-16 by gsd-verifier — see 22-VERIFICATION.md)

**Approval:** VERIFIED 2026-05-16 by gsd-verifier (status: passed; 14/14 REQ-IDs satisfied; see 22-VERIFICATION.md)

---

## Plan-by-Plan Coverage

| Plan | REQ-IDs | Wave | Tests added (file/spec count) | Tests green | Notes |
|------|---------|------|-------------------------------|-------------|-------|
| 22-01 | (Wave 0 setup — scaffolds for all 14 REQ-IDs) | 0 | 35 scaffolds + 14 migrations + Edge Fns + Storage bucket | (turned on in later plans) | A1 PROBE PASS (336ms); 51-policy migration; 14 scaffold files |
| 22-02 | ON-02 | 1 | 6 Deno (resend-domain-health-check + 5 lifecycle Fns) | 6 | D-03 vendor-gated send pattern |
| 22-03 | ADMIN-03, ADMIN-04 | 1 | 9 vitest + 1 Deno (admin-refund/cancel/comp Edge Fns) | 10 | A1 PROBE PASS Option A |
| 22-04 | GDPR-03 | 1 | 8 vitest + 1 Deno (dsar-export 9-step orchestrator) | 9 | SHA-256 affiliate-email hashing |
| 22-05 | DEL-01, DEL-02 | 2 | 12 vitest (SoftDeleteCountdownBanner + DeleteAccountModal + cancel-deletion) | 12 | 7-day grace + HMAC cancel-link |
| 22-06 | ADMIN-01, ADMIN-05 | 2 | 17 vitest (AdminLayout + members table + drill-in + feature-flag-overrides + role system) | 17 | Pattern S1 dual-layer is_staff gate |
| 22-07 | ADMIN-04, ADMIN-06 | 2 | 11 vitest + 1 Deno (AdminAffiliatesReviewQueue + admin-affiliate-review Edge Fn) | 12 | Closes Phase 19 status-graph gap |
| 22-08 | ADMIN-02, ADMIN-08 | 2 | 10 vitest (AdminMetricsPage + AdminCohortsPage + CohortHeatmap) | 10 | `tier_effective` view consumer + k-anonymity |
| 22-09 | ADMIN-03 | 2 | 12 vitest (ImpersonationBanner + useImpersonationReadOnly) | 12 | UX defense-in-depth over RLS policies |
| 22-10 | GDPR-01, GDPR-02 | 2 | 22 vitest (consent-defer + consent-config + consent-records + CookieConsentBootstrap) | 22 | Pattern 4 dynamic-import gate; INSERT-only audit |
| 22-11 | GDPR-03, ON-03 | 2 | 33 vitest (DsarPortalPage + EmailPreferencesPage + dsar-export-client) + 1 SQL migration | 33 | 5-min Vault-gated cron tick |
| 22-12 | (Wave 3 integration — covers all 14) | 3 | 17 e2e/RLS (5 RLS + 2 vitest-live + 5 Playwright + Wave 0 scaffold turn-ons) | 8 pass / 9 env-skip locally; full green on live cloud DB | App.tsx integration + bundle ceiling enforcement |

**Totals:**
- 14/14 REQ-IDs covered with explicit Task ID + Plan + Wave provenance
- 8 D-NN decisions implemented (D-02 carved out per CONTEXT — ON-01 onboarding revamp deferred to P22b; explicit carve-out test in plan 22-12)
- 12 plans shipped (22-01..22-12)
- ~190 tests added across vitest + Deno + Playwright
- Bundle index gz: 17.70 kB vs 50 kB ceiling (~35% utilization)
- 0 stubs leaked into production paths (jsPDF v1.3 placeholder is documented seam)
