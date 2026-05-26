---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: "07"
subsystem: api
tags: [supabase, edge-functions, pubmed, openfda, dailymed, zod, vitest, rag, federated]

requires:
  - phase: 60-rag-knowledge-base-completion-waves-2-4
    plan: "01"
    provides: "federated_sources + federated_source_cache + rag_chunks.created_by tables"
  - phase: 60-rag-knowledge-base-completion-waves-2-4
    plan: "02"
    provides: "posthog-rag-events.ts + slack-guardrail-alert.ts shared helpers"

provides:
  - "rag-federated-pubmed Edge Fn: PubMed E-utilities esearch/efetch adapter"
  - "rag-federated-fda Edge Fn: OpenFDA drug/label + drug/event adapter with PII guard"
  - "rag-federated-dailymed Edge Fn: DailyMed SPL REST adapter with LOINC section filter"
  - "_shared/federated-host-allowlist.ts: SSRF https-only 3-host allowlist (T-60-07-01)"
  - "_shared/federated-cache.ts: 24h TTL cache over federated_source_cache (T-60-07-07)"

affects:
  - 60-08 (admin queue UI reviews chunks queued by these Fns)
  - 60-09 (admin toggle UI enables these Fns)
  - 60-15 (BLOCKING cron registration — must deploy these 3 Fns first)

tech-stack:
  added:
    - "zod v3 (via node_modules/zod/v3/ compatibility layer in vitest)"
  patterns:
    - "handler.ts separation: Deno npm: imports in index.ts, pure logic in handler.ts (Vitest-testable)"
    - "Dependency injection: fetchImpl + supabase + env + sleepImpl + emitCostEnvelopeBreach + sendSlackAlert"
    - "SSRF assertAllowedHost: strict URL.hostname equality (not includes/startsWith) against 3-host allowlist"
    - "PII guard allowlist: explicit field-pluck in normalizeOpenFDADrugEvent (not denylist)"
    - "content_hash dedup: sha256(source_text_excerpt) → rag_chunks (topic_id, source_id, content_hash) UNIQUE"
    - "vite.config.ts zod alias: 'zod' → node_modules/zod/v3/index.js for cross-repo Edge Fn vitest"

key-files:
  created:
    - "supabase/functions/_shared/federated-host-allowlist.ts"
    - "supabase/functions/_shared/federated-cache.ts"
    - "supabase/functions/_shared/__tests__/federated-host-allowlist.test.ts"
    - "supabase/functions/_shared/__tests__/federated-cache.test.ts"
    - "supabase/functions/_shared/__tests__/federated-integration.test.ts"
    - "supabase/functions/rag-federated-pubmed/{index,handler,client,normalize}.ts"
    - "supabase/functions/rag-federated-pubmed/deno.json"
    - "supabase/functions/rag-federated-fda/{index,handler,client,normalize}.ts"
    - "supabase/functions/rag-federated-fda/deno.json"
    - "supabase/functions/rag-federated-dailymed/{index,handler,client,normalize}.ts"
    - "supabase/functions/rag-federated-dailymed/deno.json"
  modified:
    - "leanshot/vite.config.ts (zod v3 compat alias + federated test path includes)"

key-decisions:
  - "handler.ts/index.ts split: index.ts owns Deno npm: imports; handler.ts owns testable logic (mirrors rag-embed-approved pattern)"
  - "Schema adaptation: rag_chunks actual columns (canonical_url/source_tier/content_hash) vs plan's kb_chunks_queue (non-existent)"
  - "Dedup via content_hash not external_id: rag_chunks_dedup_uq index on (topic_id, source_id, content_hash)"
  - "topic_id/source_id resolution: handler looks up rag_topics.tag + rag_sources.domain per call (no migration needed)"
  - "LOINC section filter + fuzzy title fallback for DailyMed (community-observed API variance)"
  - "PII guard: explicit allowlist in normalizeOpenFDADrugEvent (patientonsetage/weight/sex/agegroup never touched)"

patterns-established:
  - "All federated chunks: source_tier='A' status='queued' — PHARMA-02 invariant enforced at ingestion"
  - "G7 wall-clock cap: 1-hour guard per Fn run + emitCostEnvelopeBreach + Slack P2 cost alert"
  - "Slack severity routing: SSRF → P1 pharma02; rate-limit truncation → P2 rag; G7 breach → P2 cost"
  - "zod v3 compat import: 'zod' (bare) + deno.json maps to npm:zod@^3; vite alias maps to node_modules/zod/v3"

requirements-completed: [RAG-06]

duration: 27min
completed: "2026-05-26"
---

