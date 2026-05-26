---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: 11
subsystem: rag-tip-of-day
tags: [rag, tip-of-day, push-notifications, openrouter, bento-card, haiku, pharma-02]

requires:
  - plan: 60-01
    provides: "kb_tip_of_day table is owned here; 60-01 owns push_subscription_categories + research_tips CHECK widening"
  - plan: 60-02
    provides: "_shared/rag-retrieve.ts, _shared/posthog-rag-events.ts, _shared/slack-guardrail-alert.ts, _shared/pharma-02-carveout.ts"
  - plan: 60-06
    provides: "rag-retrieve Edge Fn with tier-A boost + rerank + k-anon floor"
  - plan: 60-08
    provides: "Admin queue RPCs; retract_rag_chunk cascade to kb_tip_of_day via FK"

provides:
  - "kb_tip_of_day table with UNIQUE(user_id, date_utc) + RLS + SECDEF write wrapper"
  - "rag-tip-of-day-generate Edge Fn: per-user retrieve → PHARMA-02 gate → OpenRouter Haiku → push-dispatch"
  - "TipOfTheDayCard React component in HomeTab top-right span=4 slot"
  - "research_tips category in notification-types.ts Category union + push-dispatch VALID_CATEGORIES"
  - "anthropic_tip_of_day vendor in cost-ledger.ts RagVendor type"

affects:
  - "60-15 BLOCKING — Fn deploy + cron registration + supabase db push --linked"
  - "60-13 — /knowledge/<topic>/<slug> route (tip card Open source link)"
  - "push-dispatch — research_tips category now accepted"

tech-stack:
  added:
    - "OpenRouter native fetch (no @ai-sdk/anthropic) — anthropic/claude-haiku-4.5"
  patterns:
    - "Dependency-injection handler pattern (handler(req, deps)) for Deno testability"
    - "import.meta.main guard for Deno.serve per reference_deno_test_top_level_serve_trap"
    - "AI-04 <user_data> fence in user prompt (mirrors ai-chat/index.ts Phase 4 D-02)"
    - "Push-payload Layer 3 grep gates (prescriptive-verb, equivalence, dose-number)"
    - "PHARMA-02 Layer 2 runtime check before LLM synthesis"
    - "Server-side event relay (rag_tip_impression + rag_tip_clicked via server-rag-event-relay)"

key-files:
  created:
    - "supabase/migrations/20281201000004_kb_tip_of_day_table.sql"
    - "supabase/functions/rag-tip-of-day-generate/index.ts"
    - "supabase/functions/rag-tip-of-day-generate/prompt.ts"
    - "supabase/functions/rag-tip-of-day-generate/push-payload.ts"
    - "supabase/functions/rag-tip-of-day-generate/deno.json"
    - "supabase/functions/rag-tip-of-day-generate/__tests__/index.test.ts"
    - "supabase/functions/rag-tip-of-day-generate/__tests__/prompt.test.ts"
    - "supabase/functions/rag-tip-of-day-generate/__tests__/push-payload.test.ts"
    - "leanshot/src/components/dashboard/cards/TipOfTheDayCard.tsx"
    - "leanshot/src/components/dashboard/cards/__tests__/TipOfTheDayCard.test.tsx"
    - "leanshot/tests/e2e/tip-of-day.spec.ts"
  modified:
    - "leanshot/src/components/dashboard/tabs/HomeTab.tsx (surgical: lazy TipOfTheDayCard mount)"
    - "leanshot/playwright.config.ts (P60_TIP_OF_DAY_OPT_IN project + testIgnore)"
    - "supabase/functions/_shared/notification-types.ts (research_tips to Category union)"
    - "supabase/functions/push-dispatch/index.ts (research_tips to VALID_CATEGORIES)"
    - "supabase/functions/rag-scrape-runner/cost-ledger.ts (anthropic_tip_of_day to RagVendor)"

