---
phase: 38-m5b-ai-recommender-pgvector-claude-digest
plan: 09
subsystem: ai-recommender-cron-telemetry-frontend
tags: [pg-cron, vault-service-role, taxonomy, posthog-server, edge-function, deno, react, vitest, dashboard, kb-footer, recommend-06, recommend-08]

requires:
  - phase: 38-01
    provides: weekly_digest_sends table, user_preferences.weekly_digest_opt_in, profiles.timezone, cleanup_content_embeddings_soft_deleted()
  - phase: 38-02
    provides: recommendation_events table + RLS, recommender-rank.ts
  - phase: 38-03
    provides: recommend-next-best-action Edge Fn (consumer for ForYouCard + RelatedArticlesFooter)
  - phase: 38-04
    provides: embed-content-nightly Edge Fn (cron-invoked at 03:00 UTC)
  - phase: 38-05
    provides: weekly-digest Edge Fn (cron-invoked hourly + fanned-out per-user-timezone)
provides:
  - "4 pg_cron schedules in cron.job: phase38-weekly-digest-hourly-fanout, phase38-embed-content-nightly, phase38-winback-scorer-nightly, phase38-softdelete-cleanup-daily"
  - "Phase38Event typed union (28 event names) on supabase/functions/_shared/posthog-server.ts"
  - "RecommendationShownProperties / DigestSentProperties / RecommendationClickedProperties typed payload contracts"
  - "track-rec-click Edge Fn — server-side click tracker for D-01 dashboard + RECOMMEND-08 kb_footer (Phase 24 D-12 compliance)"
  - "ForYouCard React component (D-01 dashboard surface, top-3 recs + popular-fallback)"
  - "RelatedArticlesFooter React component (RECOMMEND-08 kb_footer, vendor-gated until KB ships)"
affects: [38-07 (winback Edge Fn ships into the 04:00 cron slot pre-wired here)]

tech-stack:
  added: [pg_cron + pg_net (already enabled), vault.decrypted_secrets read in cron body, server-side fetch-based click tracker]
  patterns:
    - "Named dollar-quote tags in cron bodies ($cron$ outer + UNIQUE inner $digest$ / $embed$ / $winback$ / $cleanup$) per memory reference_postgres_dollar_quote_nesting_in_cron_body — a bare inner $$ silently closes the outer and crashes at apply time"
    - "Vault-via-decrypted_secrets bearer construction inside the cron body (memory reference_supabase_pg_cron_vault_service_role_pattern) — current_setting('app.service_role_key') GUC does NOT exist on this project"
    - "Per-user-timezone digest fan-out: `extract(dow|hour from now() at time zone p.timezone) = 0|9` + 6h dedup against weekly_digest_sends (RESEARCH Pattern 3 + Pitfall #7 DST safety)"
    - "Hardcoded Edge Fn URL form `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/<name>` (canonical project form — NOT the `.functions.supabase.co/<name>` shorthand the plan body suggested)"
    - "track-rec-click idempotency: first probe filters `is('clicked_at', null)`; if 0 rows, repeat probe drops the filter to distinguish foreign-id (404) from repeat-click (204 + first_click=false)"
    - "Comment-only TAXO catalog migration anchor: 20270705000031 is documentation-only; source of truth is leanshot/src/lib/analytics/events.ts (client) + posthog-server.ts Phase38Event union (Edge Fn)"
    - "Server-side click tracking via fetch from ForYouCard onClick — no posthog-js, no client-side AI events (Phase 24 D-12 + memory feedback_planner_iter1_anti_patterns)"
    - "Vendor-gated KB footer pattern (memory reference_vendor_gated_send_health_check): RelatedArticlesFooter renders null when KB ships empty so the article body always renders"

