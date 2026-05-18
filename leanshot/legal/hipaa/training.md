# Employee Security Training Policy

**Version:** 1.0
**Last Reviewed:** 2026-05-17
**Next Review Due:** 2027-05-17 (annual)
**Owner:** Founder (Karsten Haldan)
**Applies To:** All LeanShot employees, contractors, and systems processing PHI

## 1. Purpose

Ensure all LeanShot workforce members receive appropriate training on HIPAA requirements, data security practices, and LeanShot-specific policies before accessing PHI-bearing systems, and annually thereafter. Required under HIPAA Security Rule 45 CFR §164.308(a)(5).

## 2. Scope

All employees, founders, and contractors who have access to LeanShot systems processing PHI, including production database, admin UI, and any support tooling that touches patient data.

## 3. Policy

### 3.1 Initial training

- Required within 14 days of system access being granted
- Minimum content (per Drata HIPAA training module, 60-90 min):
  - HIPAA overview: covered entities, business associates, PHI definition
  - LeanShot-specific data handling (PHI fields, access control, logging)
  - Incident recognition and reporting (how to identify and escalate a suspected breach)
  - Acceptable use policy (no PHI in Slack, email, or unapproved channels)
  - Password and credential hygiene (password manager, MFA, no sharing)
  - Physical security (screen lock, unattended device policy)
- Acknowledgment signature (electronic via Drata) required to complete onboarding

### 3.2 Annual refresher

- Completed by December 31 each year
- Drata schedules and tracks completion automatically
- Minimum content: updated policy review + any changes from the prior year's incidents or regulatory updates
- Acknowledgment signature required; Drata records as evidence

### 3.3 Role-specific training

- **Clinicians / clinic admins**: additional training on PHI minimum-necessary access, `phi_access_log` accountability, patient rights under HIPAA
- **Engineers**: secure coding practices, RLS policy enforcement, CI lint requirements (Stripe PHI boundary, Sentry masking), migration safety

### 3.4 Training records

- Stored in Drata learning management system (LMS)
- Includes: employee name, training module, completion date, acknowledgment signature
- Retained for 6 years (HIPAA documentation retention requirement)

## 4. Procedures

### 4.1 New hire / contractor onboarding checklist

1. Grant system access (Supabase, GitHub, Vercel per role)
2. Send Drata training invite via email
3. Set 14-day deadline in Drata for training completion
4. Confirm acknowledgment in Drata before granting elevated permissions
5. Add to quarterly access-review list in Drata

### 4.2 Annual training cycle

1. Drata sends training reminders to all active workforce members in November
2. Complete training by December 31
3. Founder reviews Drata completion report in first week of January
4. Any incomplete training: access suspended until complete; notify contractor/employee
5. Update training.md if policy changes were made during the year

### 4.3 Breach-response training

After any SEV-1 incident (PHI exposure), a targeted training update is conducted within 60 days:
- Review what the workforce member did or should have done differently
- Update this policy and incident-response.md if runbook gaps identified
- Re-acknowledge updated policy

## 5. Responsibilities

- **Founder**: assigns training, monitors completion, updates training materials
- **Drata**: LMS hosting, automated reminders, completion tracking, evidence export for audits
- **All workforce members**: complete training on time, acknowledge policies, report incidents

## 6. Enforcement

Failure to complete required training within the deadline results in:
1. Notification from founder
2. If not resolved within 5 business days: access suspended to PHI-bearing systems until training is complete
3. Repeated non-compliance: grounds for contract termination

Training completion rates are part of the Drata SOC 2 evidence package. Incomplete training at audit time creates an audit finding.

## 7. Revision History

| Date | Author | Change |
|------|--------|--------|
| 2026-05-17 | Karsten Haldan | Initial version (Phase 25 Plan 25-10) |