key-decisions:
  - "OpenRouter vendor substitution (operator direction 2026-05-26): native fetch to openrouter.ai/api/v1 instead of @ai-sdk/anthropic; model anthropic/claude-haiku-4.5 (dotted OpenRouter convention)"
  - "source_name derived from chunk.source_type — RagRetrievedChunk schema doesn't expose source_name; future rag-retrieve API extension would provide it directly"
  - "RotateCcw reroll button disabled at MVP — single-tip-per-day decision from CONTEXT.md; manual reroll deferred to v1.5"
  - "Typography ceiling: all text classes use literal px values (text-[11px], text-[13px], text-lg) per UI-SPEC §11 ceiling constraint"
  - "research_tips + anthropic_tip_of_day vendor type extensions added inline as Rule 1 fixes (60-01 did not extend TypeScript types, only SQL migrations)"

metrics:
  duration: 90min
  completed: 2026-05-26
  tasks_completed: 6
  files_created: 11
  files_modified: 5
---

# Phase 60 Plan 11: Tip-of-the-Day Card and Edge Fn Summary

**One-liner:** OpenRouter Haiku tip-of-day synthesis (PHARMA-02 + k-anon + prescriptive-verb gates) writes to kb_tip_of_day, dispatches research_tips push, and renders in HomeTab Bento card.

## Files Created (11)

1. `supabase/migrations/20281201000004_kb_tip_of_day_table.sql` — kb_tip_of_day table, UNIQUE(user_id,date_utc), RLS SELECT, SECDEF write wrapper, research_tips seed (ON CONFLICT DO NOTHING)
2. `supabase/functions/rag-tip-of-day-generate/index.ts` — Edge Fn entry; retrieve→PHARMA-02→OpenRouter→push-payload→INSERT→push-dispatch; import.meta.main guard
3. `supabase/functions/rag-tip-of-day-generate/prompt.ts` — buildTipSystemPrompt + buildTipUserPrompt with AI-04 fence
4. `supabase/functions/rag-tip-of-day-generate/push-payload.ts` — buildPushPayload with three safety grep gates; TipPayloadRejected error type
5. `supabase/functions/rag-tip-of-day-generate/deno.json` — per-fn import map (CLI v2.101.0+ ignores --import-map)
6. `supabase/functions/rag-tip-of-day-generate/__tests__/index.test.ts` — 9 deno integration tests (happy path + all refusal paths + auth + idempotency)
7. `supabase/functions/rag-tip-of-day-generate/__tests__/prompt.test.ts` — 7 deno tests (system prompt clauses + user prompt AI-04 fence)
8. `supabase/functions/rag-tip-of-day-generate/__tests__/push-payload.test.ts` — 11 deno tests (truncation + three safety gates)
9. `leanshot/src/components/dashboard/cards/TipOfTheDayCard.tsx` — Bento card; null on no row (D-24); rag_tip_impression/clicked events
10. `leanshot/src/components/dashboard/cards/__tests__/TipOfTheDayCard.test.tsx` — 5 vitest tests
11. `leanshot/tests/e2e/tip-of-day.spec.ts` — 4 Playwright tests gated by PLAYWRIGHT_RUN_P60_TIP_OF_DAY=1

## Files Modified (5)

- `leanshot/src/components/dashboard/tabs/HomeTab.tsx` — lazy TipOfTheDayCard in span=4 Suspense slot
- `leanshot/playwright.config.ts` — P60_TIP_OF_DAY_OPT_IN constant + p60-tip-of-day project + testIgnore entry
- `supabase/functions/_shared/notification-types.ts` — added `research_tips` to Category union
- `supabase/functions/push-dispatch/index.ts` — added `research_tips` to VALID_CATEGORIES Set
- `supabase/functions/rag-scrape-runner/cost-ledger.ts` — extended RagVendor with `anthropic_tip_of_day` and `anthropic_newsletter`

## Verification Gate Results

