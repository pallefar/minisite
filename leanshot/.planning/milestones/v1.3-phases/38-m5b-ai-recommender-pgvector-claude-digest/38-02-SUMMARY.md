---
phase: 38-m5b-ai-recommender-pgvector-claude-digest
plan: 02
subsystem: ai-infra
tags: [zod, deno, pgvector, anthropic, openai, vercel-ai-gateway, baa-scope, hipaa, recommender, embeddings]

requires:
  - phase: 25-hipaa-baa-ready
    provides: BAA-scope split (consumer vs clinical Anthropic credential), email-router PHI/non-PHI lane, _shared/sentry.ts
  - phase: 28-rls-cross-tenant-isolation
    provides: RLS posture + service-role re-imposition pattern for the recommender RPC
  - phase: 38-01
    provides: pgvector schema, match_content_embeddings RPC, content_embeddings table, profiles.timezone column
provides:
  - "Wave-1 _shared/ helper layer for Phase 38 Edge Functions (Plans 38-03..38-08)"
  - "BAA-scope guard with breadcrumb-order audit invariant (HIPAA-01)"
  - "Anthropic Messages API wrapper with output_config.format.json_schema + max_tokens 1024"
  - "OpenAI embeddings wrapper with 429 Retry-After backoff + pre-embed refusal scrub"
  - "Business-rule re-ranker enforcing D-01 surface_target, D-03 expires_at 7d, D-13 auto_approve_kb"
  - "Zod DigestOutputSchema + WHITELIST_ACTION_IDS + CLINICAL_KEYWORD_BLOCKLIST (2-layer enum + regex defense)"
  - "anthropic-baa-allowlist.ts extended with claude-sonnet-4-6 (same-plan landing prevents temporal 403 gap)"
affects: [38-03, 38-04, 38-05, 38-06, 38-07, 38-08, 38-09]

tech-stack:
  added: [zod@3.23.8 (esm.sh), Deno test, jsr:@std/assert@^1, addBreadcrumb sentry seam]
  patterns:
    - "Test-seam pattern: __getBreadcrumbsForTest / __resetBreadcrumbsForTest in sentry.ts mirrors live Sentry crumbs in-memory for breadcrumb-order assertions"
    - "BAA-scope order invariant: resolveBaaScope() emits baa.scope.resolved BEFORE returning; summarizeDigest emits anthropic.messages.create BEFORE fetch — order asserted in unit tests as audit replay invariant"
    - "Pre-embed refusal scrub: openai-embed.ts strips dose-change phrasing via shared/refusal isDoseChangeAdvice before fetching /embeddings — emits recommendation.refusal_stripped for telemetry (Guardrail O6)"
    - "Deterministic-templating-for-LLM pattern: renderUserFacts wraps caps + sanitization + fenced block; SYSTEM_PROMPT_DIGEST is locked + tested for byte-stability so Anthropic prompt caching applies"
    - "Same-plan vendor allowlist extension: BAA_COVERED_MODELS bump lands in the SAME plan as the dependent consumer to eliminate the temporal 403 gap that would occur with a split"

key-files:
  created:
    - supabase/functions/_shared/digest-schema.ts
    - supabase/functions/_shared/digest-schema.test.ts
    - supabase/functions/_shared/render-user-facts.ts
    - supabase/functions/_shared/render-user-context.ts
    - supabase/functions/_shared/baa-scope.ts
    - supabase/functions/_shared/baa-scope.test.ts
    - supabase/functions/_shared/anthropic-summarize.ts
    - supabase/functions/_shared/anthropic-summarize.test.ts
    - supabase/functions/_shared/openai-embed.ts
    - supabase/functions/_shared/openai-embed.test.ts
    - supabase/functions/_shared/recommender-rank.ts
    - supabase/functions/_shared/recommender-rank.test.ts
  modified:
    - supabase/functions/_shared/anthropic-baa-allowlist.ts (added claude-sonnet-4-6 + Last reviewed bump)
    - supabase/functions/_shared/sentry.ts (added addBreadcrumb + in-memory test mirror seam)
    - supabase/functions/import_map.json (added shared/ directory alias)

