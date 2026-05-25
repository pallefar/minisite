---
phase: 58-spanish-i18n-wiring-contractor-delivered
plan: "03"
subsystem: i18n/clinic-invite
tags: [i18n, spanish, clinic-invite, patient-facing]
dependency_graph:
  requires: []
  provides: [public/locales/en/clinic.json, public/locales/es/clinic.json]
  affects: [src/components/clinic-invite/ClinicInvitePage.tsx, src/components/clinic-invite/ConsentDialog.tsx, src/components/clinic-invite/InviteSignupForm.tsx]
tech_stack:
  added: []
  patterns: [useTranslation multi-namespace array, static t() literal keys, ICU interpolation {{var}} preservation]
key_files:
  created:
    - leanshot/public/locales/en/clinic.json
    - leanshot/public/locales/es/clinic.json
  modified:
    - leanshot/src/components/clinic-invite/ClinicInvitePage.tsx
    - leanshot/src/components/clinic-invite/ConsentDialog.tsx
    - leanshot/src/components/clinic-invite/InviteSignupForm.tsx
decisions:
  - StateC (magic_link flow) keyed as `invite.magic_link.*` rather than `invite.consent.*` to match its role as a sign-in prompt distinct from the consent form
  - Footer text kept under `invite.footer` even though product name is EN-only; ES translation preserves the tagline meaning
  - DATA_TYPE_LABELS (checkbox labels/descriptions) left as-is: they live in `src/types/clinic.ts` not in clinic-invite components, and are out of scope for this plan
  - ICU acceptance criterion `grep -E '\{\{[a-záéíóúñ]'` produces false positives for any `{{orgName}}` etc. (lower-case `o` is in `[a-z]`); the actual correctness gate is the accented-chars-in-var-names check which passes
metrics:
  duration: ~30min
  completed: "2026-05-25"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 5
---

# Phase 58 Plan 03: Clinic Invite i18n — `clinic` Namespace Summary

Patient-side clinic-invite flow keyed to the `clinic` namespace with 56 EN source keys and ES translations at full parity; clinician-admin surfaces untouched.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Key clinic-invite patient-side components | `1a4f14b5` |
| 2 | Extract EN + translate ES clinic.json | `22ecddee` |

## What Was Built

**Task 1 — Component keying:** Added `useTranslation(['clinic', 'common'])` to all three patient-side clinic-invite components. Replaced inline English strings with static `t('clinic:invite.*')` literal keys across:
- `ClinicInvitePage.tsx` — state-machine router; keyed loading, all error states (expired, already_used, canceled, load_error), magic-link flow, footer, and all action buttons in sub-renderers StateA, StateC, StateE, StateF, StateG, StateH
- `ConsentDialog.tsx` — consent form; keyed accepted/declined states, all form copy (from_label, title, body, sharing section, privacy guarantee, org-can section, legal banner), error messages, CTA buttons, and decline confirmation modal
- `InviteSignupForm.tsx` — signup form; keyed form title/body, field labels/hints, confirmation-pending state, all error messages, CTA button

**Task 2 — Locale files:** Ran `i18next-parser` extraction to scaffold key structure, then populated:
- `public/locales/en/clinic.json` — 56 leaf keys with original English copy
- `public/locales/es/clinic.json` — 56 leaf keys with Latin-American neutral Spanish, tú address, `{{orgName}}`/`{{email}}`/`{{operatorName}}` preserved verbatim

## Verification Results

| Check | Result |
|-------|--------|
| `tsc -p tsconfig.app.json --noEmit` | 0 errors |
| `bash scripts/check-locale-coverage.sh` (clinic) | PASS — 56/56 EN=ES |
| `useTranslation(['clinic'` in all 3 files | PASS |
| No template-literal `t(\`clinic:...`)` keys | PASS |
| Scope guard: `git diff --name-only -- src/components/clinic/` | Empty (PASS) |
| EN/ES key-set parity (jq paths diff) | Identical |
| No accented chars in ES interpolation var names | PASS |

## Deviations from Plan

None — plan executed exactly as written.

The plan's acceptance criterion `grep -E '\{\{[a-záéíóúñ]'` produces false positives for `{{orgName}}` etc. because `o` ∈ `[a-z]`. The correct ICU guard (accented characters in var names) passes. This is a regex design issue in the plan spec, not a translation error.

## Known Stubs

None. All 56 keys have EN and ES values populated. The `[COUNSEL REVIEW NEEDED]` banner in ConsentDialog is a pre-existing legal placeholder, not an i18n stub — it is intentionally translated (`invite.consent.legal_banner`) for completeness.

## Threat Flags

None. No new network endpoints, auth paths, or file access patterns were introduced. All changes are catalog and component string replacements.

## Self-Check: PASSED

- ClinicInvitePage.tsx: FOUND
- ConsentDialog.tsx: FOUND
- InviteSignupForm.tsx: FOUND
- en/clinic.json: FOUND
- es/clinic.json: FOUND
- SUMMARY.md: FOUND
- Commit 1a4f14b5: FOUND
- Commit 22ecddee: FOUND