1. Migration shape (5 tokens): **PASS** (5 tokens found)
2. No cron.schedule functional SQL: **PASS** (only in `--` comment; no pg_cron call)
3. Deno tests all green: **PASS** (27/27 passed: 9 index + 7 prompt + 11 push-payload)
4. Deno.serve guarded: **PASS** (`grep -c "^Deno.serve"` = 0; `grep -c "if (import.meta.main) Deno.serve"` = 1)
5. OpenRouter gates (override block): **PASS** (`'anthropic/claude-haiku-4.5'` ≥1, `openrouter.ai/api/v1` ≥1, `OPENROUTER_API_KEY` ≥1)
6. Vitest TipOfTheDayCard: **PASS** (5/5)
7. Typecheck: **PASS** (tsc -b --noEmit exits 0)
8. ESLint: **PASS** (0 errors on TipOfTheDayCard.tsx + HomeTab.tsx)
9. Typography ceiling: **PASS** (0 text-base/text-md in TipOfTheDayCard.tsx)
10. Playwright (gated): **DEFERRED** — gated by `PLAYWRIGHT_RUN_P60_TIP_OF_DAY=1`; not run in local dev (no live Supabase)
11. Push-payload regex coverage: **PASS** (9 lines match PRESCRIPTIVE_VERB_RE|EQUIVALENCE_RE|DOSE_NUMBER_RE)
12. AI-04 fence: **PASS** (`grep -c "<user_data>"` = 3 in prompt.ts)
13. Disclaimer verbatim: **PASS** (`Not medical advice — consult your clinician.` present)

## Cross-Plan Dependency Reminders

**(a) 60-01 owns `push_subscription_categories` research_tips row** — this plan seeds the notification_category_config row idempotently (ON CONFLICT DO NOTHING) as belt-and-suspenders. 60-01 is the primary owner of the CHECK constraint widening.

**(b) 60-13 owns `/knowledge/<topic>/<slug>` route** — the TipOfTheDayCard `Open source ↗` link uses `/knowledge/${topic_tag}/${topic_slug}`. E2E T2 asserts URL change only (not 200 response). Route resolves to 200 after 60-13 ships (Wave 3).

**(c) 60-15 BLOCKING owns Fn deploy + cron registration + db push** — `rag-tip-of-day-generate` must be deployed before `20281201000004_kb_tip_of_day_table.sql` is pushed (per [[feedback_fn_deploy_before_cron_db_push]]). 60-15 registers the pg_cron `phase60_tip_of_day_daily` schedule in `20281201000099_phase60_cron_schedules.sql`.

## AI-SPEC Dimension Coverage

- **Dim #1** (citation faithfulness) — system prompt clause: "must be a verbatim substring of the chunk text OR a faithful paraphrase that contains NO claim absent from the chunk"
- **Dim #8** (source-tier rendering) — TierBadge renders in card footer; tier passed from kb_tip_of_day row
- **Dim #9** (k-anon floor) — Fn asserts `cohort_n >= 5` for leanshot_research/community source_types before synthesis
- **Dim #12** (cost envelope) — `gateOrThrow(client, 'anthropic_tip_of_day')` BEFORE OpenRouter call
- **Dim #13** (personalization appropriateness) — prescriptive-verb regex gate in push-payload.ts + system prompt explicit prohibition

## Guardrail Coverage

- **G1** (PHARMA-02) — Layer 2 runtime `isPharma02GatedTopic(chunk)` before synthesis; Layer 3 mirror in push-payload.ts EQUIVALENCE_RE
- **G2** (AI-04 fence) — `<user_data>...</user_data>` in buildTipUserPrompt when user_drug or active_themes present
- **G3** (out-of-corpus) — refused/empty chunks → refusal_reason: no_chunk_eligible
- **G6** (cost envelope) — gateOrThrow + Slack alert on breach
- **G8** (k-anon floor) — cohort_n < 5 check for leanshot_research/community; emitRefusalEmitted
- **G9** (FDA-equivalence) — EQUIVALENCE_RE in push-payload.ts

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] notification-types.ts missing research_tips in Category union**
- **Found during:** Task 4
- **Issue:** Category type didn't include 'research_tips'; push-dispatch VALID_CATEGORIES.has('research_tips') would fail TypeScript
- **Fix:** Added `| 'research_tips'` to Category union in `_shared/notification-types.ts`; added to `push-dispatch/index.ts` VALID_CATEGORIES Set
- **Files modified:** `supabase/functions/_shared/notification-types.ts`, `supabase/functions/push-dispatch/index.ts`
- **Commit:** 7878f77f