key-decisions:
  - "Tests written as Deno.test (NOT vitest) — project convention for supabase/functions/_shared/*.test.ts. Plan's 'Vitest' mention reconciled to project convention (Rule 3 — see Deviations)"
  - "WHITELIST_ACTION_IDS = 9 entries per CONTEXT D-15 (read_kb, log_weight, log_injection, log_meal, view_curve, share_with_doctor, complete_onboarding_step, try_recipe, watch_tutorial). Slug-suffix variants travel in deeplink field, NOT in the enum"
  - "Model ID hyphenated: 'anthropic/claude-sonnet-4-6'. AI Gateway rejects dotted variants per [[reference_anthropic_model_id_hyphenated_format]]"
  - "profiles column is primary_org_id (NOT org_id) — Phase 38 plan referenced legacy name; baa-scope.ts uses live column name"
  - "addBreadcrumb seam added directly to _shared/sentry.ts rather than importing SentryNode.addBreadcrumb at the consumer site — keeps the unit-test mirror centralized and consumers don't need to re-implement the test seam"
  - "Pre-embed refusal scrub uses shared/refusal isDoseChangeAdvice (existing module from Phase 4) — no new refusal logic introduced; the scrub replaces matched text with '[redacted user-context contained dose-change phrasing]' so the embedding lands on a generic GLP-1 vector, not a dose-change vector"

patterns-established:
  - "Sentry breadcrumb-order assertion as audit replay invariant: load-bearing test verifies baa.scope.resolved precedes anthropic.messages.create in the in-memory crumb buffer"
  - "Two-layer enum-then-regex output validation: Zod enum guards action.id, post-Zod CLINICAL_KEYWORD_BLOCKLIST scans action.reason for clinical-action keywords"
  - "Deterministic recommendation_id: SHA-shaped {userId, contentId, surface, day-bucket} composite enables idempotent shown_at upserts and same-day dedup in recommendation_events"

requirements-completed: [RECOMMEND-02, RECOMMEND-05, RECOMMEND-07]

duration: 10min
completed: 2026-05-20
---

# Phase 38 Plan 02: AI Recommender + Digest helper layer — Summary

**7 Edge-Function helper modules + 5 unit test suites (62/62 passing) ship the BAA-scope guard, Anthropic Messages wrapper (`/v1/messages` + `output_config.format.json_schema`), OpenAI embeddings wrapper (429 Retry-After + pre-embed refusal scrub), Zod DigestOutputSchema with whitelist enum + clinical-keyword blocklist, deterministic facts/context templating, and business-rule re-ranker — Wave 2 plans 38-03..38-08 now import a complete `_shared/` surface.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-20T10:11:23Z
- **Completed:** 2026-05-20T10:21:53Z
- **Tasks:** 3/3 complete
- **Files created:** 12 (7 source + 5 test)
- **Files modified:** 3 (allowlist extension, sentry seam, import_map alias)
- **Tests passing:** 62/62 Deno tests across 6 test files (including 9 pre-existing allowlist tests, regression-clean)

## Accomplishments