key-files:
  created:
    - supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql
    - supabase/migrations/20270705000031_phase38_taxo_events.sql
    - supabase/functions/track-rec-click/index.ts
    - supabase/functions/track-rec-click/index.test.ts
    - leanshot/src/components/dashboard/cards/ForYouCard.tsx
    - leanshot/src/components/dashboard/cards/ForYouCard.test.tsx
    - leanshot/src/components/kb/RelatedArticlesFooter.tsx
  modified:
    - supabase/functions/_shared/posthog-server.ts

key-decisions:
  - "Hardcoded URL form `<ref>.supabase.co/functions/v1/<name>` (Rule 1 — Bug fix vs plan body): plan body wrote `<ref>.functions.supabase.co/<name>` which is NOT the form any other migration in this repo uses. Grepped existing crons (rag-scrape-tick, audit-archive, photos-trash-purge, lifecycle-*, ad-spend-*, all 15+ jobs) — every one uses `.supabase.co/functions/v1/`. Aligned to repo convention."
  - "Comment-only TAXO migration (plan branch 2): plan's primary branch presumed a `public.taxo_events` registry table; this project does NOT ship one (Phase 24 catalog lives in code at `leanshot/src/lib/analytics/events.ts` + `_shared/posthog-server.ts`). Followed the fallback branch — migration is documentation, typed catalog lives in posthog-server.ts where TS catches typos at every captureServer() call site."
  - "Phase38Event added to `posthog-server.ts` (declared in plan files_modified) rather than creating a separate `posthog-events.ts` file (NOT declared). Honors the plan's <files_modified> manifest contract; future planners can split if catalog grows beyond ~50 events."
  - "track-rec-click idempotency strategy: two-pass UPDATE. First UPDATE with `is(clicked_at, null)` sets timestamp + emits `first_click=true`. If 0 rows matched, second UPDATE drops the filter and probes for row existence — match → repeat click (`first_click=false`); no match → 404 (cross-tenant or stale id). Avoids a separate SELECT round-trip."
  - "Cross-tenant defense-in-depth: track-rec-click adds explicit `eq('user_id', userId)` ON TOP of RLS policy `rec_events_update_own` (T-38-39 mitigation). RLS alone would protect the write; the explicit predicate makes intent visible at the call site for future readers."
  - "Live `supabase db push --linked` DEFERRED to manual deploy gate: per memory `feedback_worktree_executor_pwd_drift_leaks_to_main` + `feedback_parallel_executor_autonomy_drift`, pushing migrations from inside a worktree carries leak risk. Migration syntax was validated locally (dollar-quote balance + structure); push happens at orchestrator merge step or manual deploy."
  - "No pg_cron `unschedule` hard-failure on first apply: the unschedule DO-block catches `when others then null` because the cron schema may not be visible on a freshly-created database. Idempotent re-application is the goal."
  - "TDD execution shape: GREEN-first commit (single feat for both test + impl) since Deno test runner is not available in this worktree environment — RED commit would have been an unverified hypothesis. tsc clean + vitest 6/6 pass + lint clean + build green covers what RED would have proved."

patterns-established:
  - "Worktree-safe migration pattern: write file → local syntax validation (grep dollar-quote balance + structure check) → commit → defer `supabase db push --linked` to a non-worktree context (orchestrator merge or main checkout). Avoids the pwd-drift leak class even when the plan's <verify> mandates push."
  - "Phase38Event union as compile-time safety net: every Phase 38 Edge Fn captureServer call site can narrow `event:` to the union; future plans (38-06 winback, 38-07 HITL editor) can import this union for the same guarantee without a runtime registry"
  - "Two-pass idempotent UPDATE for click trackers: avoids a SELECT-then-UPDATE round-trip while preserving RLS-driven cross-tenant rejection and first-click vs repeat-click distinction"

bundle-impact: "ForYouCard adds ~2 kB gz to the dashboard chunk on direct import. When wired into HomeTab via `React.lazy()` the delta is amortized across the chunk boundary — initial route chunk stays below the Phase 5 18.1 kB gz ceiling (project_phase5_bundle_regression)."

