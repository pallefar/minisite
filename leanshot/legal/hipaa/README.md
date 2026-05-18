# LeanShot HIPAA Policies

This directory is the **source of truth** for HIPAA and SOC 2 policy text. Git diff is the policy change history. Drata and Notion are downstream mirrors.

## Files

- access-control.md — role model + MFA posture + quarterly access review
- incident-response.md — SEV classification + IR runbook + 60-day HHS SLA
- breach-notification.md — HIPAA Breach Notification Rule (45 CFR §164.400-414) + notice templates
- training.md — annual security training cadence + new-hire checklist
- baa-management.md — vendor BAA chain + renewal process + subprocessor change protocol
- risk-assessment.md — annual risk assessment template + tabletop exercise + next-due date
- data-classification.md — PHI / PII / Public tiering + forbidden PHI locations + Stripe boundary

## Subdirectories

- `baa/` — signed BAA PDFs, named `<vendor>-baa-<YYYYMMDD>.pdf`
- `breach-reports/` — HHS submission confirmations + annual breach logs
- `soc2/` — SOC 2 Type I attestation PDF (when received from Drata auditor)
- `tabletop-YYYY.md` — annual tabletop exercise outcomes (one file per year)

## Sync direction

1. Edit markdown here (this repo is source of truth).
2. Commit and push to main.
3. `scripts/notion-mirror-hipaa-policies.mjs` runs in CI on push to main and mirrors changes to Notion.
4. Drata controls library evidence is uploaded manually during onboarding and annual refresh.

## Review cadence

- All policies: annual review (see "Last Reviewed" and "Next Review Due" fields per file).
- Quarterly: access-control review via Drata automated access review.
- After any incident: incident-response.md and breach-notification.md updated within 30 days.
- When new PHI field added: data-classification.md updated before the feature merges.

## HIPAA requirement coverage

| Policy file | HIPAA requirement(s) |
|-------------|---------------------|
| access-control.md | HIPAA-09, HIPAA-15 (MFA) |
| incident-response.md | HIPAA-18 (breach SLA + tabletop) |
| breach-notification.md | HIPAA-18 (Breach Notification Rule) |
| training.md | HIPAA-10 (employee training) |
| baa-management.md | HIPAA-11, HIPAA-12, HIPAA-13 |
| risk-assessment.md | HIPAA-18 (annual risk assessment) |
| data-classification.md | HIPAA-08, HIPAA-14 (data classification + access log) |