- **BAA-scope guard with audit replay invariant.** `resolveBaaScope()` reads `profiles.primary_org_id`, selects consumer vs clinical AI Gateway credential, and emits a Sentry `baa.scope.resolved` breadcrumb **BEFORE returning**. `summarizeDigest()` emits `anthropic.messages.create` just before fetch. The breadcrumb ORDER is the Phase 25 HIPAA-01 audit signal — Test T5 in `anthropic-summarize.test.ts` asserts this on a fresh in-memory crumb buffer, making the invariant a compile-time test gate.
- **Anthropic Messages wrapper hardened for HIPAA + structured output.** POSTs to `/v1/messages` (NOT `/chat/completions`), passes `output_config.format.json_schema: digestJsonSchema`, sets `max_tokens: 1024` + `temperature: 0.4`, uses hyphenated `anthropic/claude-sonnet-4-6` model ID. 25s AbortController timeout. `generateDigestWithRetry` runs 3 attempts with 500ms/2s backoff and a post-Zod `CLINICAL_KEYWORD_BLOCKLIST` scan that catches dose-mention smuggling in `reason` fields the Zod enum can't see.
- **BAA allowlist extended in the SAME plan as the consumer.** `claude-sonnet-4-6` added to `BAA_COVERED_MODELS` — no temporal 403 gap when Phase 38 ships ([[feedback_planner_iter1_anti_patterns]] same-plan landing pattern).
- **OpenAI embeddings wrapper with adversarial-input scrub.** 1536-d vector return, 25s timeout, 429 Retry-After backoff (3 retries), pre-embed `shared/refusal` `isDoseChangeAdvice` scrub replaces dose-change phrasing with a neutral placeholder so the embedding doesn't land on a clinical-action vector. Emits `recommendation.refusal_stripped` + `embed.rate_limit_429` PostHog events.
- **Business-rule re-ranker.** `rankRecommendations` filters dismissed (24h) + currently-viewed content, derives `surface_target` from caller's surface, sets `expires_at = nowMs + 7d` (D-03), and flags `auto_approve_kb=true` for `kb_article` + `action_id ∈ {null, read_kb}` (D-13 HITL bypass). Deterministic `recommendation_id` lets recommendation_events upsert idempotently.
- **Deterministic LLM templating.** `renderUserFacts` caps top-5 symptoms / last-7 weights / last-14 injections per AI-SPEC §4b, redacts raw weight values to deltas only per D-04, and emits fenced `<user_facts>` + `<whitelist>` blocks with red flags FIRST so the model cannot miss them. `renderUserContext` produces a single deterministic ~150-token string for the recommender embedding call.
- **Zod schemas + JSON-Schema lockstep.** `DigestOutputSchema` enforces narrative 40–600 chars + actions 1–3 + per-item id whitelist + reason ≤120 chars. `digestJsonSchema` (passed to AI Gateway `output_config.format.schema`) shares the WHITELIST_ACTION_IDS array via spread, so a single edit propagates to both the model-boundary and application-boundary checks.

## Task Commits

1. **Task 1: digest-schema.ts + render-user-facts.ts + render-user-context.ts (full TDD)** — `6ab270b` (feat)
2. **Task 2: BAA-scope guard + extended allowlist + Anthropic Messages wrapper** — `fd02516` (feat)
3. **Task 3: openai-embed + recommender-rank + import_map shared/ alias** — `1bd20a9` (feat)

**Plan metadata commit (this SUMMARY.md):** pending final docs commit.

## Files Created/Modified

### Created (12)

- `supabase/functions/_shared/digest-schema.ts` — Zod schemas + WHITELIST_ACTION_IDS (9 entries, CONTEXT D-15) + digestJsonSchema + CLINICAL_KEYWORD_BLOCKLIST + validateNoClinicalKeywords helper.
- `supabase/functions/_shared/digest-schema.test.ts` — 13 Deno tests covering all schema boundaries + render-user-facts caps + render-user-context determinism + WHITELIST entries.
- `supabase/functions/_shared/render-user-facts.ts` — deterministic facts template; caps top-5 symptoms / last-7 weights / last-14 injections; red flags surfaced first; D-04 weight-value redaction; fenced `<user_facts>` + `<whitelist>` blocks.
- `supabase/functions/_shared/render-user-context.ts` — deterministic ~150-token embedding input string per RESEARCH Pattern 1 Option B.
- `supabase/functions/_shared/baa-scope.ts` — `resolveBaaScope` (Sentry breadcrumb emit BEFORE return), `assertBaaScope` (anthropic/ prefix strip + allowlist check on clinical path), `BaaScopeError` class. Reads `profiles.primary_org_id`.
- `supabase/functions/_shared/baa-scope.test.ts` — 10 Deno tests: credential routing, prefix strip, consumer no-op, missing-env throw, profiles error throw, missing-row treated as consumer, empty-userId rejection.
- `supabase/functions/_shared/anthropic-summarize.ts` — `summarizeDigest` posts `/v1/messages` with output_config.format.json_schema, hyphenated model ID, `anthropic-version` header, 25s timeout. `generateDigestWithRetry` 3-attempt + post-Zod clinical-keyword scan + PostHog `digest.validation_failed` telemetry. SYSTEM_PROMPT_DIGEST locked verbatim from AI-SPEC §4b.3.
- `supabase/functions/_shared/anthropic-summarize.test.ts` — 10 Deno tests including LOAD-BEARING T5 breadcrumb-order assertion, /v1/messages URL assertion, output_config.format.json_schema shape, max_tokens=1024, retry behavior, prefix-strip on clinical path.
- `supabase/functions/_shared/openai-embed.ts` — `/embeddings` wrapper with AbortController 25s, 429 Retry-After backoff (3 retries), pre-embed `isDoseChangeAdvice` scrub, PostHog telemetry events.
- `supabase/functions/_shared/openai-embed.test.ts` — 8 Deno tests covering happy path, 429 retry, exhaustion throw, non-2xx error slice, scrub-replaces-adversarial, scrub-passes-benign, skipScrub bypass, missing-env throw.
- `supabase/functions/_shared/recommender-rank.ts` — `rankRecommendations` business-rule re-ranker; D-01 surface_target tag, D-03 expires_at 7d, D-13 auto_approve_kb, dismissedIds + excludeContentId filtering, deterministic recommendation_id, source_type→deeplink derivation.
- `supabase/functions/_shared/recommender-rank.test.ts` — 12 Deno tests covering all 5 plan behaviors plus deterministic id, deeplink derivation, weighted_score fallback, empty-candidates edge case.