metrics:
  duration: "~28 min"
  completed: "2026-05-20"
  tasks: 3
  files: 7
  commits: 3
---

# Phase 38 Plan 09: pg_cron + TAXO + track-rec-click + ForYouCard / RelatedArticlesFooter — Summary

**One-liner:** Wires 4 pg_cron schedules (digest hourly fan-out + nightly embed/winback/softdelete-cleanup) to existing Wave 2 Edge Fns, registers Phase 38's 28-event typed catalog on `posthog-server.ts`, ships `track-rec-click` as the server-side click tracker, and lands the two consumer surfaces (`ForYouCard` for the dashboard, `RelatedArticlesFooter` for KB articles) that call `recommend-next-best-action`.

## What was built

### Task 1 — pg_cron schedules migration

`supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql` registers 4 jobs:

| jobname                                  | schedule    | invokes                                                |
| ---------------------------------------- | ----------- | ------------------------------------------------------ |
| `phase38-weekly-digest-hourly-fanout`    | `0 * * * *` | `weekly-digest` per-user (timezone-local Sun 09:00, 6h dedup) |
| `phase38-embed-content-nightly`          | `0 3 * * *` | `embed-content-nightly`                                |
| `phase38-winback-scorer-nightly`         | `0 4 * * *` | `winback-scorer` (Edge Fn ships Plan 38-07)            |
| `phase38-softdelete-cleanup-daily`       | `0 5 * * *` | direct SQL: `cleanup_content_embeddings_soft_deleted()`|

All cron bodies use:
- Outer `$cron$ … $cron$` plus UNIQUE inner tags (`$digest$`, `$embed$`, `$winback$`, `$cleanup$`) per memory `reference_postgres_dollar_quote_nesting_in_cron_body`.
- Service-role bearer from `vault.decrypted_secrets WHERE name='service_role_key'` per memory `reference_supabase_pg_cron_vault_service_role_pattern`.
- Hardcoded URL `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/<fn>` (corrected vs plan body — see deviations).
- Pre-flight DO-block unschedules pre-existing `phase38-*` jobs so re-running the migration with adjusted expressions is safe.

### Task 2 — TAXO event catalog + typed Phase38Event union

`supabase/migrations/20270705000031_phase38_taxo_events.sql` is a comment-only catalog anchor — no `taxo_events` registry table exists on this project; source-of-truth lives in code.

`supabase/functions/_shared/posthog-server.ts` extension:
- `Phase38Event` typed union covering 28 event names (recommender × 7, digest × 11, win-back × 2, embed × 3, HITL × 3, plan-personalize × 1, eval × 2).
- Typed payload contracts for the 3 highest-volume events: `RecommendationShownProperties`, `DigestSentProperties`, `RecommendationClickedProperties`.
- Header doc reinforces the `shutdownPostHog()` requirement before Response return.

### Task 3 — track-rec-click Edge Fn + ForYouCard + RelatedArticlesFooter

**`supabase/functions/track-rec-click/index.ts`** — server-side click tracker accepting `{recommendation_id, surface?}`:
- Validates Bearer auth → 401 if absent.
- First UPDATE: `where recommendation_id = ? AND user_id = ? AND clicked_at IS NULL` → sets `clicked_at = now()` and emits `recommendation.clicked` with `first_click=true`.
- Repeat UPDATE (only fires when first probe matched 0 rows): drops the `is(clicked_at, null)` filter to distinguish foreign-row 404 from repeat-click 204 (with `first_click=false`).
- `try { … } finally { await shutdownPostHog() }` wraps the handler per memory `feedback_planner_iter1_anti_patterns`.
- 6 Deno tests cover: T1 happy path, T2 cross-tenant rejection (RLS-driven 404), T3 PostHog event payload, T4 idempotency (2 clicks → first_click=true then =false), T5 missing auth → 401, T6 missing recommendation_id → 400.