# Phase 60 Plan 07: Federated Adapters Summary

**3 federated Edge Fns (PubMed/OpenFDA/DailyMed) with SSRF allowlist, 24h cache, PII guard, PHARMA-02 no-auto-publish, and 80 vitest cases**

## Performance

- **Duration:** 27 min
- **Started:** 2026-05-26T10:16:53Z
- **Completed:** 2026-05-26T10:44:33Z
- **Tasks:** 5 (all complete)
- **Files created:** 27 (25 new + 2 shared helpers + 1 vite.config.ts change)

## Accomplishments

- Shipped `rag-federated-pubmed` (PubMed E-utilities esearch/efetch, zod validation, XML parser, 30d clamp)
- Shipped `rag-federated-fda` (OpenFDA drug/label + drug/event, PII guard via explicit allowlist, boxed warning preservation)
- Shipped `rag-federated-dailymed` (DailyMed SPL search + detail, LOINC section filter with fuzzy fallback, token bucket 5 req/s)
- Shipped `_shared/federated-host-allowlist.ts` (T-60-07-01 SSRF: https-only + strict 3-host equality + IP literal deny + PostHog/Slack on trip)
- Shipped `_shared/federated-cache.ts` (T-60-07-07: sha256 keyed 24h cache, ON CONFLICT DO UPDATE, deep-copy semantics)
- 80 vitest cases pass across 12 test files (16 shared + 21 pubmed + 20 fda + 17 dailymed + 6 integration)
- PHARMA-02: ALL chunks land `source_tier='A'` `status='queued'` — zero auto-publish path exists
- PII guard verified: `patient.patientonsetage/weight/sex/agegroup` never in `source_text_excerpt`

## Vitest Case Count Per Fn

| Suite | Cases | Description |
|-------|-------|-------------|
| `federated-host-allowlist.test.ts` | 9 | SSRF: 3 allow + 5 block + 1 suffix-attack defense |
| `federated-cache.test.ts` | 7 | hashQuery determinism, read/write/expire/deep-copy |
| `federated-integration.test.ts` | 6 | Cross-Fn: enable→queue→dedup→last_sync_at + PHARMA-02 + SSRF |
| `rag-federated-pubmed` (client+normalize+handler) | 21 | E-utilities esearch/efetch, PubMedArticleSchema, 8 handler cases |
| `rag-federated-fda` (client+normalize+handler) | 20 | drug/label+event, PII regression, OpenFDADrugEventSchema |
| `rag-federated-dailymed` (client+normalize+handler) | 17 | SPL search+detail, DailyMedSPLSchema, LOINC filter |
| **Total** | **80** | |

## Task Commits

1. **Task 1: Shared SSRF allowlist + 24h cache** - `186e11c1` (feat)
2. **Task 2: rag-federated-pubmed Fn** - `712589e8` (feat)
3. **Task 3: rag-federated-fda Fn** - `9c95ed59` (feat)
4. **Task 4: rag-federated-dailymed Fn** - `236a309a` (feat)
5. **Task 5: Integration test + post-plan sweeps** - `834d7542` (feat)

## Files Created/Modified

### Shared helpers (2 new + 3 tests)
- `supabase/functions/_shared/federated-host-allowlist.ts` (149 lines) — T-60-07-01 SSRF guard
- `supabase/functions/_shared/federated-cache.ts` (177 lines) — T-60-07-07 24h cache
- `supabase/functions/_shared/__tests__/federated-host-allowlist.test.ts` (108 lines)
- `supabase/functions/_shared/__tests__/federated-cache.test.ts` (141 lines)
- `supabase/functions/_shared/__tests__/federated-integration.test.ts` (379 lines)

### rag-federated-pubmed (5 source + 3 tests)
- `client.ts` (261 lines) — esearch/efetch, SSRF, 429 backoff (1s/2s/4s), cache
- `normalize.ts` (129 lines) — PubMedArticleSchema, normalizePubMedArticle → rag_chunks
- `handler.ts` (348 lines) — DI handler, incremental/seed modes, rag_topics/sources lookup
- `index.ts` (45 lines) — Deno entry with import.meta.main guard

### rag-federated-fda (5 source + 3 tests)
- `client.ts` (262 lines) — searchDrugLabels + searchDrugEvents, 240/min sliding window
- `normalize.ts` (265 lines) — OpenFDADrugLabelSchema + OpenFDADrugEventSchema, PII guard
- `handler.ts` (291 lines) — both endpoints per topic_tag, G7 cap, last_sync_at flow
- `index.ts` (43 lines) — Deno entry

