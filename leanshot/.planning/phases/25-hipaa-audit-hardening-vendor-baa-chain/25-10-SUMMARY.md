---
phase: 25-hipaa-audit-hardening-vendor-baa-chain
plan: "10"
subsystem: hipaa-compliance-process
tags: [hipaa, policies, notion-mirror, drata, soc2, legal, training, risk-assessment]
dependency_graph:
  requires: [25-01, 25-02, 25-03, 25-04, 25-05, 25-06, 25-07, 25-08, 25-09]
  provides: [hipaa-policy-corpus, notion-mirror-ci, drata-onboarding-tracker]
  affects: [phase-verifier-25, soc2-type1-attestation]
tech_stack:
  added: [notion-mirror-mjs, node-test-runner, legal-hipaa-dir]
  patterns: [vendor-gated-exit-0, pattern-s3-log-status-only, repo-as-source-of-truth]
key_files:
  created:
    - leanshot/legal/hipaa/access-control.md
    - leanshot/legal/hipaa/incident-response.md
    - leanshot/legal/hipaa/breach-notification.md
    - leanshot/legal/hipaa/training.md
    - leanshot/legal/hipaa/baa-management.md
    - leanshot/legal/hipaa/risk-assessment.md
    - leanshot/legal/hipaa/data-classification.md
    - leanshot/legal/hipaa/README.md
    - leanshot/scripts/notion-mirror-hipaa-policies.mjs
    - leanshot/scripts/__tests__/notion-mirror-hipaa-policies.test.mjs
    - leanshot/.planning/phases/25-hipaa-audit-hardening-vendor-baa-chain/25-SECURITY.md
  modified:
    - .github/workflows/ci.yml
    - leanshot/.gitignore
decisions:
  - "repo /legal/hipaa/ is source of truth; Notion is downstream mirror; Drata supplements but does not replace repo"
  - "Notion mirror script uses zero-dep Node 22 ESM (no @notionhq/client); Pattern S3: log HTTP status only, never body"
  - "100-block Notion API limit documented as known T-25-10-T1 accepted risk; richer paginated approach is post-v1.3"
  - "Test suite uses node:test (not vitest) matching audit-privacy-manifest.test.mjs precedent; .mjs excluded from vitest include pattern"
  - "CI step runs only on push to main (if: github.ref == refs/heads/main) so mirror reflects merged canonical state"
  - "Drata onboarding tracked as human checkpoint; founder's task list with target dates in this SUMMARY"
metrics:
  duration: "~35 minutes"
  completed: "2026-05-18"
  tasks_completed: 2
  tasks_total: 3
  files_created: 11
  files_modified: 2
---

# Phase 25 Plan 10: HIPAA Compliance Process Layer Summary

**One-liner:** 7 HIPAA policy markdowns (access-control, incident-response, breach-notification, training, BAA-management, risk-assessment, data-classification) in `/legal/hipaa/` with zero-dep Notion mirror CI script and Drata onboarding human-checkpoint tracking.

## What Was Built

### Task 1: 7 policy markdowns + README (commit 3300dfe)

Created `/legal/hipaa/` directory with 8 markdown files:

| File | Lines | Key coverage |
|------|-------|-------------|
| access-control.md | ~100 | Role model (staff/admin/superadmin), MFA posture, quarterly access review, offboarding checklist |
| incident-response.md | ~120 | SEV-1/2/3 classification, PHI exposure runbook, 60-day HHS SLA, tabletop cadence |
| breach-notification.md | ~130 | 45 CFR 164.400-414, individual/HHS/media notice templates, annual breach log |
| training.md | ~100 | Initial + annual training via Drata, role-specific training, enforcement |
| baa-management.md | ~110 | 6-vendor BAA chain, Stripe/Resend exemptions, 60-day renewal process, subprocessor protocol |
| risk-assessment.md | ~130 | NIST SP 800-30, tabletop template, next due 2027-05-17, residual risk signoff |
| data-classification.md | ~130 | PHI/PII/Public tiering, forbidden PHI locations, Stripe boundary rules |
| README.md | ~45 | Index + repo-as-SoT/Notion-mirror explainer + HIPAA requirement coverage map |

Each policy file: standard 7-section template (Purpose, Scope, Policy, Procedures, Responsibilities, Enforcement, Revision History) + metadata block (Version, Last Reviewed, Next Review Due, Owner, Applies To).

### Task 2: Notion mirror script + test + CI wire (commit d5f4498)

**scripts/notion-mirror-hipaa-policies.mjs** (~180 lines):
- Zero deps; Node 22 ESM; uses `node:fs` and global `fetch`
- Vendor-gated: exits 0 with warning when `NOTION_API_TOKEN` or `NOTION_HIPAA_PARENT_PAGE_ID` missing
- Idempotent via `scripts/.notion-mirror-state.json` (gitignored) mapping filename to Notion page ID
- On update: deletes existing child blocks then appends fresh blocks (Notion API has no upsert)
- Markdown converter: heading_1/2/3, bulleted_list_item, paragraph — tables/code/images not supported (v1.3 scope)
- Known limitation: Notion API limits `children` to 100 blocks per call; files with >100 lines are truncated (T-25-10-T1 accepted)
- CLI flags: `--dry-run` (skip API calls), `--json` (emit JSON report)
- Pattern S3: log HTTP status code only in errors, never response body

