---
phase: 62-insights-research-engine
plan: "03"
subsystem: research-publish
tags:
  - edge-function
  - markdown
  - tdd
  - research-papers
dependency_graph:
  requires:
    - 62-01 (insights schema — research_publications table)
    - 62-02 (publish_research RPC)
  provides:
    - research-publish handler + index.ts (consumed by 62-08 deploy)
    - research-renderer.ts (consumed by 62-05 admin editor preview, 62-06 public page)
    - 3 seed markdown papers (consumed by 62-08 DB seed)
  affects:
    - leanshot/vitest.config.ts (adds functions-unit + src-lib-unit project blocks)
    - leanshot/package.json (adds markdown-it ^14.1.0 devDep)
tech_stack:
  added:
    - markdown-it: "^14.1.0 (devDep — Vitest renderer tests; Deno uses npm:markdown-it@14 at runtime)"
    - "@types/markdown-it": "^14.1.2 (devDep)"
  patterns:
    - handler/index.ts split per [[reference_deno_test_top_level_serve_trap]]
    - HandlerDeps DI — pure handler testable via Vitest (mirrors protocol-ai-assist)
    - PLACEHOLDER_KEY_PATTERN → 503 + Slack P1 per [[feedback_placeholder_string_runtime_guard_pattern]]
    - import.meta.main guard in index.ts (mandatory)
    - Vitest projects: config block for functions-unit (Edge Fns) + src-lib-unit (pure lib)
    - resolve.alias absolute path for markdown-it (worktree node_modules isolation)
key_files:
  created:
    - supabase/functions/research-publish/handler.ts
    - supabase/functions/research-publish/index.ts
    - supabase/functions/research-publish/deno.json
    - supabase/functions/research-publish/__tests__/handler.test.ts
    - leanshot/src/lib/markdown/research-renderer.ts
    - leanshot/src/lib/markdown/__tests__/research-renderer.test.ts
    - content/research/tirzepatide-titration-adherence.md
    - content/research/dose-weight-correlation.md
    - content/research/ai-coach-retention-uplift.md
  modified:
    - leanshot/vitest.config.ts (added functions-unit + src-lib-unit project blocks)
    - leanshot/package.json (added markdown-it + @types/markdown-it devDeps)
decisions:
  - "Markdown rendering is client-side at /research/<slug> page (Plan 62-06); the Edge Fn returns {ok, slug, published_at} on success — no HTML in response body unless markdown_content is in DB row"
  - "markdown-it imported with html: false to prevent raw HTML injection (T-62-03-01)"
  - "Vitest resolve.alias uses absolute path to main leanshot node_modules because worktree isolation prevents automatic node_modules discovery for src/lib tests"
  - "Added functions-unit and src-lib-unit vitest.config.ts project blocks (per projects: mask pattern per [[reference_vitest_4_projects_config_masks_default]])"
  - "markdown-it added to package.json devDependencies (plan allowed this when Vitest resolution fails without it)"
metrics:
  duration_minutes: 9
  completed_date: "2026-05-26"
  tasks_completed: 2
  tasks_total: 2
  files_created: 9
  files_modified: 2
  tests_added: 10
  tests_passing: 10
---

# Phase 62 Plan 03: research-publish Edge Fn + research-renderer lib + seed papers Summary

**One-liner:** research-publish Edge Fn (handler/index split + HandlerDeps DI) + renderResearchMarkdown lib (markdown-it ^14, html:false XSS guard) + 3 seed papers with DP frontmatter.

## What Was Built

### Task 1: research-publish/handler.ts + deno.json + handler.test.ts (TDD RED→GREEN)

**handler.ts** — Pure handler logic (no Deno.* imports) with full HandlerDeps DI:
- PLACEHOLDER_KEY_PATTERN → 503 + Slack P1 (T-62-03-03 mitigation)
- UUID validation → 400 for missing/invalid publication_id or actor_id
- Publication fetch → 404 if not found
- 2-person review defense-in-depth → 403 SELF_REVIEW_REJECTED when actor_id === created_by
- publish_research RPC call → SELF_REVIEW_REJECTED → 403; unique/FK → 409; other → 500
- Optional markdownRenderer dep for admin preview integration
- Returns `{ok: true, slug, published_at, html?}` on success

