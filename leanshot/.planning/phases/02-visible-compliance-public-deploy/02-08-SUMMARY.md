---
phase: 02-visible-compliance-public-deploy
plan: 8
subsystem: deploy-ci-uat
tags: [ci, lighthouse, vercel, uat, gates]
requires: [02-03, 02-07]
provides: [lighthouse-ci-gate, human-uat-checklist]
affects: [.github/workflows/ci.yml, leanshot/lighthouserc.json, leanshot/.planning/phases/02-visible-compliance-public-deploy/02-HUMAN-UAT.md, leanshot/package.json]
tech-stack:
  added: ["@lhci/cli@0.15.1 (devDependency)", "patrickedqvist/wait-for-vercel-preview@v1.3.2 (CI action)"]
  patterns: [PR-only-gate, vercel-preview-discovery, temporary-public-storage-upload]
key-files:
  created:
    - leanshot/lighthouserc.json
    - leanshot/.planning/phases/02-visible-compliance-public-deploy/02-HUMAN-UAT.md
  modified:
    - .github/workflows/ci.yml
    - leanshot/package.json
    - leanshot/package-lock.json
decisions:
  - "D-25 implemented: Lighthouse CI gate as a 7th job, PR-only via if: gate, needs all 6 prior jobs so preview-wait time is not burned on broken PRs."
  - "Upload target: temporary-public-storage (no Vercel/LHCI Server token required) — keeps the gate self-contained for Phase 2."
  - "Two human checkpoints (Tasks 3+4) intentionally remain open: Vercel project creation + post-deploy smoke matrix cannot be automated from this branch without dashboard credentials."
metrics:
  duration_minutes: 5
  completed: 2026-05-11
  tasks_completed_by_claude: 2
  tasks_pending_human: 2
---

# Phase 2 Plan 8: CI Lighthouse Gate + Human UAT Checklist Summary

PR-only Lighthouse CI gate landed (`@lhci/cli@0.15.1` + `lighthouserc.json` + 7th `lighthouse` job in `ci.yml`) and the full Phase 2 human UAT checklist (Vercel projects, env-var matrix, deployed-CSP smoke, Sentry source-map verification, watermark-survives-screenshot) is captured in `02-HUMAN-UAT.md`. Two human-gated checkpoints (Vercel setup + post-deploy smoke) intentionally remain open for the human to drive.

## What was built (Claude-automatable scope)

### Task 1 — `lighthouserc.json` + `lighthouse` CI job (commit `34c8412`)

- **`leanshot/lighthouserc.json`** at the LHCI default-discovery path:
  - `numberOfRuns: 3`, `preset: "desktop"`.
  - Asserts `categories:performance >= 0.9`, `categories:accessibility >= 0.9`, `categories:best-practices >= 0.9` as **errors** (gate-failing).
  - Upload target: `temporary-public-storage` — no auth, no LHCI Server, no Vercel token.