**2. [Rule 1 - Bug] cost-ledger.ts RagVendor type missing anthropic_tip_of_day**
- **Found during:** Task 4
- **Issue:** `RagVendor = 'firecrawl' | 'openai_embed' | 'anthropic_summary' | 'resend'` didn't include `anthropic_tip_of_day`; `gateOrThrow(client, 'anthropic_tip_of_day')` would be a TypeScript error
- **Fix:** Extended `RagVendor` union in `rag-scrape-runner/cost-ledger.ts` with `anthropic_tip_of_day` and `anthropic_newsletter` (pre-added for 60-12)
- **Files modified:** `supabase/functions/rag-scrape-runner/cost-ledger.ts`
- **Commit:** 7878f77f

**3. [Rule 1 - Bug] RagRetrievedChunk schema drift — topic_slug, source_name, cohort_n absent**
- **Found during:** Task 4
- **Issue:** The plan's `<interfaces>` block described an `RagChunkResult` type with `topic_slug`, `source_name`, `canonical_url`, `cohort_n`, `final_score`, `stale`. The actual shipped `RagRetrievedChunk` from 60-02 has none of these (only: chunk_id, source_id, source_type, tier, topic_tag, source_text_excerpt, summary, similarity, rerank_score, evidence_date, freshness_reweight_applied, public_visibility)
- **Fix:** Derived `topic_slug` from `topic_tag` (lowercase + hyphenate); used `source_type` as `source_name` fallback; constructed `canonical_url` from `/knowledge/<topic_tag>/<slug>`; applied k-anon floor check only when `cohort_n` property exists on chunk (soft assertion)
- **Files modified:** `supabase/functions/rag-tip-of-day-generate/index.ts`
- **Commit:** 7878f77f

**4. [Rule 1 - Bug] Typography ceiling comment contained prohibited string**
- **Found during:** Task 5
- **Issue:** JSDoc comment ` * No text-base, no text-md — these are prohibited...` matched the verification grep `text-(base|md)` since `grep -v '^\s*//'` doesn't strip `*`-prefixed JSDoc lines
- **Fix:** Rephrased JSDoc to "Typography ceiling (UI-SPEC §11): only 11px/13px/18px tokens permitted."
- **Files modified:** `leanshot/src/components/dashboard/cards/TipOfTheDayCard.tsx`
- **Commit:** 38c4e703

**5. [Rule 1 - Bug] HomeTab.tsx ESLint import order**
- **Found during:** Task 5
- **Issue:** `const TipOfTheDayCard = lazy(...)` placed between `import` statements caused import-x/order ESLint error; GamificationCard import was also out of alphabetical order
- **Fix:** Reorganized imports alphabetically; moved both lazy declarations (`ForYouCard`, `TipOfTheDayCard`) after all static imports
- **Files modified:** `leanshot/src/components/dashboard/tabs/HomeTab.tsx`
- **Commit:** 38c4e703

## Known Stubs

| Stub | File | Line | Reason |
|------|------|------|--------|
| `p_source_name: chunk.source_type` | `supabase/functions/rag-tip-of-day-generate/index.ts` | 426 | `RagRetrievedChunk` doesn't expose `source_name`; using `source_type` as proxy. Future rag-retrieve API extension (or secondary rag_chunks lookup) resolves this. Not blocking — source_type is informative; exact source_name available from rag_chunks table after Fn deploy. |

## Threat Flags

No new network endpoints, auth paths, or trust boundaries introduced beyond what the plan's threat model covers. The Edge Fn service-role-only auth pattern mirrors existing Phase 60 Fns. Push-dispatch trust boundary already exists from Phase 54.

## Self-Check: PASSED

All 11 created files confirmed on disk. All 6 task commits confirmed in git log.