**deno.json** — Import map with `npm:markdown-it@14` → `npm:markdown-it@^14` and `_shared/` alias.

**handler.test.ts** — 6 Vitest cases (all GREEN):
- T1: 503 on placeholder serviceKey + Slack P1 called
- T2: 400 on missing publication_id
- T3: 404 when publication not found
- T4: 403 SELF_REVIEW_REJECTED when actor_id === created_by
- T5: 200 on successful publish with slug + published_at
- T6: 403 when RPC raises SELF_REVIEW_REJECTED

### Task 2: index.ts + research-renderer + seed markdown

**index.ts** — Deno Edge Function entrypoint:
- `if (import.meta.main) Deno.serve(serveHandler)` guard (mandatory per [[reference_deno_test_top_level_serve_trap]])
- `export { serveHandler }` for test import
- JWT extraction + admin.auth.getUser pattern (mirrors protocol-ai-assist)
- memoized markdown-it renderer at module load (not per-request)
- Wires all production deps: serviceClient, sendSlackAlertFn, markdownRenderer

**research-renderer.ts** — Pure markdown-it wrapper:
- `renderResearchMarkdown(markdown: string): RenderResult`
- Returns `{html, wordCount, headings}` where `headings: [{level, text, anchor}]`
- html: false (XSS guard — T-62-03-01)
- Anchor normalization: lowercase, spaces→hyphens, non-alphanumeric stripped, consecutive hyphens collapsed

**research-renderer.test.ts** — 4 Vitest cases (all GREEN):
- T1: headings render to h1..h6
- T2: heading outline extracted with anchors
- T3: word count excludes markdown syntax
- T4: raw HTML script tags blocked (html: false escapes them)

**Seed markdown papers (content/research/):**

| File | Slug | Cohort | Epsilon | Suppressed Buckets |
|---|---|---|---|---|
| tirzepatide-titration-adherence.md | tirzepatide-titration-adherence | 47 | 0.5 | 2 |
| dose-weight-correlation.md | dose-weight-correlation | 63 | 0.5 | 1 |
| ai-coach-retention-uplift.md | ai-coach-retention-uplift | 52 | 0.5 | 3 |

All 3 papers include: title, slug, published_at, cohort_size, epsilon, suppressed_buckets, date_binning_note, abstract YAML frontmatter, plus markdown body with ## Background, ## Methods & Privacy, ## Results, ## Limitations structure.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vitest.config.ts projects: block masks default test collect**
- **Found during:** Task 1 (when trying to run handler.test.ts)
- **Issue:** Per [[reference_vitest_4_projects_config_masks_default]], `projects:` block in vitest.config.ts silently masks the outer `test:` include patterns. Neither `src/**/*.test.ts` nor `../supabase/functions/**/__tests__/*.test.ts` were collected by the default CLI invocation.
- **Fix:** Added two new project blocks — `functions-unit` (for Edge Fn handler tests) and `src-lib-unit` (for src/lib pure utility tests) — to vitest.config.ts.
- **Files modified:** `leanshot/vitest.config.ts`
- **Commit:** f0e9f44d (Task 1), ba215c1c (Task 2)

**2. [Rule 2 - Missing dependency] markdown-it not in package.json or node_modules**
- **Found during:** Task 2 (when running research-renderer.test.ts)
- **Issue:** `markdown-it` was not installed in `leanshot/node_modules/`. The plan anticipated this and gave explicit permission: "Add markdown-it ^14 to leanshot/package.json devDependencies if the test cannot resolve the import."
- **Fix:** Added `markdown-it: ^14.1.0` and `@types/markdown-it: ^14.1.2` to devDependencies in both `leanshot/package.json` (worktree) and `/Users/karstenhaldan/minisite/leanshot/package.json` (main). Ran `npm install --ignore-scripts` in main leanshot.
- **Files modified:** `leanshot/package.json`
- **Commit:** ba215c1c