### rag-federated-dailymed (5 source + 3 tests)
- `client.ts` (242 lines) — searchSPLs + getSPLDetail, 5 req/s token bucket, 4s/8s/16s backoff
- `normalize.ts` (172 lines) — DailyMedSPLSchema, LOINC filter (34066-1/34071-1/34067-9/34068-7) + fuzzy fallback
- `handler.ts` (253 lines) — SPL pipeline, dedup on content_hash
- `index.ts` (41 lines) — Deno entry

### Modified
- `leanshot/vite.config.ts` — zod v3 compat alias (`'zod'` → `node_modules/zod/v3/index.js`) + 12 federated test paths

## Decisions Made

1. **handler.ts separation** (mirrors rag-embed-approved pattern): index.ts imports `npm:` specifiers for Deno runtime; handler.ts has no `npm:` imports — Vitest-testable via DI injection. This is necessary because Vite can't bundle Deno `npm:@supabase/supabase-js@2` specifiers.

2. **Schema adaptation — rag_chunks vs kb_chunks_queue**: The plan referenced `kb_chunks_queue` (from PLAN.md interfaces section) but the actual table is `rag_chunks` per Phase 50 schema (Wave 1 context note confirmed). Adapted all insert payloads to use real columns: `canonical_url`/`source_tier`/`content_hash`/`topic_id`/`source_id`.

3. **Dedup via content_hash**: `rag_chunks` has no `external_id` column. Dedup implemented via `sha256(source_text_excerpt)` as `content_hash`, leveraging the `rag_chunks_dedup_uq` UNIQUE index on `(topic_id, source_id, content_hash)`.

4. **topic_id/source_id resolution per-call**: Handler looks up `rag_topics` by `tag` and `rag_sources` by `domain` on each invocation (no new migration needed). `rag_sources` seed already has `pubmed.ncbi.nlm.nih.gov` and `dailymed.nlm.nih.gov`. FDA adapter uses `api.fda.gov` — no seed row exists, so FDA Fn returns 500 with `rag_source_not_found` until 60-01 seed is extended or 60-15 adds it.

5. **zod v3 compat via Vite alias**: Installed zod is v4 (`node_modules/zod/v4`). Edge Fns use `npm:zod@^3` (v3). Added vite alias `'zod'` → `node_modules/zod/v3/index.js` (v4 ships a v3 compat layer) so Edge Fn source files can use `import { z } from 'zod'` testable under Vitest.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Schema adaptation: rag_chunks vs plan's kb_chunks_queue**
- **Found during:** Task 2 (before implementation)
- **Issue:** Plan interfaces declared `kb_chunks_queue` with `source_url`, `tier`, `external_id`, `evidence_date` etc. Actual Phase 50 schema is `rag_chunks` with `canonical_url`, `source_tier`, `content_hash`, `topic_id`, `source_id`. Wave 1 context note explicitly flagged this.
- **Fix:** All 3 adapters use real `rag_chunks` columns. Dedup uses `content_hash` instead of `external_id`.
- **Files modified:** All 3 handler.ts + normalize.ts files
- **Committed in:** Tasks 2-4 commits

**2. [Rule 1 - Bug] posthog-rag-events.ts API mismatch**
- **Found during:** Task 2 (reading actual posthog-rag-events.ts)
- **Issue:** Plan described `emitRagCostEnvelopeBreach({trace_id, surface, cap_kind, cap_usd, actual_usd})` but actual 60-02 export is `emitCostEnvelopeBreach({properties: CostEnvelopeBreachProperties})` with different field names.
- **Fix:** Used actual exported function signatures. All emitters use injectable DI in handler.ts for testability.
- **Files modified:** All handler.ts files
- **Committed in:** Tasks 2-4

**3. [Rule 1 - Bug] slack-guardrail-alert.ts channel names**
- **Found during:** Task 1 (reading actual slack-guardrail-alert.ts)
- **Issue:** Plan used `channel: 'alerts-pharma02'` but actual export expects `GuardrailAlertChannel = 'pharma02'|'rag'|'cost'|...`
- **Fix:** Used correct channel keys throughout.
- **Files modified:** federated-host-allowlist.ts + all handler.ts files
- **Committed in:** Tasks 1-4

**4. [Rule 2 - Missing Critical] federated_source_cache schema deviation**
- **Found during:** Task 1
- **Issue:** Plan described cache schema as `(source, query_hash, response_jsonb, expires_at)` but actual 60-01 migration used `(source_name, cache_key, payload, expires_at)`.
- **Fix:** federated-cache.ts uses actual column names throughout.
- **Committed in:** Task 1