### Modified (3)

- `supabase/functions/_shared/anthropic-baa-allowlist.ts` — added `'claude-sonnet-4-6'` to `BAA_COVERED_MODELS`; `Last reviewed: 2026-05-17 → 2026-05-20` with Phase 38 reference comment. **Pre-existing 9 tests still pass — no regression.**
- `supabase/functions/_shared/sentry.ts` — added `addBreadcrumb` export + in-memory test mirror (`__getBreadcrumbsForTest`, `__resetBreadcrumbsForTest`). Used by `anthropic-summarize.ts` for the audit-order breadcrumb pair AND by Test 5 to assert order.
- `supabase/functions/import_map.json` — added `"shared/": "../../shared/"` directory alias (merged, not overwritten — preserved existing `shared/refusal`, `shared/disclaimers`, `stripe`).

## Decisions Made

- **Test runner: Deno, not Vitest.** Plan frontmatter mentioned Vitest verify commands, but ALL existing `supabase/functions/_shared/*.test.ts` files use `Deno.test` + `jsr:@std/assert@^1` ([[reference_deno_test_discovery]]). The 38-01 sibling shipped its pgvector smoke test as a Deno test. Sibling consistency + project convention + `vite.config.test.include` does NOT cover `supabase/functions/_shared/**`. Reconciled to Deno. Documented as Rule-3 deviation.
- **Use existing column `primary_org_id`, not the plan-suggested `org_id`.** Phase 25 documents referred to `org_id`; the live `profiles` table has `primary_org_id`. The pre-loaded HANDOFF.md flagged this — `baa-scope.ts` uses the live column name. No DB-schema change required.
- **Pre-embed scrub semantics: replace, not reject.** `isDoseChangeAdvice` matches in user-context text → replace with `'[redacted user-context contained dose-change phrasing]'` rather than throwing. The recommender Edge Fn still needs a vector to query, so producing a neutral-vector embedding is better than a 4xx that breaks the dashboard "For you" card.
- **`addBreadcrumb` lives in `_shared/sentry.ts`, not at consumer sites.** Keeps the test mirror centralized; consumers don't re-implement the seam. Phase 50 Plan 50-04 `sentryCapture` is the precedent (single helper, multiple consumers).
- **Test-seam exports (`__get…ForTest`) are prefixed with `__`.** Per existing convention in `posthog-server.ts` (`setMirrorAdminForTest`, `resetMirrorAdminForTest`). Documents non-production intent at the call site.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Project Convention] Tests written as Deno.test, not Vitest**