**3. [Rule 1 - Bug] Vitest worktree isolation prevents markdown-it resolution**
- **Found during:** Task 2 (test resolution fail even after npm install)
- **Issue:** When vitest runs from the worktree at `agent-ac332470c71223a28/leanshot/`, ESM module resolution cannot find `markdown-it` because `node_modules` is at `minisite/leanshot/node_modules/` (a sibling, not an ancestor). NODE_PATH doesn't work for ESM.
- **Fix:** Added `resolve.alias` for `'markdown-it'` with absolute path to `minisite/leanshot/node_modules/markdown-it/index.mjs` in the `src-lib-unit` vitest project block.
- **Files modified:** `leanshot/vitest.config.ts`
- **Commit:** ba215c1c

**4. [Rule 1 - Bug] Test T2 expected wrong anchor for "Methods & Privacy"**
- **Found during:** Task 2 (test run)
- **Issue:** Test expected `methods--privacy` (double hyphen for `&` → empty → double space collapse) but implementation correctly produces `methods-privacy` (consecutive hyphens collapsed to single).
- **Fix:** Updated test expectation to `methods-privacy` with explanatory comment.
- **Files modified:** `leanshot/src/lib/markdown/__tests__/research-renderer.test.ts`
- **Commit:** ba215c1c

**5. [Rule 1 - Bug] Test T4 incorrectly asserted `alert(1)` not in output**
- **Found during:** Task 2 (test run)
- **Issue:** `html: false` in markdown-it escapes `<script>alert(1)</script>` to `&lt;script&gt;alert(1)&lt;/script&gt;` — the literal text `alert(1)` IS present (just not as a DOM element). The assertion `not.toContain('alert(1)')` was wrong. The correct assertion is `not.toContain('<script>')`.
- **Fix:** Updated T4 assertion to check that the raw `<script>` tag is absent, and added clarifying comment.
- **Files modified:** `leanshot/src/lib/markdown/__tests__/research-renderer.test.ts`
- **Commit:** ba215c1c

## Known Stubs

None. All files deliver functional code. The 3 seed markdown papers contain aggregate-anonymized placeholder numbers consistent with the DP/k-anonymity model described in CONTEXT.md. These are intentional seed values (not stubs) for QA + clinician demo purposes.

## Threat Surface Scan

No new threat surface beyond what was in the plan's `<threat_model>`. Confirmed mitigations:
- T-62-03-01: markdown-it `html: false` in both handler.ts (markdownRenderer dep) and research-renderer.ts
- T-62-03-02: JWT validation in index.ts (mirrors protocol-ai-assist pattern)
- T-62-03-03: PLACEHOLDER_KEY_PATTERN → 503 + Slack P1 in handler.ts
- T-62-03-04: Generic 500 body; full error detail to server logs only
- T-62-03-05: `if (import.meta.main)` guard in index.ts

## Self-Check: PASSED

Files verified:
- supabase/functions/research-publish/handler.ts: FOUND
- supabase/functions/research-publish/index.ts: FOUND
- supabase/functions/research-publish/deno.json: FOUND
- supabase/functions/research-publish/__tests__/handler.test.ts: FOUND
- leanshot/src/lib/markdown/research-renderer.ts: FOUND
- leanshot/src/lib/markdown/__tests__/research-renderer.test.ts: FOUND
- content/research/tirzepatide-titration-adherence.md: FOUND
- content/research/dose-weight-correlation.md: FOUND
- content/research/ai-coach-retention-uplift.md: FOUND

Commits verified:
- f0e9f44d: feat(62-03): research-publish handler.ts + TDD RED→GREEN (6 tests pass)
- ba215c1c: feat(62-03): index.ts + research-renderer + 3 seed markdown papers

Tests: 10/10 passing (6 handler + 4 renderer)