**5. [Rule 2 - Missing Critical] FDA rag_sources row missing**
- **Found during:** Task 3
- **Issue:** `rag_sources` seed (Phase 50) has `pubmed.ncbi.nlm.nih.gov` and `dailymed.nlm.nih.gov` but NO `api.fda.gov` row. FDA Fn will return 500 until seed is extended.
- **Fix:** Handler returns graceful 500 `{error: 'rag_source_not_found'}` rather than crashing. No migration added here (60-15 owns seeding).
- **Files modified:** rag-federated-fda/handler.ts
- **Committed in:** Task 3

---

**Total deviations:** 5 auto-fixed (3 Rule 1 API mismatches, 2 Rule 2 schema/data gaps)
**Impact on plan:** All deviations due to schema reality vs plan assumptions. No scope changes. All security properties (SSRF, PII, PHARMA-02) implemented as specified.

## Threat-Model Dispositions Verified

| Threat ID | Disposition | Implementation |
|-----------|-------------|----------------|
| T-60-07-01 | mitigated | `assertAllowedHost`: https-only + 3-host strict equality + IP literal deny (127.x, 169.254.x) + PostHog + Slack P1 pharma02 on trip |
| T-60-07-02 | mitigated | zod-validates every REST response; HTML content-type → `RateLimitTruncationError`; writes `last_error` |
| T-60-07-03 | mitigated | Explicit allowlist in `normalizeOpenFDADrugEvent` — patientonsetage/weight/sex/agegroup never touched; regression test in Task 3 |
| T-60-07-04 | mitigated | All chunks: `source_tier='A'` `status='queued'`; CI grep gate in Task 5 returns empty for auto-publish patterns |
| T-60-07-05 | mitigated | PubMed: exp 1s/2s/4s + 24h cache; OpenFDA: sliding window 240/min + exp 2s/4s/8s; DailyMed: token bucket 5/s + exp 4s/8s/16s |
| T-60-07-06 | mitigated | historical-seed clamped 30d; full-historical requires `x-admin-action-token` header |
| T-60-07-07 | mitigated | Cache key = `(source_name, cache_key)` composite UNIQUE; sha256 param-sorted; deep-copy on write |
| T-60-07-08 | accepted | `created_by = SYSTEM_FEDERATED_UUID` + `content_hash` per chunk — traceable |
| T-60-07-SC | mitigated | No new npm packages; per-Fn deno.json pins versions |

## Known Stubs

None. All handlers are fully wired. The FDA adapter returns a graceful error (not a stub) when `rag_sources` has no row for `api.fda.gov` — this is tracked as deviation #5 above and deferred to 60-15.

## Carry-over to 60-15

**60-15 MUST deploy `rag-federated-pubmed rag-federated-fda rag-federated-dailymed` BEFORE any cron migration registers schedules against these Fns.** Initial cron cadence per CONTEXT.md = daily 03:00 UTC.

Deploy command:
```bash
supabase functions deploy rag-federated-pubmed rag-federated-fda rag-federated-dailymed --project-ref <ref>
```

Operator-supplied env vars (optional, relax rate limits):
- `PUBMED_API_KEY` — relaxes 3 req/s → 10 req/s
- `OPENFDA_API_KEY` — relaxes 240 req/min → 240k req/day

**Additionally for 60-15:** Add `rag_sources` seed row for `api.fda.gov` (domain + tier='A' + freshness_window_days=365) so FDA adapter can resolve `source_id`. Current behavior: FDA Fn returns 500 `{error: 'rag_source_not_found'}` when no row exists.

## Issues Encountered

1. **Vitest can't resolve `npm:zod@3` specifiers** (Deno-native) — Resolved by adding `'zod'` → `node_modules/zod/v3/index.js` Vite alias. Zod v4 ships a v3 compat layer at `v3/` subdirectory.

2. **`federated-cache.ts` originally imported `supabase-server.ts`** directly, which uses `npm:@supabase/supabase-js@2` — Vitest can't bundle this. Resolved by switching to dependency injection pattern (SupabaseLike interface) matching rag-embed-approved handler.ts.

## Next Phase Readiness

- 60-07 code ships clean; 80 vitest cases pass; tsc exits 0
- **60-08** (admin queue UI): can start immediately — rag_chunks rows will be queued by these Fns after 60-15 deploys
- **60-09** (admin toggle UI): can start immediately — `federated_sources` table exists with enabled column
- **60-15 BLOCKING**: must deploy these 3 Fns before adding pg_cron schedules

---
*Phase: 60-rag-knowledge-base-completion-waves-2-4*
*Completed: 2026-05-26*
