---
phase: 7
slug: compliance-foundations-legal-counsel-led
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-12
source: 07-RESEARCH.md §Validation Architecture
---

# Phase 7 — Validation Strategy

> Per-phase validation contract. Sourced from `07-RESEARCH.md` §Validation Architecture (lines 761-803). Planner extends per-plan during execute-phase.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (unit) + React Testing Library (component) + Playwright (e2e) + supabase-js cross-tenant RLS proofs |
| **Config files** | `leanshot/vitest.config.ts`, `leanshot/playwright.config.ts`, `leanshot/vitest-e2e.config.ts` |
| **Quick run command** | `npm run test:unit` (vitest + RTL) |
| **Full suite command** | `npm run test:unit && SUPABASE_SERVICE_ROLE_KEY=… npm run test:e2e:rls && npm run test:e2e` |
| **Estimated runtime** | ~5s unit / ~30s RLS / ~7min e2e (11 specs + new) |

---

## Sampling Rate

- **Per task commit:** `npm run typecheck && npm run lint && npm run test:unit` (vitest fast loop)
- **Per wave merge:** + `npm run test:e2e` (Playwright) + `npm run test:e2e:rls` (cross-tenant RLS) + `npm run build && bash scripts/assert-bundle-budget.sh`
- **Phase gate:** all above green + manual HBNR runbook review
- **Max feedback latency:** ~5 seconds per task

---

## Per-Phase Requirement → Test Map

| Req | Plan(s) | Test type | Specific test file(s) | Status |
|---|---|---|---|---|
| COMPL-01 (privacy policy reachable + lists 17 categories) | 07-02 | e2e + content-grep | `e2e/legal-pages.spec.ts` | ⬜ pending (Wave 0) |
| COMPL-02 (CHDP linked + 5 WMHMDA structural anchors) | 07-03 | e2e + content-grep | `e2e/legal-pages.spec.ts` | ⬜ pending (Wave 0) |
| COMPL-03 (HBNR runbook + 60d clock + decision tree) | 07-04 | unit | `src/test/compl-03-runbook.test.ts` | ⬜ pending (Wave 0) |
| COMPL-06 export (JSON + lazy-chunked PDF) | 07-05 | unit + e2e + bundle | `src/test/export-data.test.ts`, `e2e/settings-export.spec.ts`, `scripts/assert-bundle-budget.sh` | ⬜ pending (Wave 0) |
| COMPL-06 delete (typed-confirm → soft-delete row → T+30 cron → zero rows) | 07-06 | e2e + RLS | `e2e/account-delete.spec.ts` | ⬜ pending (Wave 0) |
| D-04 audit log (trigger fires + RLS isolation) | 07-07 | unit + RLS proof | `src/test/audit-trigger.test.ts`, `e2e/rls-audit-logs.test.ts` | ⬜ pending (Wave 0) |
| D-05 restore-from-backup | 07-08 | unit + e2e | `SettingsPage.test.tsx`, `e2e/restore-from-backup.spec.ts` | ⬜ pending (Wave 0) |
| D-06 `s.user!` sweep | 07-09 | shell + existing | `! grep -rn "s\.user!" leanshot/src/` + full test suite | ✅ existing tests cover behavior |
| D-07 e2e re-enable (7 deferred specs) | 07-01 (FIRST) | shell + e2e | `! grep -rn "DEFERRED:" leanshot/e2e/` + `npm run test:e2e` | ⬜ pending (Wave 0 = unfixme + root-cause fixes) |

---

## Wave 0 Gaps

- [ ] `leanshot/e2e/legal-pages.spec.ts` — footer link resolution + WMHMDA + privacy structural-anchor greps
- [ ] `leanshot/src/components/dashboard/settings/SettingsPage.test.tsx` extensions — restore-from-backup confirmation flow + delete-account typed-confirm
- [ ] `leanshot/e2e/account-delete.spec.ts` — full T+0 → admin verifies pending_account_deletions row → simulated T+30 cron tick → admin verifies zero rows across all tables
- [ ] `leanshot/e2e/rls-audit-logs.test.ts` — cross-tenant RLS proof for new audit_logs table (extends the Phase 6 `rls-multi-table.test.ts` pattern)
- [ ] `leanshot/e2e/settings-export.spec.ts` — JSON + PDF export downloads + bundle assertion that jsPDF is lazy-chunked
- [ ] `leanshot/e2e/restore-from-backup.spec.ts` — seed `leanshot_v4_pre_cloud_backup` → click Restore → assert state replaced + sign-out triggered
- [ ] `leanshot/src/test/audit-trigger.test.ts` (Vitest + Supabase test client) — insert into injections fires audit_logs row with correct before/after hashes
- [ ] `leanshot/scripts/assert-bundle-budget.sh` extension — assert `dist/assets/jspdf-*.js` chunk exists and is NOT in the index chunk
- [ ] `.planning/runbooks/incident-response-hbnr.md` — HBNR runbook (60-day clock, breach-decision tree, sole-founder on-call escalation)

---

## CI Gate Additions (must stay green from end of Phase 7 forward)

- **D-07 (07-01):** `npm run test:e2e` returns 11+ pass / 0 fail (no `test.fixme` markers remain) — first plan to ship
- **D-04 RLS proof:** `rls-audit-logs.test.ts` runs in CI on every PR (extends the parameterized cross-tenant test pattern Phase 5/6 established)
- **Bundle-size guard:** jsPDF MUST be in a lazy-loaded chunk; the existing 50 kB index gz ceiling stays in force
- **COMPL-01/02 content-grep:** legal pages must contain the 5 WMHMDA structural anchors (categories, sources, shared, third parties, rights mechanism) per RCW 19.373.030

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| HBNR runbook completeness | COMPL-03 | Substantive accuracy of an incident-response runbook is a judgment call, not a content-grep | Founder reviews against Federal Register 16 CFR §318 + internal threat model; signs off in `.planning/decisions/COMPL-03-RUNBOOK-REVIEW.md` |
| Privacy policy + CHDP self-draft accuracy | COMPL-01, COMPL-02 | D-01 explicitly accepts the WMHMDA private-right-of-action risk without attorney review | Founder reads the final published copy end-to-end against the 5 WMHMDA structural anchors before deploy |
| Account-delete end-to-end with real email | COMPL-06 | Soft-delete + magic-link-undo email round-trip relies on Supabase's email provider in the live environment | Founder triggers a delete on a personal test account, receives + clicks the undo link, verifies account is restored |

---

## Validation Sign-Off

- [ ] Every requirement above has at least one named test
- [ ] Wave 0 stubs created before plan execution
- [ ] Bundle-size + RLS + e2e CI gates explicit
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s on the quick loop
- [ ] `nyquist_compliant: true` set in frontmatter (planner sets after Wave 0 stubs land)

**Approval:** pending (will flip on Wave 0 completion)

---

*Phase: 07-compliance-foundations-legal-counsel-led*
*Sampling rate: per-task quick run + per-wave full run + phase-close + manual HBNR review*
*Status: draft (Wave 0 not yet executed)*
