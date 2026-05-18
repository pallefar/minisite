# Business Associate Agreement (BAA) Management Policy

**Version:** 1.0
**Last Reviewed:** 2026-05-17
**Next Review Due:** 2027-05-17 (annual)
**Owner:** Founder (Karsten Haldan)
**Applies To:** All LeanShot employees, contractors, and systems processing PHI

## 1. Purpose

Define how LeanShot manages Business Associate Agreements (BAAs) with vendors who process PHI on its behalf, ensuring continuous compliance with HIPAA Privacy Rule 45 CFR §164.502(e) and the Breach Notification Rule requirements for business associates.

## 2. Scope

All third-party vendors ("business associates") that create, receive, maintain, or transmit PHI in the course of performing services for LeanShot. This includes cloud infrastructure, AI providers, error monitoring, analytics, and email delivery.

## 3. Policy

### 3.1 BAA-required vendors

The following six vendors process PHI and require a signed BAA. Status is tracked in the `vendor_baa_chain` database table and the Admin Compliance UI.

| Vendor | Purpose | BAA type | Approx. cost | Status |
|--------|---------|----------|-------------|--------|
| Supabase | Database + Auth | Team plan + HIPAA addon | $924/mo | Pending |
| Vercel | Frontend hosting + Edge Functions | Pro plan + HIPAA addon | $350/mo | Pending |
| Sentry | Error tracking | Business plan + BAA | $80/mo | Pending |
| Anthropic | AI (clinical context) | Enterprise + BAA + ZDR | ~$500-2K/mo | Pending |
| AWS SES | PHI email delivery | AWS BAA via AWS Artifact | ~$10/mo | Pending |
| PostHog | Analytics (scrub-only posture) | Tier confirmation, no addon | HIPAA-scrub tier | Pending |

Status must be updated in the Admin Compliance UI at `/admin/compliance` as each BAA is signed.

### 3.2 Stripe banking exemption

Stripe is NOT a business associate and does NOT sign a BAA. Stripe processes payment data only, never patient diagnosis, medication, dose, or health information. CI enforces this boundary via a Stripe PHI keyword lint check (see data-classification.md and Phase 25 D-02/D-09). PHI must never be included in Stripe description, metadata, or line-item fields.

### 3.3 Resend email exemption

Resend does not sign a BAA. All PHI-bearing email (clinic notifications, dose alerts, doctor-share confirmations, patient access-log notifications) routes via AWS SES which has a signed BAA. Non-PHI email (welcome, receipts, marketing, password reset) may use Resend. The `_shared/email-router.ts` Edge Function enforces this split.

### 3.4 BAA storage

Signed BAAs stored at: `/legal/hipaa/baa/<vendor>-baa-<YYYYMMDD>.pdf`

All BAA files are retained for 6 years from the date of signature or last date of service, whichever is later (HIPAA documentation retention requirement).

### 3.5 60-day advance renewal process

- `baa-expiry-check` cron runs nightly; 60-day advance triggers email alert to founder + admin banner at `/admin/compliance`
- 30/14/7/1-day milestones: escalating email alerts; banner shifts from amber to red
- On expiry without renewal: red "COMPLIANCE GAP" banner; founder must act immediately
- Renewal process: contact vendor, execute new BAA, upload PDF, update `vendor_baa_chain` row via Admin Compliance UI

### 3.6 Subprocessor change response protocol

- `subprocessor-diff` cron runs weekly; compares vendor subprocessor pages against last known snapshot
- Changes detected: alert email to founder + entry in admin compliance feed
- Response required within 30 days: assess new subprocessor's scope + risk; update this document; notify clinic operators if subprocessor materially changes PHI handling
- Material subprocessor changes may require clinic operator consent under their applicable agreements

## 4. Procedures

### 4.1 Onboarding a new BAA vendor

1. Confirm vendor requires BAA (any vendor receiving PHI)
2. Request BAA from vendor's legal/compliance team
3. Review BAA terms: confirm breach notification provisions (45 CFR §164.410), permitted uses, return/destroy provisions on termination
4. Execute BAA (founder signs for LeanShot)
5. Upload signed PDF to `/legal/hipaa/baa/` with naming convention `<vendor>-baa-<YYYYMMDD>.pdf`
6. Update `vendor_baa_chain` row via Admin Compliance UI: set `status = 'signed'`, `baa_signed_at`, `baa_expiry_at`
7. Confirm vendor is now available for PHI routing

### 4.2 Annual BAA review

Each year, alongside annual risk assessment:
1. Confirm each vendor's BAA is current and covers all PHI categories LeanShot sends them
2. Review any vendor subprocessor changes from the prior year
3. Confirm all BAA PDFs are stored and accessible
4. Document review completion in this file (Revision History)

### 4.3 Vendor offboarding

When terminating a BAA vendor relationship:
1. Cease sending PHI immediately
2. Confirm vendor has returned or destroyed PHI per BAA terms
3. Retain BAA document for 6 years
4. Update `vendor_baa_chain` row to `status = 'terminated'`

## 5. Responsibilities

- **Founder**: executes all BAAs; monitors expiry alerts; manages subprocessor change responses
- **Admin Compliance UI**: real-time status tracking for all BAA rows; expiry banner display
- **Drata**: automated compliance evidence collection for BAA status

## 6. Enforcement

Operating without a signed BAA for a vendor that receives PHI is a HIPAA violation. This policy is enforced technically (email-router PHI split; AI clinical credential isolation) and procedurally (expiry alerts; access gated on `baa_guard` status in Edge Functions). CI tests assert the BAA guard refuses non-BAA model calls with HTTP 403.

## 7. Revision History

| Date | Author | Change |
|------|--------|--------|
| 2026-05-17 | Karsten Haldan | Initial version (Phase 25 Plan 25-10) |