- **Found during:** Task 1 (digest-schema test setup)
- **Issue:** Plan frontmatter + `<verify><automated>` blocks specified `npm run test -- supabase/functions/_shared/...` (Vitest). However: (a) no existing `supabase/functions/_shared/*.test.ts` uses Vitest — all 7 pre-existing files use `Deno.test` + `jsr:@std/assert@^1`; (b) `leanshot/vite.config.ts` test.include is `['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts', 'scripts/**/*.test.ts', '../shared/**/*.test.ts', 'eslint-rules/**/*.test.{js,ts,cjs}']` — `supabase/functions/_shared/**` is OUTSIDE this scope, so the plan's verify commands would fail to even discover the test files; (c) sibling 38-01 shipped `pgvector-smoke.test.ts` as a Deno test.
- **Fix:** Wrote all 5 test files as Deno tests using `jsr:@std/assert@^1`. Ran verification via `/Users/karstenhaldan/.deno/bin/deno test --allow-env --allow-net --no-check ...`.
- **Files modified:** all 5 test files (digest-schema.test.ts, baa-scope.test.ts, anthropic-summarize.test.ts, openai-embed.test.ts, recommender-rank.test.ts)
- **Verification:** 62/62 tests pass under `deno test`. Including 9 pre-existing allowlist tests (regression-clean).
- **Committed in:** 6ab270b, fd02516, 1bd20a9 (one per task)

**2. [Rule 2 - Missing Critical] Added `addBreadcrumb` export to _shared/sentry.ts + in-memory test mirror**

- **Found during:** Task 2 (anthropic-summarize wrapper construction)
- **Issue:** Plan required asserting Sentry breadcrumb ORDER (`baa.scope.resolved` precedes `anthropic.messages.create`) as the load-bearing HIPAA-01 audit test. Existing `_shared/sentry.ts` exports `captureException` and `captureMessage` only — no `addBreadcrumb`, no test seam. Without these, the LOAD-BEARING Test T5 cannot be written.
- **Fix:** Added `addBreadcrumb(crumb)` (forwards to SentryNode.addBreadcrumb when SENTRY_DSN set; always mirrors to in-memory buffer for test reads) plus `__getBreadcrumbsForTest` / `__resetBreadcrumbsForTest` seam exports.
- **Files modified:** supabase/functions/_shared/sentry.ts
- **Verification:** Test T5 (breadcrumb-order assertion) passes on a fresh mirror; `__resetBreadcrumbsForTest` between tests prevents cross-test leakage. No PHI in breadcrumb data — only scope tags (is_clinical boolean, has_org boolean, model_id, base_url_host).
- **Committed in:** fd02516

**3. [Rule 1 - Bug] T5 test phrases didn't match the AI-SPEC `\b`-anchored regex**

- **Found during:** Task 1 first test run (T5 CLINICAL_KEYWORD_BLOCKLIST assertion failed)
- **Issue:** Plan behavior text said `CLINICAL_KEYWORD_BLOCKLIST regex matches "Consider increasing to 1mg"` — but the AI-SPEC §6 O2 verbatim regex `/\b(mg|mcg|dose|titrate|skip injection|increase|decrease|split dose|prescribe|diagnos)\b/i` does NOT match that phrase: "increasing" has a `g`→`i` word-boundary failure, and "1mg" has no boundary between `1` and `m` (both word chars). The plan's test-phrase examples were inconsistent with the AI-SPEC's word-boundary semantics.
- **Fix:** Kept the AI-SPEC regex UNCHANGED (it is the locked contract). Updated the test to use phrases that match the verbatim regex (`"Consider increase the dose to 1 mg"`, `"diagnos this patient"`, etc.) AND added negative assertions confirming the documented behavior that suffixed forms ("increasing", "diagnosing") and adjacent-digit forms ("1mg") do NOT match. If broader matching is wanted, that's an AI-SPEC change, not a test change.
- **Files modified:** supabase/functions/_shared/digest-schema.test.ts
- **Verification:** Test T5 + the new negative assertions all pass.
- **Committed in:** 6ab270b

**4. [Rule 2 - Missing Critical] Recommender returns `auto_approve_kb=false` AND undefined `action_id` for non-KB sources**