**scripts/__tests__/notion-mirror-hipaa-policies.test.mjs** (10 tests, all passing):
1. No NOTION_API_TOKEN → exit 0 + warn
2. NOTION_HIPAA_PARENT_PAGE_ID missing with token → exit 0 + warn
3. markdownToBlocks: heading_1/2/3 conversions correct
4. markdownToBlocks: paragraph + empty-line conversions
5. markdownToBlocks: bulleted_list_item conversion
6. 100-block limit: 150-line file → converter produces all lines, slice(0,100) enforces cap
7. --dry-run exits 0
8. --json flag does not cause parse error
9. State file roundtrip: write + re-read same mapping
10. Network error → exits 1, e.name logged, error message NOT logged (body-leak guard)

**CI wire** (.github/workflows/ci.yml):
- Step name: "Notion mirror of HIPAA policies (Phase 25 HIPAA-11)" — unique vs existing 25-05/25-06 steps
- Runs in `test-e2e` job, conditional on `github.ref == refs/heads/main && github.event_name == push`
- Env: `NOTION_API_TOKEN` + `NOTION_HIPAA_PARENT_PAGE_ID` from GitHub Secrets (not yet set)
- Credential-missing: exits 0 (vendor-gated pattern) — CI does not fail until secrets configured

### Task 3: [CHECKPOINT — Awaiting Human Action]

Drata onboarding, employee training, first risk assessment, and vendor BAA signing are human-only tasks. Engineering deliverables are complete; founders tasks are tracked below.

---

## Drata Onboarding Tracker (Task 3 Human Gates)

Track completion dates here as items close:

| Item | Status | Target Date | Completed Date |
|------|--------|-------------|---------------|
| Drata MSA signed | Pending | 2026-06-01 | |
| Drata integrations connected (Supabase, GitHub, Vercel, Sentry, AWS, 1Password) | Pending | 2026-06-15 | |
| Employee security training (Drata HIPAA module, 60-90 min) | Pending | 2026-06-01 | |
| First annual risk assessment (walk through risk-assessment.md template, 3 hr) | Pending | 2027-05-17 | |
| First annual tabletop breach-notification exercise (3 hr) | Pending | 2027-05-17 | |
| Legal review of /legal/hipaa/*.md (external HIPAA counsel) | Pending | Before first clinic deal | |
| Notion parent page created + GitHub Secrets NOTION_API_TOKEN + NOTION_HIPAA_PARENT_PAGE_ID set | Pending | 2026-06-01 | |
| First Notion mirror CI run verified (merge policy edit to main; observe CI step succeed; confirm Notion page) | Pending | After Secrets set | |
| SOC 2 Type I attestation (Drata + auditor, ~6 weeks observation) | Pending | ~2026-08-01 | |
| PROJECT.md vendor table updated with Drata as signed vendor + costs | Pending | After MSA signed | |
| **6 vendor BAAs (minimum phase-close condition):** | | | |
| Supabase Team + HIPAA add-on | Pending | 2026-06-01 | |
| Vercel Pro + HIPAA add-on | Pending | 2026-06-01 | |
| Sentry Business + BAA | Pending | 2026-06-15 | |
| Anthropic Enterprise + BAA + ZDR | Pending | 2026-08-01 | |
| AWS SES BAA via AWS Artifact | Pending | 2026-06-01 | |
| PostHog tier confirmation (scrub-only, no add-on) | Pending | 2026-06-01 | |

**Minimum phase-close condition:** Drata MSA signed + Notion mirror operational + all 6 vendor BAA rows updated in Admin Compliance UI. SOC 2 Type I attestation may complete post-phase-close as a milestone-close gate.

---

## Deviations from Plan

None — plan executed as written for Tasks 1 and 2.

Task 3 is a `checkpoint:human-action` gate by design: engineering ships policy text + mirror script; founder handles vendor onboarding over a 4-8 week window.

---

## Known Stubs

None. All 7 policy files contain substantive content (not placeholder text). The Notion mirror state file (`scripts/.notion-mirror-state.json`) does not exist yet (gitignored; will be created on first successful mirror run).

---

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: credential-in-ci | scripts/notion-mirror-hipaa-policies.mjs | NOTION_API_TOKEN flows through CI; mitigated via GitHub Secrets + Pattern S3 (status-only logging) |

---

## Self-Check: PASSED

Files created:
- leanshot/legal/hipaa/access-control.md: FOUND
- leanshot/legal/hipaa/incident-response.md: FOUND
- leanshot/legal/hipaa/breach-notification.md: FOUND
- leanshot/legal/hipaa/training.md: FOUND
- leanshot/legal/hipaa/baa-management.md: FOUND
- leanshot/legal/hipaa/risk-assessment.md: FOUND
- leanshot/legal/hipaa/data-classification.md: FOUND
- leanshot/legal/hipaa/README.md: FOUND
- leanshot/scripts/notion-mirror-hipaa-policies.mjs: FOUND
- leanshot/scripts/__tests__/notion-mirror-hipaa-policies.test.mjs: FOUND
- leanshot/.planning/phases/25-hipaa-audit-hardening-vendor-baa-chain/25-SECURITY.md: FOUND

Commits:
- 3300dfe: docs(25-10): 7 HIPAA policy markdowns + README under legal/hipaa/ — FOUND
- d5f4498: feat(25-10): Notion mirror script + test + CI wire (HIPAA-11) — FOUND
