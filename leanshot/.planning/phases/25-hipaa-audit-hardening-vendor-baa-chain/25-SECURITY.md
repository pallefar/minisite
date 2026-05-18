# Phase 25 Security Baseline

**Phase:** 25-hipaa-audit-hardening-vendor-baa-chain
**Generated:** 2026-05-18
**Status:** Wave 3 complete — engineering controls shipped; vendor BAA chain + Drata onboarding pending human gates

---

## Threat Model vs HIPAA-01..18

### Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser → Supabase | Supabase anon key; Row Level Security enforces data isolation |
| Browser → Vercel Edge Functions | Authenticated requests; HTTPS only |
| Edge Function → Anthropic | Clinical branch: `ANTHROPIC_CLINICAL_API_KEY`; Consumer branch: separate key |
| Edge Function → AWS SES | PHI email path; BAA required + present via AWS Artifact |
| Edge Function → Resend | Non-PHI email only; Resend cannot receive PHI |
| Edge Function → Stripe | Payment data only; PHI excluded via CI lint |
| Browser → PostHog | Session replay disabled on PHI routes; event properties scrubbed |
| Browser → Sentry | `data-sentry-mask` required on PHI UI elements; CI audit enforced |
| Supabase → pg_cron | Scheduled jobs: baa-expiry-check (daily), subprocessor-diff (weekly) |
| CI → Notion API | Mirror token in GitHub Secrets; credential-missing exits 0 (vendor-gated) |
| Founder → Drata | Manual onboarding portal; evidence uploads outside engineering control |

---

## Per-Control Mitigation Map

### HIPAA-01: Supabase Team + HIPAA add-on

| Item | Status |
|------|--------|
| Engineering control | RLS on all PHI tables; phi_access_log; append-only audit_logs |
| Mitigation pointer | supabase/migrations/20270702000001_vendor_baa_chain.sql; supabase/migrations/20270702000004_phi_access_log.sql |
| Human gate | Supabase Team + HIPAA add-on ($924/mo) — BAA not yet signed |
| Risk if open | PHI in Supabase without BAA = HIPAA covered-entity violation |

### HIPAA-02: Vercel Pro + HIPAA add-on

| Item | Status |
|------|--------|
| Engineering control | Edge Functions serve PHI via HTTPS; no PHI stored in Vercel |
| Mitigation pointer | supabase/functions/ (PHI flows through Supabase, not Vercel storage) |
| Human gate | Vercel Pro + HIPAA add-on ($350/mo) — BAA not yet signed |
| Risk if open | Vercel Edge Functions process PHI without BAA = violation |

### HIPAA-03: Sentry Business + BAA

| Item | Status |
|------|--------|
| Engineering control | `data-sentry-mask` CI lint (Plan 25-06); PHI props masked at source |
| Mitigation pointer | scripts/audit-sentry-mask.ts; .github/workflows/ci.yml "Sentry data-sentry-mask audit" |
| Human gate | Sentry Business plan upgrade ($80/mo) + BAA negotiation — pending |
| Risk if open | Unmasked PHI leaks into Sentry error events without BAA = violation |

### HIPAA-04: Anthropic Enterprise + BAA + ZDR

| Item | Status |
|------|--------|
| Engineering control | Dual-credential router (Plan 25-04); BAA model allowlist; 403 refusal on non-allowed models |
| Mitigation pointer | supabase/functions/_shared/anthropic-baa-allowlist.ts; ai-chat-clinical-branch.test.ts |
| Human gate | Anthropic Enterprise (sales-assisted; custom pricing $500-2K/mo) — BAA + ZDR pending |
| Risk if open | Clinical AI calls processed without BAA + ZDR = HIPAA violation + data residency risk |

### HIPAA-05: AWS SES BAA for PHI email

| Item | Status |
|------|--------|
| Engineering control | email-router.ts routes on `phi:boolean` flag; PHI path to SES only |
| Mitigation pointer | supabase/functions/_shared/email-router.ts (Plan 25-03) |
| Human gate | AWS BAA via AWS Artifact (self-serve; ~$10/mo SES cost) — pending signature |
| Risk if open | PHI emails sent via Resend (no BAA) instead of SES = violation |

### HIPAA-06: PostHog tier + session-replay disable

| Item | Status |
|------|--------|
| Engineering control | Session replay disabled on all PHI URL routes via PostHog config |
| Mitigation pointer | src/main.tsx PostHog config; D-04 scrub-only posture (no Boost add-on) |
| Human gate | PostHog tier confirmation (scrub-only; no add-on at v1.3) |
| Risk if open | Session replay could capture PHI inputs if URL regex is incomplete |

### HIPAA-07: Anthropic dual-credential router