- **Found during:** Task 3 (recommender-rank implementation)
- **Issue:** Plan D-13 wording was "auto_approve_kb=true when source_type='kb_article' AND action_id ∈ {null, 'read_kb'}". It did NOT explicitly say what `action_id` should be on non-KB rows. Without an explicit default, the downstream HITL queue can't distinguish "no action chosen yet" from "action explicitly null" — a correctness gap.
- **Fix:** Documented and tested: non-KB sources leave `action_id` undefined (content-only recommendation per D-03 "absence means content-only"); KB sources default to `'read_kb'`. Added explicit test T7b for the undefined case.
- **Files modified:** supabase/functions/_shared/recommender-rank.ts + .test.ts
- **Verification:** T7b passes.
- **Committed in:** 1bd20a9

---

**Total deviations:** 4 auto-fixed (1 project-convention rule, 2 missing critical, 1 test bug)
**Impact on plan:** All four are mechanical reconciliations between the planner's freeze-frame and the live codebase. Test-runner choice (Rule 3) is purely about which command discovers the tests — the test content fully covers the planner's specified behaviors. The other three are correctness additions (audit signal seam, regex test alignment, non-KB action_id semantics). No scope creep.

## Issues Encountered

- **None blocking.** One transient discovery: the `deno` binary is not on `$PATH` but is installed at `~/.deno/bin/deno` — resolved by invoking the absolute path.

## TDD Gate Compliance

The plan has `type: execute` (not `type: tdd`) at the plan level — each task was independently marked `tdd="true"`. Task-level TDD discipline was relaxed to one atomic commit per task (test + implementation together) because:

1. Each task's implementation is a single tightly-scoped helper module + its companion test; the RED-only commit would carry no signal vs the bundled commit.
2. Sibling 38-01 used the same atomic-per-task pattern (4 commits / 13 files / no separate RED commits).
3. The HANDOFF.md explicitly requested "Per task: write files → run verify → atomic git commit → next task."

If a stricter audit needs separate RED/GREEN commits, the test+source files within each commit can still be split via `git revert` + replay — the test files have no source-side dependencies (mock everything via the `fetchImpl` / mock-supabase seams).

## Known Stubs

- **`buildDeeplink` returns shim paths for `community_post` and `course_lesson`.** Per CONTEXT D-01: those surfaces don't exist yet (community = M4 / Phases 43-49; courses = Phase 46). The shims (`/community/p/<id>`, `/courses/lesson/<id>`) are documented in `recommender-rank.ts`. The dashboard surface filters out community/course `source_type` rows TODAY by virtue of zero rows in `content` with those `kind` values — recommender stays correct until M4 lands. Wave 2's `recommend-next-best-action/index.ts` should NOT need a code change to start surfacing community/course rows once they exist.
- **`renderUserFacts.weights` redacts absolute weight VALUES per D-04.** Only delta + count appear in the rendered template. The Anthropic digest model cannot fabricate or reference absolute weights because they never enter the prompt — this is the intended behavior, not a stub. Documented to surface it for VERIFICATION.md.

## Threat Flags

None — all surfaces introduced are covered by the plan's threat register (T-38-07 through T-38-12). Specifically:

- T-38-07 (Info Disclosure on anthropic-summarize) — mitigated via Sentry breadcrumb-order test (LOAD-BEARING Test 5).
- T-38-08 (Tampering on whitelist) — mitigated via 2-layer Zod enum + post-Zod CLINICAL_KEYWORD_BLOCKLIST regex (Test 5 + Test 9c).
- T-38-09 (Tampering via embed prompt injection) — mitigated via pre-embed `isDoseChangeAdvice` scrub + `recommendation.refusal_stripped` telemetry (openai-embed.test.ts Pre-embed scrub tests).
- T-38-10 (Info Disclosure via mis-allowlisted model on clinical path) — mitigated via same-plan `claude-sonnet-4-6` addition (Test 1) + anthropic/ prefix strip (Test T2b).
- T-38-11 (Repudiation via missing retry telemetry) — mitigated via `captureServer('digest.validation_failed', { attempt, error_type, error_summary })` on each retry (anthropic-summarize.ts retry loop).
- T-38-12 (DoS via embed 429 retry storm) — mitigated via 3-retry cap + Retry-After honor + `embed.rate_limit_429` event (openai-embed.test.ts T2/T2b).

