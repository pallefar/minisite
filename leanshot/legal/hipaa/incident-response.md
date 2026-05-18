# Incident Response Policy

**Version:** 1.0
**Last Reviewed:** 2026-05-17
**Next Review Due:** 2027-05-17 (annual)
**Owner:** Founder (Karsten Haldan)
**Applies To:** All LeanShot employees, contractors, and systems processing PHI

## 1. Purpose

Define how LeanShot detects, triages, contains, and reports security incidents, with specific focus on PHI exposure events governed by the HIPAA Breach Notification Rule (45 CFR §164.400-414).

## 2. Scope

All LeanShot production systems and personnel. An "incident" is any event that compromises or may compromise the confidentiality, integrity, or availability of PHI or LeanShot systems.

## 3. Policy

### 3.1 Severity classification

| Severity | Definition | Response SLA |
|----------|------------|-------------|
| SEV-1 | PHI exposure: confirmed or suspected unauthorized access, disclosure, or loss of PHI | Immediate (within 1 hour of detection) |
| SEV-2 | Service outage: production system unavailable to users (no PHI confirmed exposed) | Within 4 hours |
| SEV-3 | Degraded service: partial functionality loss; no PHI exposure; no full outage | Within 24 hours |

### 3.2 On-call

- Currently: founder (Karsten Haldan) is the sole on-call responder
- Escalation for compliance-relevant events (SEV-1): notify Drata compliance tooling
- Future: when second operator joins, implement PagerDuty rotation

### 3.3 HHS Breach Notification Rule SLA

For any confirmed breach of unsecured PHI:

- **60-day maximum SLA** from date of discovery to HHS notification (45 CFR §164.408)
- **60-day maximum SLA** for individual notice to affected patients (45 CFR §164.404)
- **Media notice** required if breach affects 500+ individuals in a single state (45 CFR §164.406)
- **Annual HHS log** of breaches affecting fewer than 500 individuals (45 CFR §164.408(c))

### 3.4 Annual tabletop exercise

An annual tabletop breach-notification exercise is required. Schedule is tracked in risk-assessment.md. Next exercise due: 2027-05-17.

## 4. Procedures

### 4.1 SEV-1 PHI Exposure Runbook

**Step 1: Detect**
- Source: Sentry error alert, PostHog anomaly, user report, automated phi_access_log anomaly, or vendor notification
- Confirm: query `phi_access_log` and `audit_logs` for unusual access patterns
- Declare SEV-1 if: (a) PHI confirmed accessed by unauthorized party, or (b) PHI potentially exposed and cannot be confirmed as contained

**Step 2: Triage (within 1 hour)**
- Identify affected data: which patients, which fields, how many records
- Identify timeline: when did exposure begin, when was it detected
- Identify vector: compromised credential, SQL injection, misconfigured RLS, subprocessor breach, or physical
- Document findings in a private incident log (NOT in public channels)

**Step 3: Contain (within 4 hours)**
- If credential compromise: revoke all affected sessions immediately (Supabase auth → Invalidate user sessions)
- If misconfigured access control: apply migration to fix RLS; verify fix with cross-tenant impersonation test
- If subprocessor breach: notify subprocessor; assess their incident report; determine LeanShot PHI scope
- If physical media: report to relevant authorities; document

**Step 4: Assess breach status (within 24 hours)**
- Apply the HIPAA four-factor analysis (45 CFR §164.402):
  1. Nature and extent of PHI involved (field types, number of records)
  2. Who accessed or used the PHI (or is likely to have accessed it)
  3. Whether PHI was actually acquired or viewed
  4. Extent to which risk has been mitigated
- Presumption of breach applies unless low-probability assessment is documented and signed

**Step 5: Notify HHS (within 60 days of discovery)**
- Prepare HHS notice via portal: https://ocrportal.hhs.gov/ocr/breach/wizard_breach.jsf
- Required fields: organization info, type of PHI, date of breach, date of discovery, individuals affected, safeguards in place, corrective actions taken
- Submit via HHS portal; retain confirmation + submission ID

**Step 6: Notify affected individuals (within 60 days of discovery)**
- Prepare individual notice per template in breach-notification.md
- Delivery method: first-class mail to last known address; email if individual authorized electronic notice
- If mail undeliverable for 10+ individuals: substitute notice (web posting 90 days + major print/broadcast media in affected area)
- If 500+ individuals in one state: media notice within 60 days

**Step 7: Post-incident review (within 30 days of resolution)**
- Update this policy if runbook gaps found
- Update training.md if training gap contributed
- Update Drata controls library with incident details
- Schedule additional tabletop exercise if warranted

### 4.2 SEV-2 Service Outage Runbook

1. Identify affected service (Supabase, Vercel, Edge Functions, DNS)
2. Check vendor status pages (status.supabase.com, vercel-status.com)
3. Post user-facing status to LeanShot status page (if implemented) or via email to active clinic operators
4. Engage vendor support if not a known vendor incident
5. Restore service; document RCA within 48 hours

### 4.3 SEV-3 Degraded Service

1. Log the degradation in audit_logs
2. Assess user impact; communicate via in-app banner if degradation affects clinic operators
3. Fix within standard engineering sprint cadence; no emergency response required

## 5. Responsibilities

- **Founder**: incident commander for all severity levels; HHS notification sender
- **Contractors**: report suspected incidents to founder immediately; do not attempt independent containment
- **Drata**: evidence collection for compliance audit trail

## 6. Enforcement

Failure to follow this runbook for a PHI exposure event constitutes a HIPAA violation and may result in HHS civil monetary penalties (up to $1.9M per violation category per year under 2024 penalty tiers). Founder is responsible for ensuring this policy is followed.

## 7. Revision History

| Date | Author | Change |
|------|--------|--------|
| 2026-05-17 | Karsten Haldan | Initial version (Phase 25 Plan 25-10) |