- **7th job in `.github/workflows/ci.yml`** (`lighthouse`):
  - PR-only via `if: github.event_name == 'pull_request'` (D-25).
  - `needs: [lint, format-check, typecheck, test-unit, test-e2e, compliance-copy]` so a broken PR never burns the 5-minute Vercel-preview wait.
  - `patrickedqvist/wait-for-vercel-preview@v1.3.2` resolves the deployment URL from GitHub's deployment-status events that Vercel writes; no Vercel token needed.
  - `npx --yes @lhci/cli@0.15.1 autorun --collect.url=${{ steps.wait.outputs.url }}` collects against the discovered preview URL and asserts against the assertions block from `lighthouserc.json` (auto-discovered via the repo's `defaults.run.working-directory: leanshot`).
- **`@lhci/cli@0.15.1`** pinned as a devDependency in `leanshot/package.json` so a local `lhci collect` works as a manual fallback (Section E of the UAT).

### Task 2 — `02-HUMAN-UAT.md` (commit `0b635de`)

130-line checklist covering 7 sections:

- **A** — 2 Vercel projects (SPA + marketing) with project name + root directory + marketing-only Configuration Override (paste `vercel.marketing.json`).
- **B** — env-var matrix per project × environment (D-18/19/20). SPA matrix has 7 vars across Production / Preview / Development; marketing has 1 (`VITE_SPA_URL`) and is intentionally Sentry/PostHog-free per D-19.
- **C** — 11 post-deploy smoke checks: HTTPS, marketing reachable, marketing → SPA handoff, fonts under CSP, AI coach under CSP (`api.anthropic.com`), photo upload (`blob:` in img-src), PostHog Replay (`worker-src`), disclaimer Step 0 (D-08), dashboard fallback (D-11), watermark survives screenshot (SC#3), watermark scoped to MedLevelChart only (D-14).
- **D** — Sentry release populated, symbolicated test error (with the S-10 caveat that `phase-1-sentry-smoke` is stripped from production builds), PostHog events arrive metadata-only.
- **E** — Lighthouse scores ≥ 90 (with manual `lhci collect` fallback if CI is unavailable).
- **F** — CI verification on a real PR (compliance-copy + lighthouse jobs) including a sanity-check throwaway PR that adds `depression` to confirm the compliance-copy job exits red.
- **G** — Deferred items (custom domain D-02, CSP report endpoint, Tailwind v4 unsafe-inline removal, WMHMDA copy variants, DoctorReport PDF disclaimer, Phase 2.1 if Performance < 90).

## What is NOT built (and why)

### Tasks 3+4 — `checkpoint:human-action` and `checkpoint:human-verify`

These are **deliberately left open** for the human:

- **Task 3 (human-action):** Create the 2 Vercel projects, set env vars per the B matrix, paste the marketing Configuration Override JSON. Requires Vercel dashboard credentials Claude does not have on this branch.
- **Task 4 (human-verify):** Walk through Sections C–F of `02-HUMAN-UAT.md` against the deployed SPA + marketing URLs. Visual + behavioral verification (CSP doesn't break the AI coach, watermark survives a screenshot, Sentry receives a symbolicated test error).

## Verification

- `python3 -c "import json; json.load(open('lighthouserc.json'))"` — JSON parses ok.
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` — YAML parses ok.
- `grep -c "lighthouse:" .github/workflows/ci.yml` → `1` (single new job, no duplication).
- `npm run build` → exits 0; vendor-charts 71.20 kB gz, vendor-motion 38.24 kB gz, vendor-telemetry 93.11 kB gz, vendor-icons 6.42 kB gz, vendor-react 2.99 kB gz — 5-chunk manualChunks shape from 02-02 still intact, no regression.
- `02-HUMAN-UAT.md`: 130 lines, all 7 sections (A–G) present, 11 Section-C checks listed, Sentry + PostHog covered in Section D.
- `@lhci/cli@0.15.1` present in `leanshot/package.json` devDependencies; `package-lock.json` updated.

## Decisions Made

- **`needs:` chains AFTER all 6 prior jobs.** Per D-25 + the plan's interfaces note: Lighthouse only runs when everything else is green. Saves CI minutes on broken PRs (Vercel preview wait is up to 300s).
- **`temporary-public-storage` upload target.** No LHCI Server, no Vercel auth. Reports become public URLs printed in the CI log; acceptable for Phase 2 (a non-PHI marketing surface).
- **Pin `@lhci/cli@0.15.1` in devDependencies.** Per the plan: pinning prevents drift if `npx --yes @lhci/cli@latest` ships a breaking minor mid-PR. The CI step still uses `npx --yes @lhci/cli@0.15.1` explicitly so the version is asserted at both layers.
- **`if: github.event_name == 'pull_request'`.** PR-only per D-25 planner choice — per-PR gate, not a per-merge regression gate. (Push-to-main runs the other 6 jobs; Lighthouse is only meaningful when there is a Vercel preview, which only exists for PRs.)

## Deviations from Plan

None — plan executed exactly as written, including:
- `@lhci/cli@0.15.1` install (Task 1.1).
- `lighthouserc.json` content (Task 1.2) verbatim from the plan.
- 7th-job YAML (Task 1.3) verbatim from the plan, appended after `compliance-copy`.
- `02-HUMAN-UAT.md` (Task 2) covers all 7 sections (A–G), all 11 Section-C smoke checks, and includes the Phase 1 / S-10 note that `phase-1-sentry-smoke` is stripped from production.

## Threat Surface

No new network endpoints, auth paths, file-access patterns, or trust boundaries introduced. The Lighthouse job runs ENTIRELY against the public Vercel preview URL; it consumes no secrets beyond `secrets.GITHUB_TOKEN` (which is already used by checkout) and writes its report to `temporary-public-storage` (LHCI's HTTP storage, not user-controlled). No `threat_flag:` entries needed.

## Self-Check: PASSED

- [x] `leanshot/lighthouserc.json` exists (verified via JSON parse).
- [x] `leanshot/.planning/phases/02-visible-compliance-public-deploy/02-HUMAN-UAT.md` exists (130 lines).
- [x] `.github/workflows/ci.yml` modified (single new `lighthouse:` block).
- [x] `leanshot/package.json` lists `@lhci/cli` in devDependencies.
- [x] Commit `34c8412` exists in `git log` (Task 1: ci + lighthouserc + lhci dep).
- [x] Commit `0b635de` exists in `git log` (Task 2: HUMAN-UAT.md).
- [x] No edits made to `STATE.md` or `ROADMAP.md` (orchestrator owns those writes).
- [x] No edits made under `/Users/karstenhaldan/minisite/*` outside the worktree.

## Pending (human-driven)

- Task 3 — `checkpoint:human-action` — Vercel project creation + env vars + marketing Configuration Override. Resume signal: "Vercel projects ready" with URLs.
- Task 4 — `checkpoint:human-verify` — Sections C–F of `02-HUMAN-UAT.md`. Resume signal: "Phase 2 UAT complete" with recorded Lighthouse scores.

When both checkpoints close, this SUMMARY should be amended with the recorded Lighthouse scores and the two Vercel URLs (per the plan's `<output>` block) before marking Phase 2 fully closed.
