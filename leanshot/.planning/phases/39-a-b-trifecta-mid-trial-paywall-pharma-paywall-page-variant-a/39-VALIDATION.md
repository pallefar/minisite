---
phase: 39
slug: a-b-trifecta-mid-trial-paywall-pharma-paywall-page-variant
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-22
populated: 2026-05-22
---

# Phase 39 — Validation Strategy

> Per-phase validation contract. Inline-populated from plan `<verify><automated>` blocks per Dim 8e.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (unit + RLS) + Playwright (e2e + visual + a11y) + Deno test (Edge Fns) + pgTAP (SQL) |
| **Config files** | leanshot/vitest.config.ts, leanshot/vitest-e2e.config.ts, leanshot/playwright.config.ts, supabase/functions/*/deno.json |
| **Quick run command** | `cd leanshot && npx vitest run` |
| **Full suite command** | `cd leanshot && npm test` + `cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --allow-all --no-check supabase/functions/` |
| **Estimated runtime** | ~6 minutes full suite |

---

## Sampling Rate

- **After every task commit:** `cd leanshot && npx vitest run <touched-files>` (~30s)
- **After every plan wave merge:** Full vitest + cross-Fn Deno test sweep per `[[feedback_post_merge_deno_sweep_pattern]]` (~6min)
- **Before `/gsd:verify-work`:** Full suite green + `supabase db push --linked` no-op + 6 HUMAN-UAT signals dispositioned
- **Max feedback latency:** ~30s (per-task vitest)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------|-------------------|-------------|--------|
| 39-01-01 | 01 | 1 | PAYWALL-03, PAYWALL-04, PAYWALL-05, PAYWALL-07, PAGEAB-01, PAGEAB-03, PAGEAB-07, PHARMA-07 | T-39-01-01..06 | migration shape | `ls supabase/migrations/20270714000001..09_p39_*.sql \| wc -l == 9` + safety_category + composite_score greps | ❌ W0 | ⬜ pending |
| 39-01-02 | 01 | 1 | PAYWALL-04, PHARMA-04 | T-39-01-03 | migration + pgTAP | grep refunded_at + grep -q resolve_cohort_for_user + grep -v auth.uid() | ❌ W0 | ⬜ pending |
| 39-02-01 | 02 | 1 | PHARMA-02 | T-39-02-01..03 | RuleTester + eslint --print-config | `npx eslint --print-config src/App.tsx \| grep no-paywall-on-safety-category` + RuleTester 6 cases | ❌ W0 | ⬜ pending |
| 39-02-02 | 02 | 1 | PHARMA-02, PAGEAB-06 | T-39-02-04 | vitest | `npx vitest run src/lib/pharma/__tests__/phaCheck.test.ts src/lib/page-builder/__tests__/block-schema.test.ts` + lint:safety + variant_set_id grep | ❌ W0 | ⬜ pending |
| 39-03-01 | 03 | 2 | PAYWALL-02, PAGEAB-07, PHARMA-06 | T-39-03-01..05 | Deno test | `$HOME/.deno/bin/deno test --allow-all --no-check supabase/functions/variant-resolver/index.test.ts supabase/functions/slack-alert-experiments/index.test.ts supabase/functions/_shared/bayes-posterior.test.ts` | ❌ W0 | ⬜ pending |
| 39-03-02 | 03 | 2 | PAYWALL-04, PAGEAB-03, PHARMA-03 | T-39-03-04..09 | pgTAP + migration grep | timestamp count + cron.unschedule + $cron$ + decrypted_secrets + NO auth.uid() | ❌ W0 | ⬜ pending |
| 39-04-01 | 04 | 3 | PAYWALL-01, PHARMA-02 | T-39-04-01..02 | vitest | `npx vitest run src/lib/paywall src/lib/utm src/components/paywall/PaywallGate.test.tsx` | ❌ W0 | ⬜ pending |
| 39-04-02 | 04 | 3 | PAYWALL-01, PAYWALL-02, PAYWALL-05, PAYWALL-06, PAYWALL-07 | T-39-04-03..06 | vitest + grep | PaywallModal + OnboardingFlowPaywall tests + SCREENS literal | ❌ W0 | ⬜ pending |
| 39-05-01 | 05 | 3 | PHARMA-05, PHARMA-06 | T-39-05-01..06 | vitest | `npx vitest run src/lib/pharma/region-detect.test.ts src/lib/pharma/get-content-tier.test.ts src/components/pharma/SafetyInfoBadge.test.tsx` | ❌ W0 | ⬜ pending |
| 39-05-02 | 05 | 3 | PHARMA-01, PHARMA-02, PHARMA-07 | T-39-05-01..06 | vitest + RLS | `npx vitest run src/components/pharma/PharmaContentBlock.test.tsx` + rls-pharma-content-versions.test.ts | ❌ W0 | ⬜ pending |
| 39-06-01 | 06 | 4 | PAYWALL-06, PAGEAB-01, PHARMA-08 | T-39-06-01..02 | vitest + grep | manifest grep + AdminShell parity test + experiment-types.ts exists | ❌ W0 | ⬜ pending |
| 39-06-02 | 06 | 4 | PAGEAB-01, PAGEAB-07 | T-39-06-03..04 | vitest + grep | ExperimentDashboardPage tests + NO TanStack Query + NO inline arbitrary values | ❌ W0 | ⬜ pending |
| 39-07-01 | 07 | 5 | PAGEAB-07 | T-39-07-01..06 | vitest + pgTAP | BayesianBadge + ShipWinnerConfirmModal + TrafficSplitSlider tests + 2 RPC migrations + audit pgTAP | ❌ W0 | ⬜ pending |
| 39-07-02 | 07 | 5 | PAYWALL-03, PAYWALL-04, PAGEAB-03, PAGEAB-05, PAGEAB-07 | T-39-07-04 | vitest + grep | PaywallExperimentTab + PageExperimentTab + ExperimentDashboardPage tests + data-action=ship-winner grep | ❌ W0 | ⬜ pending |
| 39-08-01 | 08 | 5 | PHARMA-03, PHARMA-07, PHARMA-08 | T-39-08-01..02, T-39-08-05..06 | vitest + grep | PharmaVariantMetricsCard + PharmaVersionList tests + safety_categories_in_variant invariant + decrypted_secrets | ❌ W0 | ⬜ pending |
| 39-08-02 | 08 | 5 | PHARMA-04, PHARMA-08 | T-39-08-03..04, T-39-08-07 | vitest + e2e | PharmaExperimentTab tests + 2 Playwright specs + disable_pharma_variant grep | ❌ W0 | ⬜ pending |
| 39-09-01 | 09 | 5 | PAGEAB-02, PAGEAB-04, PAGEAB-06 | T-39-09-01..02, T-39-09-04 | Deno test | render.test.ts extended + variant_set_id + Vary + canonical_page_id greps | ❌ W0 | ⬜ pending |
| 39-09-02 | 09 | 5 | PAGEAB-01, PAGEAB-06 | T-39-09-03, T-39-09-05 | vitest + e2e | PageEditorView + BlockVariantDrawer tests + page-variant-create e2e | ❌ W0 | ⬜ pending |
| 39-10-01 | 10 | 6 | ALL 22 REQ-IDs | T-39-10-01..05 | infra + sweep | migration list + secrets list + cron.job count + tsc --noEmit | ❌ W0 | ⬜ pending |
| 39-10-02 | 10 | 6 | ALL 22 REQ-IDs | n/a (HUMAN-UAT) | manual | 6 discrete HUMAN-UAT signals per [[feedback_multi_signal_human_verify_checkpoint_pattern]] | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 file scaffolds (the 22 test files that don't yet exist on `main`) are owned by the plan that introduces them, listed in `files_modified` for each plan above. Plan executors create the test file as the first action of each TDD task (RED). No separate Wave 0 plan required.

Framework install: **NONE** — Vitest + Playwright + Deno test + pgTAP all already present in repo per RESEARCH §Validation Architecture.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Mid-trial paywall mounts post-activation for real trialing user | PAYWALL-01 | Requires session + activation event in remote DB | Plan 39-10 Task 2 Signal 1 |
| 6-screen onboarding paywall visual flow + Fraunces accent | PAYWALL-06 + D-14 | Visual verification of font + transition order | Plan 39-10 Task 2 Signal 2 |
| Page-variant canonical link in browser View Source | PAGEAB-02 | Server-rendered HTML inspection | Plan 39-10 Task 2 Signal 3 |
| Pharma safety badge visible alongside drug content | PHARMA-02 + D-05 | Visual + content compliance | Plan 39-10 Task 2 Signal 4 |
| Ship-Winner below-95% typed-confirm + audit row | D-12 | Admin workflow + DB query verification | Plan 39-10 Task 2 Signal 5 |
| Pharma disable + Slack alert in #growth-experiments | PHARMA-04 + D-04 | External Slack channel observation | Plan 39-10 Task 2 Signal 6 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify with concrete commands
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (Plan 39-10 Task 2 is the only HUMAN-UAT, follows 18 automated tasks)
- [x] Wave 0 scaffolds owned by introducing plans (TDD RED phase creates test files)
- [x] No watch-mode flags (`vitest run`, `--no-check`, `--prod`)
- [x] Per-task feedback latency < 30s (single-file vitest)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-22 (inline-populated per Dim 8e)