| Item | Status |
|------|--------|
| Engineering control | ai-chat Edge Fn branches on org_id IS NOT NULL; clinical key has restrictive system prompt |
| Mitigation pointer | supabase/functions/ai-chat/index.ts (Plan 25-04 D-13) |
| Human gate | Clinical API key requires Anthropic Enterprise — same gate as HIPAA-04 |
| Risk if open | Consumer key (non-BAA) used in clinical context = data routing violation |

### HIPAA-08: Stripe banking exemption CI lint

| Item | Status |
|------|--------|
| Engineering control | scripts/lint-stripe-phi.ts; CI step "Stripe PHI keyword lint (Phase 25 HIPAA-08)" |
| Mitigation pointer | scripts/stripe-phi-keywords.json; .github/workflows/ci.yml |
| Human gate | None — fully automated; allowlist comment required for exceptions |
| Risk if open | PHI keywords in Stripe metadata would cross Stripe's no-BAA boundary |

### HIPAA-09: SOC 2 Type I via Drata

| Item | Status |
|------|--------|
| Engineering control | None (SOC 2 is a process control, not a code control) |
| Mitigation pointer | legal/hipaa/ policies serve as evidence artifacts for Drata |
| Human gate | Drata MSA signing + 6-week observation window + auditor report |
| Risk if open | No SOC 2 attestation; clinical deals may stall at security questionnaire |

### HIPAA-10: Employee security training

| Item | Status |
|------|--------|
| Engineering control | None (training is a process control) |
| Mitigation pointer | legal/hipaa/training.md |
| Human gate | Founder completes Drata HIPAA training module (60-90 min) + annual refresh |
| Risk if open | HIPAA Security Rule 45 CFR 164.308(a)(5) violation if training not documented |

### HIPAA-11: Written policies + Notion mirror

