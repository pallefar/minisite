---
status: partial
phase: 25-hipaa-audit-hardening-vendor-baa-chain
source: [25-VERIFICATION.md]
started: 2026-05-18
updated: 2026-05-18
---

## Current Test

[awaiting founder vendor-action completion — items below are tracked in detail at 25-10-SUMMARY.md "Drata Onboarding Tracker"]

## Tests

### 1. Supabase Team + HIPAA BAA signed (HIPAA-01)
expected: Supabase dashboard upgraded to Team plan + HIPAA add-on; BAA countersigned; `vendor_baa_chain` row for Supabase flips `status='signed'` via Admin Compliance UI at `/admin/compliance`
result: [pending]
verify: `npx --prefix leanshot supabase db query --linked "SELECT vendor_name, status, baa_signed_at FROM public.vendor_baa_chain WHERE vendor_name='Supabase';"` → status='signed'

### 2. Vercel Pro + HIPAA BAA signed (HIPAA-02)
expected: Vercel dashboard upgraded to Pro + HIPAA add-on (self-serve since 2025); BAA countersigned; `vendor_baa_chain` Vercel row flipped to signed
result: [pending]
verify: same SQL pattern, `WHERE vendor_name='Vercel'`

### 3. Sentry Business + BAA signed (HIPAA-03)
expected: Sentry plan upgraded to Business; BAA requested + countersigned; `vendor_baa_chain` Sentry row flipped to signed
result: [pending]
verify: same SQL pattern, `WHERE vendor_name='Sentry'`

### 4. Anthropic Enterprise + BAA + clinical key (HIPAA-04 vendor half)
expected: Anthropic Enterprise sales call complete; BAA + ZDR addendum signed (4-8wk lead); `ANTHROPIC_CLINICAL_API_KEY` set via Function Secret; `ANTHROPIC_CLINICAL_BAA_ACTIVE=1` flipped; `vendor_baa_chain` Anthropic row signed; 503 → live BAA-allowlisted Anthropic flow
result: [pending]
verify: same SQL pattern + smoke test: clinical-orgId ai-chat request returns Claude Sonnet stream (not 503)

### 5. AWS SES 6-step setup (HIPAA-05 vendor half)
expected: AWS BAA signed via AWS Artifact (same-day self-serve) + `app.leanshot.app` SES domain DKIM verified + SES sandbox lift requested+granted + SNS topic `leanshot-ses-bounces` created + HTTPS subscriber `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/ses-bounce-webhook` confirmed + `AWS_SES_BAA_ACTIVE=1` flipped + AWS_SES_ACCESS_KEY_ID/SECRET_ACCESS_KEY/REGION/FROM set as Function Secrets
result: [pending]
verify: `curl -X POST '.../functions/v1/ses-bounce-webhook' -H "Authorization: Bearer <ANON>" -d '{"Type":"SubscriptionConfirmation"}'` returns 200 ack

### 6. PostHog session-recording runtime behavior (HIPAA-06)
expected: Live browser: log in → navigate /clinic/* surface → confirm session-recording stopped via posthog devtools (Recording: off); navigate to /landing → Recording: on
result: [pending]
verify: in browser devtools console: `posthog.sessionRecordingStarted()` — expect `false` on /clinic/*, `true` on landing

### 7. Drata SOC 2 Type I onboarding (HIPAA-09)
expected: Drata MSA signed; integrations connected (Supabase, GitHub, Vercel, Sentry, AWS, Google Workspace, 1Password); 6-week observation window started
result: [pending]
verify: Drata portal shows "Observation In Progress" on the SOC 2 dashboard

### 8. Employee security training completion (HIPAA-10)
expected: Founder completes Drata HIPAA training module (60-90 min) + signs acknowledgment in Drata LMS
result: [pending]
verify: Drata portal shows training "Completed" with timestamp + signed acknowledgment

### 9. First annual risk assessment tabletop exercise (HIPAA-18)
expected: Walk through `/leanshot/legal/hipaa/risk-assessment.md` template (3 hours) + walk through tabletop scenario; document outcomes in same file
result: [pending]
verify: `risk-assessment.md` contains a dated "Last assessment" entry within last 365 days

## Summary

total: 9
passed: 0
issues: 0
pending: 9
skipped: 0
blocked: 0

## Gaps

None — all 9 items are vendor-action-gated by phase design (per 25-CONTEXT.md), not engineering gaps. Full automation impossible — these require vendor portal workflows, founder employee training, and a 6-week Drata observation window.

See `25-10-SUMMARY.md` "Drata Onboarding Tracker" for detailed action steps, target dates, and verification commands per item.