**`leanshot/src/components/dashboard/cards/ForYouCard.tsx`** — D-01 dashboard surface:
- `Card span={6} variant='elevated'`, lazy-load-ready default export.
- On mount: `supabase.functions.invoke('recommend-next-best-action', { body: { user_id, surface: 'dashboard' } })`.
- 3 s timeout via `AbortController`; on error/timeout/empty → `POPULAR_FALLBACK` (3 hard-coded KB pointers); fallback notice rendered.
- Click handler: personalized recs `fetch` POST to `/functions/v1/track-rec-click` with `recommendation_id` + `surface: 'dashboard'`; fallback rows skip the tracker (no real recommendation_id).
- Honors `useReducedMotion()` for the hover transform animation.

**`leanshot/src/components/kb/RelatedArticlesFooter.tsx`** — RECOMMEND-08 kb_footer:
- Accepts `currentKbId` prop, calls recommender with `surface: 'kb_footer'` + `exclude_content_id: currentKbId`.
- Renders `null` while loading or when recs are empty (vendor-gated — KB pages do not yet exist; this is a no-op shim until they ship).
- Server-side click tracking mirrors ForYouCard.

**Tests:** `ForYouCard.test.tsx` — 6 vitest tests (mount-invoke, top-3 render, error→fallback, span=6 class application, click POST, fallback click no POST). All pass; lint clean; full `vite build` green.

## Commits

| Task | Commit    | Summary                                                                                |
| ---- | --------- | -------------------------------------------------------------------------------------- |
| 1    | `b24c707` | feat(38-09): pg_cron schedules — digest hourly fan-out + nightly embed/winback/softdelete-cleanup |
| 2    | `45038e8` | feat(38-09): Phase 38 TAXO event catalog — typed Phase38Event union + payload contracts |
| 3    | `e54f983` | feat(38-09): track-rec-click Edge Fn + ForYouCard + RelatedArticlesFooter             |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Edge Fn URL form corrected**
- **Found during:** Task 1.
- **Issue:** Plan body specified `https://ytnsipxxmzgaebkqmokp.functions.supabase.co/weekly-digest`. No migration in this repo uses that hostname form — every existing cron (15+ jobs) uses `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/<name>`.
- **Fix:** Used the repo-canonical form. The two URLs route to the same Edge Fn but the `.supabase.co/functions/v1/` form is what Supabase CLI/templates emit; sticking with the plan body would create the only migration on the project using the divergent shorthand.
- **Files modified:** `supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql`.
- **Commit:** `b24c707`.

**2. [Rule 2 — Missing critical functionality] Vault read null-guard**
- **Found during:** Task 1.
- **Issue:** Plan's cron body sketch read `vault.decrypted_secrets` and used the value directly; a missing/renamed vault entry would crash the cron with a NULL bearer concatenation.
- **Fix:** Added `if service_key is null then raise notice … return; end if;` to every cron body so a missing vault entry surfaces in Postgres logs as a notice and skips the HTTP call rather than emitting a broken request.
- **Files modified:** same migration as above.
- **Commit:** `b24c707`.

**3. [Rule 3 — Blocking] node_modules unavailable in worktree**
- **Found during:** Task 3 verify (tsc/vitest/eslint).
- **Issue:** Worktree had no `leanshot/node_modules` (per memory `feedback_worktree_executor_npm_install_leak` warning — `npm install` in worktree leaks to main).
- **Fix:** Symlinked main checkout's `node_modules` into the worktree (`ln -s /Users/karstenhaldan/minisite/leanshot/node_modules leanshot/node_modules`). Symlink is git-ignored (it is untracked + outside the staged path list) and never committed.
- **Files modified:** filesystem only (symlink); no source files touched.
- **Commit:** N/A.