| Item | Status |
|------|--------|
| Engineering control | 7 policy markdowns in legal/hipaa/; Notion mirror script + CI wire |
| Mitigation pointer | legal/hipaa/*.md; scripts/notion-mirror-hipaa-policies.mjs; CI step "Notion mirror of HIPAA policies (Phase 25 HIPAA-11)" |
| Human gate | Notion parent page creation + GitHub Secrets set; first mirror run verified |
| Risk if open | Policies exist in repo but Notion mirror (non-engineering team access) non-functional until secrets set |

### HIPAA-12: vendor_baa_chain + subprocessor-diff cron

| Item | Status |
|------|--------|
| Engineering control | vendor_baa_chain table; subprocessor-diff Edge Fn + weekly pg_cron |
| Mitigation pointer | supabase/migrations/20270702000001_vendor_baa_chain.sql; supabase/functions/subprocessor-diff/ (Plan 25-02) |
| Human gate | None — fully automated |
| Risk if open | Subprocessor changes would go undetected |

### HIPAA-13: BAA expiry calendar (60-day advance alert)

| Item | Status |
|------|--------|
| Engineering control | baa-expiry-check Edge Fn + daily pg_cron; admin banner at /admin/compliance |
| Mitigation pointer | supabase/functions/baa-expiry-check/; Plan 25-01 |
| Human gate | None (engineering shipped) — alerts require founder action on expiry |
| Risk if open | BAA lapse would create compliance gap during renewal window |

### HIPAA-14: phi_access_log audit hardening

| Item | Status |
|------|--------|
| Engineering control | phi_access_log table; log_phi_access RPC; append-only RLS |
| Mitigation pointer | supabase/migrations/20270702000004_phi_access_log.sql; Plan 25-07 |
| Human gate | None — fully automated |
| Risk if open | No audit trail of clinician PHI access = HIPAA right-of-accounting violation |

### HIPAA-15: MFA enforcement for clinicians

| Item | Status |
|------|--------|
| Engineering control | ClinicianMfaGuard (Plan 25-08); PatientMfaCard for optional patient MFA |
| Mitigation pointer | src/components/clinic/ClinicianMfaGuard.tsx; Plan 25-08 |
| Human gate | None — fully automated |
| Risk if open | Clinician access to PHI without MFA = HIPAA Security Rule violation |

### HIPAA-16: Sentry data-sentry-mask audit

| Item | Status |
|------|--------|
| Engineering control | CI lint audit-sentry-mask.ts; sentry-mask-required-props.json |
| Mitigation pointer | scripts/audit-sentry-mask.ts; Plan 25-06 |
| Human gate | None — fully automated via CI |
| Risk if open | PHI leaked into Sentry error reports without masking |

### HIPAA-17: PostHog session-replay disable on PHI routes

| Item | Status |
|------|--------|
| Engineering control | disable_session_recording_on_url regex in PostHog init |
| Mitigation pointer | src/main.tsx PostHog config; D-16 |
| Human gate | None — code shipped |
| Risk if open | Session replay could capture PHI on /clinic/*, /patient/*, /admin/users/* |

### HIPAA-18: Annual risk assessment + breach SLA

| Item | Status |
|------|--------|
| Engineering control | Policy documents in legal/hipaa/ (incident-response.md + risk-assessment.md + breach-notification.md) |
| Mitigation pointer | legal/hipaa/risk-assessment.md; legal/hipaa/incident-response.md |
| Human gate | First risk assessment (2027-05-17 due); first tabletop exercise (2027-05-17 due) |
| Risk if open | HIPAA Security Rule 45 CFR 164.308(a)(1)(ii)(A) violation if annual assessment not completed |

---

## Outstanding Human Gates (vendor BAAs)

The following items CANNOT be closed by engineering alone. All are tracked in the `vendor_baa_chain` table with `status = 'pending'`. The Admin Compliance UI at `/admin/compliance` shows current status.

| Gate | Owner | HIPAA REQ | Estimated lead time | Cost |
|------|-------|-----------|--------------------|----|
| Supabase Team + HIPAA add-on BAA | Founder | HIPAA-01 | 1-2 days (self-serve) | $924/mo |
| Vercel Pro + HIPAA add-on BAA | Founder | HIPAA-02 | 1-2 days (self-serve) | $350/mo |
| Sentry Business + BAA | Founder | HIPAA-03 | 1 week | $80/mo |
| Anthropic Enterprise + BAA + ZDR | Founder | HIPAA-04, HIPAA-07 | 4-8 weeks (sales-assisted) | ~$500-2K/mo |
| AWS SES BAA via AWS Artifact | Founder | HIPAA-05 | Same day (self-serve) | ~$10/mo |
| PostHog tier confirmation | Founder | HIPAA-06 | 1 day | scrub-only tier |
| Drata MSA + onboarding | Founder | HIPAA-09, HIPAA-10 | ~6 weeks | ~$10-15K |
| Employee training completion | Founder | HIPAA-10 | 60-90 min | (Drata included) |
| Notion parent page + GitHub Secrets | Founder | HIPAA-11 | 30 min | Free |
| First annual risk assessment | Founder | HIPAA-18 | 3 hours | (internal) |
| First tabletop exercise | Founder | HIPAA-18 | 3 hours | (internal) |

---

## STRIDE Threat Summary (Phase 25 aggregate)

| Threat ID | Category | Component | Disposition |
|-----------|----------|-----------|-------------|
| T-25-S1 | Spoofing | Consumer AI key used in clinical context | Mitigated: dual-credential router + org_id branch (Plan 25-04) |
| T-25-S2 | Spoofing | Clinician impersonation via stolen session | Mitigated: MFA enforcement (Plan 25-08) |
| T-25-T1 | Tampering | phi_access_log manipulation | Mitigated: append-only RLS + SECURITY DEFINER RPC (Plan 25-07) |
| T-25-T2 | Tampering | vendor_baa_chain status spoofed | Mitigated: update_vendor_baa RPC with admin-role check (Plan 25-09) |
| T-25-T3 | Tampering | Stripe PHI in metadata (banking exemption breach) | Mitigated: CI lint (Plan 25-05) |
| T-25-T4 | Tampering | Notion mirror silently truncates >100-block policies | Accepted: documented limitation; richer converter is post-v1.3 |
| T-25-R1 | Repudiation | PHI access without audit trail | Mitigated: phi_access_log (Plan 25-07) |
| T-25-R2 | Repudiation | Policy change without audit trail | Mitigated: git history is SoT; Notion is mirror only |
| T-25-I1 | Info disclosure | Sentry error events contain PHI | Mitigated: data-sentry-mask CI audit (Plan 25-06) |
| T-25-I2 | Info disclosure | PostHog session replay captures PHI inputs | Mitigated: URL regex disable on all PHI routes (D-16) |
| T-25-I3 | Info disclosure | PHI emailed via Resend (no BAA) | Mitigated: email-router phi-flag split (Plan 25-03) |
| T-25-I4 | Info disclosure | Notion API token leak in CI logs | Mitigated: Pattern S3 in mirror script (status only, never body) |
| T-25-D1 | Denial of service | BAA expiry causes compliance gap | Mitigated: 60-day advance alert + admin banner (Plan 25-01) |
| T-25-E1 | Elevation | Clinician accesses data beyond org scope | Mitigated: RLS + clinician MFA + phi_access_log |
| T-25-E2 | Elevation | Admin promotes BAA status without authorization | Mitigated: admin role check on update_vendor_baa RPC |
