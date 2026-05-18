# Data Classification Policy

**Version:** 1.0
**Last Reviewed:** 2026-05-17
**Next Review Due:** 2027-05-17 (annual)
**Owner:** Founder (Karsten Haldan)
**Applies To:** All LeanShot employees, contractors, and systems processing PHI

## 1. Purpose

Define how LeanShot classifies its data into tiers based on sensitivity and regulatory requirements, and specify storage, encryption, retention, and vendor exposure rules for each tier.

## 2. Scope

All data created, received, maintained, or transmitted by LeanShot across all systems. Classification applies to data at rest and in transit.

## 3. Policy

### 3.1 Data classification tiers

#### Tier 1: Protected Health Information (PHI)

PHI is any individually identifiable health information that is transmitted or maintained in any form. Under HIPAA, this is the most protected tier.

**PHI fields in LeanShot:**

| Field | Location | Description |
|-------|----------|-------------|
| medication | injections table | Drug name (e.g., semaglutide) |
| dose | injections table | Dose value + unit |
| injection_site | injections table | Body site of injection |
| photos | photos table | Body progress photos |
| weight | weights table | Body weight measurement |
| meal | meals table | Food intake logs |
| symptoms | symptom_logs table | Reported symptoms |
| mood | mood_logs table | Mood ratings |
| sleep | sleep_logs table | Sleep duration/quality |
| ai_conversation | ai_messages table | Clinical AI conversation thread |
| profile.email | profiles table | Email address when linked to health context |
| profile.phone | profiles table | Phone number when linked to health context |
| profile.date_of_birth | profiles table | Date of birth |

**PHI handling rules:**
- Encrypted at rest (Supabase AES-256 at storage layer + Postgres row-level encryption for sensitive columns)
- Encrypted in transit (TLS 1.2+ on all Supabase and Edge Function connections)
- Access via RLS policies only; no direct service-role queries in application code
- Logged in `phi_access_log` when accessed by clinical staff (see access-control.md)
- Retention: retained for the duration of the user relationship + 7 years post-termination (common HIPAA-adjacent medical record retention standard; adjust per state law if required)
- Vendor exposure: only to vendors with signed BAA (see baa-management.md)
- PHI MUST NOT appear in Stripe metadata, description, or line-item fields (banking exemption; CI lint enforced)
- PHI MUST NOT appear in Sentry error payloads without `data-sentry-mask` on the originating UI element (CI audit enforced)
- PHI MUST NOT appear in PostHog event properties or session recordings (scrub-only posture; session replay disabled on PHI routes)

#### Tier 2: PII non-PHI

Personally identifiable information that is not health-related or is not combined with health context.

**PII non-PHI fields in LeanShot:**

| Field | Description |
|-------|-------------|
| analytics user id | PostHog distinct_id (pseudonymous; not directly linked to health data in PostHog) |
| marketing lead email | Email addresses from marketing forms not yet linked to a patient account |
| stripe customer id | Billing identifier (never combined with PHI in Stripe) |
| affiliate referral code | Tracking code for affiliate attribution |

**PII non-PHI handling rules:**
- Encrypted in transit (TLS)
- Not subject to HIPAA; subject to GDPR/CCPA if applicable
- Retention: retained per product need; marketing leads deleted on unsubscribe
- Vendor exposure: Stripe (for billing only), PostHog (for analytics), affiliate tracking vendors

#### Tier 3: Public

Data that is intentionally public or carries no privacy expectation.

**Public data in LeanShot:**
- Marketing copy and blog content
- Public API documentation
- Open-source code
- Anonymized, aggregated usage statistics (no individual identifiable)

**Public handling rules:**
- No special handling required
- Must not contain PHI or PII (review before publishing)

### 3.2 Stripe banking exemption boundary

Stripe is used exclusively for payment processing. The following rules enforce the PHI/payment boundary:

- Stripe `description` fields: may describe product names (e.g., "LeanShot monthly subscription") but never patient names, diagnoses, medication names, or dose values
- Stripe `metadata` fields: may contain `user_id` (UUID only), plan type, and billing period — never PHI field values
- Stripe `statement_descriptor`: product name only
- CI lint (`scripts/lint-stripe-phi.ts`) enforces this boundary at every commit

Any future feature that might pass health data to Stripe (e.g., metered billing per dose logged) must route only aggregate counts, never field values.

### 3.3 Forbidden PHI locations

PHI must never be placed in:

- Stripe API calls (any field)
- Log files (server or browser console)
- Error messages visible to unauthorized users
- URL query parameters (visible in server logs)
- Session recording tools (PostHog; enforced by URL regex disable)
- Sentry error payloads (unless masked via `data-sentry-mask`)
- Unencrypted local storage on clinic operator devices (browser localStorage is acceptable for ephemeral session data only)
- Email bodies sent via Resend (PHI emails must route via AWS SES with BAA)
- Source code or version control (accidental PHI in test fixtures)

## 4. Procedures

### 4.1 New data field classification

When adding a new data field to LeanShot:

1. Determine if the field is health-related or identifiable → classify as PHI, PII non-PHI, or Public
2. If PHI: add to the PHI fields table in Section 3.1; add to `sentry-mask-required-props.json` if it appears in any UI component; verify RLS policy covers the new field; add to `phi_access_log` trigger if it appears on a PHI access surface
3. If PII non-PHI: confirm it does not flow to a PHI-scoped vendor without appropriate agreements
4. If Public: confirm it contains no PHI or PII before publishing

### 4.2 Annual classification review

As part of the annual risk assessment (risk-assessment.md):
1. Review the PHI fields table for completeness
2. Confirm RLS policies cover all PHI fields
3. Confirm `sentry-mask-required-props.json` is current
4. Confirm PostHog session-replay disable regex covers all PHI routes

## 5. Responsibilities

- **Founder**: approves classification decisions; reviews annually
- **Engineering**: implements classification in RLS policies, masking, and routing; updates this document when new fields are added
- **Drata**: tracks classification documentation as SOC 2 evidence

## 6. Enforcement

Misclassification or improper handling of PHI is a HIPAA violation. CI enforces key boundaries (Stripe PHI lint, Sentry mask audit). New code that adds PHI fields without updating RLS, masking config, or this document must be caught in code review.

## 7. Revision History

| Date | Author | Change |
|------|--------|--------|
| 2026-05-17 | Karsten Haldan | Initial version (Phase 25 Plan 25-10) |