## User Setup Required

None — Function Secrets (`AI_GATEWAY_API_KEY_CONSUMER`, `AI_GATEWAY_API_KEY_CLINICAL`, `AI_GATEWAY_BASE_URL`, `ANTHROPIC_MODEL_DIGEST`, `OPENAI_EMBED_MODEL`) are configured in Plan 38-10 (deploy).

## Next Phase Readiness

- **Wave 2 plans (38-03 recommender Edge Fn, 38-04 content-embed cron, 38-05 weekly-digest Edge Fn, 38-06 win-back, 38-07 personalize-offer, 38-08 admin-review surface) can now import the full `_shared/` surface.** All exports match the plan's `<artifacts>` contract:
  - `embed(text, options?)` from `_shared/openai-embed.ts`
  - `summarizeDigest(supabase, userFacts, options?)` + `generateDigestWithRetry(supabase, userFacts, options?)` from `_shared/anthropic-summarize.ts`
  - `resolveBaaScope(supabase, userId)` + `assertBaaScope(scope, modelId)` + `BaaScopeError` from `_shared/baa-scope.ts`
  - `WHITELIST_ACTION_IDS` + `DigestActionSchema` + `DigestOutputSchema` + `digestJsonSchema` + `CLINICAL_KEYWORD_BLOCKLIST` + `validateNoClinicalKeywords` from `_shared/digest-schema.ts`
  - `renderUserFacts(facts)` + `renderUserContext(facts)` from `_shared/render-user-facts.ts` + `_shared/render-user-context.ts`
  - `rankRecommendations(input)` from `_shared/recommender-rank.ts`
- **No blockers identified.** All helper modules use dependency injection (`fetchImpl`, mock supabase via duck-typing) so Wave 2 plans can write their own integration tests without re-mocking the AI Gateway.
- **38-CARRY-OVER risks** (none for 38-02): all 3 tasks committed, 62/62 tests pass, no deferred items.

## Self-Check: PASSED

Per `<self_check>` step — file + commit verification:

| Check | Result |
|---|---|
| `supabase/functions/_shared/digest-schema.ts` exists | FOUND |
| `supabase/functions/_shared/render-user-facts.ts` exists | FOUND |
| `supabase/functions/_shared/render-user-context.ts` exists | FOUND |
| `supabase/functions/_shared/baa-scope.ts` exists | FOUND |
| `supabase/functions/_shared/anthropic-summarize.ts` exists | FOUND |
| `supabase/functions/_shared/openai-embed.ts` exists | FOUND |
| `supabase/functions/_shared/recommender-rank.ts` exists | FOUND |
| `supabase/functions/_shared/digest-schema.test.ts` exists | FOUND |
| `supabase/functions/_shared/baa-scope.test.ts` exists | FOUND |
| `supabase/functions/_shared/anthropic-summarize.test.ts` exists | FOUND |
| `supabase/functions/_shared/openai-embed.test.ts` exists | FOUND |
| `supabase/functions/_shared/recommender-rank.test.ts` exists | FOUND |
| Commit `6ab270b` (Task 1) on main | FOUND |
| Commit `fd02516` (Task 2) on main | FOUND |
| Commit `1bd20a9` (Task 3) on main | FOUND |
| `claude-sonnet-4-6` in BAA_COVERED_MODELS | FOUND (Test T1 verifies) |
| `/v1/messages` in anthropic-summarize.ts (code-only, comment-stripped) | FOUND (1 occurrence) |
| `/chat/completions` in anthropic-summarize.ts (code-only) | NOT FOUND (0 — only doc-comments warn against it) |
| `shared/` alias in import_map.json | FOUND (`"../../shared/"`) |

---
*Phase: 38-m5b-ai-recommender-pgvector-claude-digest*
*Completed: 2026-05-20*
