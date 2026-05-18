# Annual Risk Assessment Policy

**Version:** 1.0
**Last Reviewed:** 2026-05-17
**Next Review Due:** 2027-05-17 (annual)
**Owner:** Founder (Karsten Haldan)
**Applies To:** All LeanShot employees, contractors, and systems processing PHI

## 1. Purpose

Conduct and document an accurate and thorough assessment of potential risks and vulnerabilities to the confidentiality, integrity, and availability of PHI held by LeanShot, as required by HIPAA Security Rule 45 CFR §164.308(a)(1)(ii)(A).

## 2. Scope

All electronic PHI (ePHI) created, received, maintained, or transmitted by LeanShot and its subprocessors. Follows NIST SP 800-30 Rev. 1 methodology.

## 3. Policy

### 3.1 Annual cadence

- First risk assessment due: by 2027-05-17 (one year from this policy's effective date)
- Subsequent assessments: annually, within 30 days of the anniversary
- Triggered additionally by: significant system change (new vendor, new PHI field type, new feature touching PHI), security incident, or regulatory change
- Drata tracks and schedules completion; completion documented in Revision History

### 3.2 Next scheduled assessment

**Next assessment due: 2027-05-17**

### 3.3 Annual tabletop exercise

A tabletop breach-notification exercise is conducted annually alongside the risk assessment:
- Duration: approximately 3 hours
- Participants: founder + any on-call ops / contractors with PHI access
- Scenario: hypothetical SEV-1 PHI exposure (e.g., misconfigured RLS allows cross-patient data access discovered via user report)
- Outcome: exercise report stored at `/legal/hipaa/tabletop-YYYY.md`
- Next tabletop due: 2027-05-17

## 4. Procedures

### 4.1 Risk assessment template

Complete the following sections each year. The completed document serves as evidence for Drata and future auditors.

**Section A: Scope and asset inventory**

List all systems that create, receive, maintain, or transmit ePHI:

| System | Vendor | PHI types stored | BAA signed? |
|--------|--------|-----------------|------------|
| Supabase DB | Supabase | All PHI fields (see data-classification.md) | Yes/No |
| Vercel (Edge Functions) | Vercel | PHI in transit (not stored) | Yes/No |
| Anthropic AI | Anthropic | Clinical conversation context | Yes/No |
| Sentry | Sentry | Masked error events (see Sentry masking policy) | Yes/No |
| PostHog | PostHog | Scrubbed analytics events | Yes/No |
| AWS SES | AWS | PHI email content in transit | Yes/No |

**Section B: Threat sources**

| Threat source | Type | Examples relevant to LeanShot |
|--------------|------|-------------------------------|
| External attackers | Environmental | SQL injection, credential stuffing, API abuse |
| Malicious insider | Human | Unauthorized clinician access beyond role scope |
| Unintentional insider | Human | Misconfigured RLS, PHI in Stripe metadata |
| Subprocessor breach | Environmental | Vendor suffers breach affecting LeanShot PHI |
| Natural/physical | Environmental | Data center outage, device theft |

**Section C: Vulnerabilities**

Review current vulnerability posture annually:
- [ ] All dependency CVEs addressed (npm audit, Deno scan)
- [ ] RLS policies reviewed for all PHI-adjacent tables
- [ ] MFA enforcement active for all clinician accounts
- [ ] BAA chain complete for all PHI-receiving vendors
- [ ] Sentry data-sentry-mask coverage verified (CI audit passes)
- [ ] Stripe PHI keyword lint passes with zero violations
- [ ] phi_access_log coverage verified for all PHI surfaces

**Section D: Likelihood and impact ratings**

Rate each threat × vulnerability combination using:
- Likelihood: Low / Medium / High
- Impact: Low / Medium / High (based on PHI volume, sensitivity, number of individuals affected)

| Threat | Vulnerability | Likelihood | Impact | Risk Level | Current Mitigation |
|--------|--------------|-----------|--------|-----------|-------------------|
| External attacker | SQL injection | Low | High | Medium | RLS policies + parameterized queries + Supabase WAF |
| External attacker | Credential stuffing | Medium | High | High | MFA enforcement for clinicians + Supabase rate limits |
| Insider - unauthorized access | Role escalation | Low | High | Medium | Role-based RLS + quarterly access review |
| Subprocessor breach | Vendor PHI exposure | Low | High | Medium | BAA chain + minimal data sharing per vendor scope |
| Accidental PHI disclosure | Stripe metadata | Low | Medium | Low | CI Stripe PHI lint enforces boundary |

**Section E: Risk register and mitigations**

List accepted risks with owner and residual risk acknowledgment. For each High or Medium risk, document the mitigation plan and target completion date.

**Section F: Residual risk acceptance signoff**

I, [Founder Name], have reviewed the above risk assessment dated [Date]. I accept the residual risks described in Section E as within LeanShot's risk tolerance for this assessment period. The controls in place provide reasonable and appropriate protection of ePHI given the current threat landscape and LeanShot's operational stage.

Signature: _________________ Date: _____________

### 4.2 Tabletop exercise template

**Scenario**: [Describe a realistic PHI exposure scenario. Example: A clinician reports being able to see another clinic's patient list in the roster UI. Investigation reveals an RLS policy was accidentally dropped during a migration 48 hours ago. Approximately 200 patient records were potentially visible to 5 clinicians across 2 competing clinics.]

**Exercise agenda (3 hours)**:

1. (30 min) Read scenario; initial triage — who was exposed? What PHI? When did it start?
2. (30 min) Containment decision — what steps are taken in the first 4 hours?
3. (30 min) Breach vs. non-breach determination — apply four-factor analysis
4. (30 min) Individual notice — draft notice text; identify delivery method
5. (30 min) HHS notification — complete mock HHS portal form
6. (30 min) Post-incident review — what would have prevented this? What policy gaps exist?

**Exercise outcome document**: Record findings, gaps identified, and any policy updates triggered by the exercise in `/legal/hipaa/tabletop-YYYY.md`.

## 5. Responsibilities

- **Founder**: conducts risk assessment; signs residual risk acceptance; leads tabletop exercise
- **External security reviewer (optional)**: for first clinic deal, an external HIPAA security assessor review of this document is recommended
- **Drata**: schedules assessment; collects completed document as compliance evidence

## 6. Enforcement

Failure to conduct an annual risk assessment is a violation of 45 CFR §164.308(a)(1)(ii)(A) and is an audit finding under SOC 2 CC3.1 (risk assessment). Drata will flag the missing completion in the controls dashboard.

## 7. Revision History

| Date | Author | Change |
|------|--------|--------|
| 2026-05-17 | Karsten Haldan | Initial version (Phase 25 Plan 25-10) |
