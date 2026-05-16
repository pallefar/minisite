---
phase: 22
slug: owner-admin-lifecycle-email-dsar-cookie-consent
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| TBD | TBD | TBD | ADMIN-01 | T-22-AUTHZ | Only `is_staff=true` reaches admin scaffolding routes | unit + e2e | `npm test -- AdminMembersTable` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ADMIN-02 | T-22-FIN | Financial metrics use `tier_effective` view; not raw `tier` | unit | `npm test -- FinancialMetricsCard` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ADMIN-03 | T-22-IMP | Read-only impersonation: RLS denies writes when `app_metadata.impersonator_id` is set | live-DB RLS | `npm test -- impersonation-write-deny.rls.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ADMIN-04 | T-22-AUDIT | Every refund / sub-cancel / comp emits `audit_logs` row visible to both owner and affected user | unit + RLS | `npm test -- admin-actions.audit.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ADMIN-05 | T-22-FLAG | `feature_flag_overrides` consulted before PostHog SDK; expired rows fall through | unit | `npm test -- feature-flag-overrides.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ADMIN-06 | T-22-AFFL | Affiliate review queue writes `confirmed` status; cron upstream sees `confirmed → payouts` (closes Phase 19 status-graph gap) | live-DB + Deno | `(cd supabase/functions && deno test affiliate-review)` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ADMIN-08 | T-22-RET | Cohort heatmap query returns expected `signup_week × week_offset → DAU%` matrix from fixture | unit + SQL | `npm test -- cohort-heatmap.sql.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | DEL-01 | T-22-CASC | 10-step cascade runs in order; CI cascade-completeness test verifies every user-scoped table is empty post-delete except retention exceptions | Deno + cascade test | `(cd supabase/functions && deno test account-delete)` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | DEL-02 | T-22-GRACE | 7-day soft-delete: cancellable from email; cron flips `pending → deleted` exactly on day 8 | Deno + cron test | `(cd supabase/functions && deno test soft-delete-grace)` | ❌ W0 | ⬜ pending |
| Task 2+3 | 22-10 | 2 | GDPR-01 | T-22-57 / T-22-60 / T-22-61 | Bottom slide-up cookie banner (vanilla-cookieconsent + Consent Mode v2) with granular Essential/Analytics/Marketing/Personalization toggles; EU default off + US default analytics-on (CCPA); Pattern 4 dynamic-import gate keeps lib off index chunk; Pitfall 7 acceptedService() granularity | vitest unit + Playwright e2e (deferred to plan 22-12 once mount is wired) | `npm test -- consent-defer consent-config CookieConsentBootstrap` | ✅ ship | ✅ green (12/12 unit) |
| Task 3 | 22-10 | 2 | GDPR-02 | T-22-56 / T-22-59 | `consent_records` table stores per-decision audit row server-side (append-only per GDPR Art. 7(1)); PostHog SDK loads via dynamic import only after `acceptedCategory('analytics')` returns true (existing telemetry-defer wiring respects gtag default state) | vitest unit (7/7) | `npm test -- consent-records` | ✅ ship | ✅ green (7/7 unit) |
| TBD | TBD | TBD | GDPR-03 | T-22-DSAR | DSAR export bundle includes Postgres + Storage + Stripe + PostHog + affiliate (hashed for others); 30-day SLA enforced via `dsar_requests`; cross-user emails SHA-256 redacted | Deno + bundle assertion | `(cd supabase/functions && deno test dsar-export)` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ON-02 | T-22-LIFECYCLE | 5 lifecycle Edge Fns share `_shared/resend-domain-health-check.ts`; pre-verify: log + skip + 200; post-verify: send | Deno | `(cd supabase/functions && deno test lifecycle-)` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ON-03 | T-22-PREFS | Preference center: subscribe/unsubscribe writes `email_preferences`; lifecycle Fns consult it before send | Deno + unit | `(cd supabase/functions && deno test preference-update)` | ❌ W0 | ⬜ pending |

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

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (planner fills per-task rows after PLAN.md generation)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s (unit) / < 360s (full)
- [ ] `nyquist_compliant: true` set in frontmatter (post-planning)

**Approval:** pending