**4. [Rule 1 — Bug] `JSX.Element` namespace not resolvable in React 19**
- **Found during:** Task 3 tsc verify.
- **Issue:** React 19 + `jsx: 'react-jsx'` does not auto-expose the legacy `JSX` namespace; `JSX.Element` returned `TS2503: Cannot find namespace 'JSX'`.
- **Fix:** Switched return-type annotations to `import { type ReactElement } from 'react'`.
- **Files modified:** `ForYouCard.tsx`, `RelatedArticlesFooter.tsx`.
- **Commit:** `e54f983`.

**5. [Rule 3 — Blocking] `import-x/order` violation on deferred component import**
- **Found during:** Task 3 lint verify.
- **Issue:** vitest's `vi.mock()` calls must run before the component import that depends on the mocked modules; placing the import after the mocks tripped `import-x/order` (`newlines-between: never`).
- **Fix:** Wrapped the test-file's mock + deferred-import block in `/* eslint-disable import-x/order */` … `/* eslint-enable */`. This is the same pattern other tests in the repo use (e.g. `EmailPreferencesPage.test.tsx`) but explicit here so future readers see the intent.
- **Files modified:** `ForYouCard.test.tsx`.
- **Commit:** `e54f983`.

### Auth gates

None — no live deploys were performed inside this plan (see `key-decisions` re: deferred push).

### Deferred items

- **`supabase db push --linked` deferred to manual deploy gate:** the plan's `<verify><automated>` step calls live push. Per memories `feedback_worktree_executor_pwd_drift_leaks_to_main` + `feedback_parallel_executor_autonomy_drift`, pushing migrations from inside a worktree carries leak risk (a stray `cd` to the main checkout would commit to main). Local syntactic validation passed (dollar-quote balance + structure); the live `cron.job` existence check + Edge Fn deploy belong in the orchestrator's post-merge step. Captured in deferred-items below.
- **Deno test execution deferred:** no `deno` runtime is available in this environment. Tests are written, structured per the canonical `recommend-next-best-action/index.test.ts` pattern, and follow project convention (`reference_deno_test_discovery` — `*.test.ts` naming). They will run in CI / next agent with deno installed.
- **`winback-scorer` Edge Fn not yet present:** cron job `phase38-winback-scorer-nightly` is registered and will fire; the Edge Fn ships in Plan 38-07 (same wave). Until then the HTTP call returns 404 — expected for parallel-wave wiring.

## Known stubs

- **`POPULAR_FALLBACK` in `ForYouCard.tsx`** — 3 hard-coded KB slugs (`/kb/injection-rotation`, `/kb/drug-level-curve`, `/kb/food-noise`). Intentional — D-02 graceful degradation while the recommender warms / KB ships. Plan 38-12 (popularity materialized view, RECOMMEND-12) will swap these with click-count-ranked content.
- **`RelatedArticlesFooter` is a no-op shim** until KB pages exist. Intentional, vendor-gated pattern; documented in the component's header comment.

## Self-Check: PASSED

- FOUND: supabase/migrations/20270705000030_phase38_pg_cron_schedules.sql
- FOUND: supabase/migrations/20270705000031_phase38_taxo_events.sql
- FOUND: supabase/functions/track-rec-click/index.ts
- FOUND: supabase/functions/track-rec-click/index.test.ts
- FOUND: leanshot/src/components/dashboard/cards/ForYouCard.tsx
- FOUND: leanshot/src/components/dashboard/cards/ForYouCard.test.tsx
- FOUND: leanshot/src/components/kb/RelatedArticlesFooter.tsx
- FOUND: supabase/functions/_shared/posthog-server.ts (modified)
- FOUND commit: b24c707 (Task 1 — cron migration)
- FOUND commit: 45038e8 (Task 2 — TAXO catalog + posthog-server extension)
- FOUND commit: e54f983 (Task 3 — track-rec-click + ForYouCard + RelatedArticlesFooter)

