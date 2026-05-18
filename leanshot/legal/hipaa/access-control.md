# Access Control Policy

**Version:** 1.0
**Last Reviewed:** 2026-05-17
**Next Review Due:** 2027-05-17 (annual)
**Owner:** Founder (Karsten Haldan)
**Applies To:** All LeanShot employees, contractors, and systems processing PHI

## 1. Purpose

Define how access to LeanShot systems and PHI is granted, maintained, reviewed, and revoked in accordance with HIPAA Security Rule 45 CFR §164.312(a).

## 2. Scope

All LeanShot production systems: Supabase (database + auth), Vercel (hosting), GitHub (source), Sentry (error tracking), PostHog (analytics). Applies to all staff and contractors with access to any of these systems.

## 3. Policy

### 3.1 Role model

LeanShot uses a three-tier admin role model (`staff`, `admin`, `superadmin`) per Phase 24 D-04:

- **staff**: read-only access to assigned clinic roster; no PHI export; no admin UI
- **admin**: read-write on clinic configuration + patient data for assigned org; can invite staff
- **superadmin**: full platform access; restricted to founder + designated ops; MFA mandatory

Patient roles: `patient` (own data only), `shared_viewer` (time-limited read-only via share link).

### 3.2 Clinician MFA

Per Phase 25 D-10, clinician MFA is a hard requirement enforced at the application layer (`ClinicianMfaGuard`):

- First `/clinic/*` request post-Phase-25-deploy triggers an MFA enrollment gate
- TOTP (time-based one-time password) via Supabase Auth MFA
- Org-admin cannot defer or waive per-clinician MFA
- MFA enrollment status checked on every session; unenrolled sessions are blocked

### 3.3 Patient MFA

Per Phase 25 D-11, patient MFA is optional:

- Prompted during onboarding (skippable); visible in Settings at any time
- Mandatory email-OTP step-up for sensitive actions: account deletion, change clinic affiliation, full data export
- New-device challenge (Supabase Auth email-OTP) applies regardless of TOTP enrollment

### 3.4 Minimum necessary access

- API calls fetch only fields required by the requesting surface (HIPAA minimum-necessary principle)
- `phi_access_log` records clinician access to patient detail pages, photo viewer, dose-history exports, and conversation threads
- Aggregate-only operations (e.g., roster counts) do not log individual PHI rows

### 3.5 Periodic access review

- Quarterly: Drata automated access review pulls current user list from Supabase and GitHub
- Annual: founder reviews the full access list against role model; removes inactive accounts
- Triggered: immediately on any role change or staff departure

### 3.6 Third-party access

- Subprocessors (Anthropic, PostHog, Sentry, Vercel, Supabase, AWS SES) have BAA-scoped access only
- No subprocessor receives unmasked PHI beyond their BAA scope
- Subprocessor list tracked in `vendor_baa_chain` table + baa-management.md

## 4. Procedures

### 4.1 Access provisioning

1. New staff/contractor request received by founder
2. Role assigned per minimum-necessary principle (default: `staff`)
3. Supabase auth user created + role assigned via admin UI
4. GitHub, Vercel, Sentry, PostHog access granted at repository/project level only
5. 1Password (or equivalent) vault entry created for shared credentials
6. MFA enrollment required within 14 days for admin/superadmin roles; immediately for clinicians

### 4.2 Offboarding

On staff departure or contractor end-of-engagement (within 24 hours):

1. Revoke Supabase auth session + delete user record (or demote to inactive)
2. Remove from GitHub organization / revoke repository access
3. Remove from Vercel team
4. Remove from Sentry team
5. Remove from PostHog organization
6. Rotate any shared credentials the departing individual had access to
7. Document revocation in audit_logs

### 4.3 Incident-driven revocation

Suspected compromise triggers immediate revocation across all systems before investigation begins. See incident-response.md.

## 5. Responsibilities

- **Founder**: owns all provisioning and deprovisioning actions; quarterly access review signoff
- **Staff/contractors**: report suspected unauthorized access immediately to founder
- **Drata**: automated evidence collection for access review cadence

## 6. Enforcement

Violations of this policy (e.g., sharing credentials, bypassing MFA, accessing systems beyond role scope) are grounds for immediate access revocation and may be grounds for contract termination or legal action.

CI enforces role checks at the code level (RLS policies in Supabase; `ClinicianMfaGuard` in frontend). Automated tests in the CI pipeline assert access control is not bypassed.

## 7. Revision History

| Date | Author | Change |
|------|--------|--------|
| 2026-05-17 | Karsten Haldan | Initial version (Phase 25 Plan 25-10) |
