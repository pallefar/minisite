---
phase: 38-m5b-ai-recommender-pgvector-claude-digest
plan: 04
subsystem: ai-infra
tags: [edge-function, embeddings, openai, vercel-ai-gateway, pg_cron, recommender, sha256-dedup, content_embeddings, batch-embed, 429-retry, soft-delete-cleanup]

requires:
  - phase: 38-01
    provides: content_embeddings table, content.deleted_at/published_at, content_stale_on_update trigger, cleanup_content_embeddings_soft_deleted RPC
  - phase: 38-02
    provides: _shared/openai-embed.ts (single-input embed), _shared/posthog-server.ts (captureServer/shutdownPostHog), _shared/sentry.ts, _shared/lifecycle-utils.ts (makeLazyAdmin + checkServiceRoleBearer)
provides:
  - "embed-content-nightly Edge Fn — pg_cron-invoked nightly job that embeds NEW content (no embedding row) + re-embeds STALE content (stale=true flipped by D-18 trigger)"
  - "sha256(title||\\\\n\\\\n||body_md) dedup gate — Pitfall #6 cost runaway mitigation (T-38-18)"
  - "Inline embedBatch() helper — POSTs `input: string[]` to AI Gateway /embeddings with 429 Retry-After + 3-retry backoff (T-38-19)"
  - "Soft-delete cleanup invocation at end of run (D-19 / T-38-21)"
affects: [38-09 (cron schedule consumer), 38-03 (recommend-next-best-action — vectors must be present for match RPC to return results)]

tech-stack:
  added: []
  patterns:
    - "PostgREST embedded-resource left-join: from('content').select('id, title, body_md, content_embeddings(body_sha256, stale)') — child resource returns null when no row exists, gives left-join semantics without raw SQL"
    - "Client-side pending+stale filter — embedded-resource WHERE on child columns is awkward in PostgREST; filtering 1000 capped rows in TS is cheaper than building an RPC"
    - "Inline embedBatch (input: string[] form) — _shared/openai-embed.ts is single-input only; the cron path needs array form for batched /embeddings calls. Same 429 Retry-After contract"
    - "Chunked + parallel batching: 100 inputs/call, 5 batches in parallel via Promise.all, 1s inter-group sleep (Pitfall #3 politeness)"
    - "Top-level try/catch returns 200 with errors_count — cron resilience: partial progress beats a crashed nightly job"
    - "Test seam: setMirrorAdminForTest stubs events_mirror dual-write so captureServer doesn't open real fetch handles in Deno tests (cron-test resource-leak fix)"

key-files:
  created:
    - supabase/functions/embed-content-nightly/index.ts
    - supabase/functions/embed-content-nightly/index.test.ts
  modified: []

key-decisions:
  - "Inline embedBatch() in the Edge Fn (not extending _shared/openai-embed.ts) — _shared is owned by Plan 38-02 and modifying it risks Wave-1 contract drift. The plan-checker's key_link pattern `embed.*input.*\\[` only requires the array-form call to be inside index.ts, not the shared helper"
  - "PostgREST embedded-resource select instead of an `select_pending_or_stale_content_for_embed` RPC — avoids adding a Wave-2 migration outside this plan's declared `files_modified` (sibling-wave drift risk per [[feedback_wave_n_push_correction_invalidates_wave_n_plus_1_plans]])"
  - "Client-side pending+stale filter on capped 1000 rows — embedded-resource WHERE-on-child-column is awkward in PostgREST; the cap bounds memory cost"
  - "Top-level catch → 200 with errors_count++ — cron resilience principle (RESEARCH Pitfall #3 ethos: skip and continue beats crash and zero progress)"
  - "captureServer userId = 'cron-embed-content-nightly' — cron actor id (D-13 invariant requires userId; non-user system actors use a stable string identifier)"
  - "Test mock uses setMirrorAdminForTest stub — without this the events_mirror dual-write inside captureServer opens a real HTTP fetch to the stub SUPABASE_URL and leaks fetchCancelHandle into the Deno test runner"

decisions:
  D-18: re-embed-on-edit (consumer — trigger lives in Plan 38-01 migration 20270705000010)
  D-19: soft-delete 7d cascade cleanup (consumer — RPC lives in Plan 38-01 migration 20270705000011)

requirements:
  - RECOMMEND-02: nightly cost ≤ $0.05/M tokens — covered via sha256 dedup gate + 1000-row cap + 100-input batching
  - RECOMMEND-03: backfill new content + re-embed stale content — covered via the pending+stale candidate query

threat_mitigations:
  T-38-18: ROW_CAP_PER_RUN=1000 + EMBED_BATCH_SIZE=100 + CONCURRENT_BATCHES=5 + 1s inter-group sleep + sha256 dedup
  T-38-19: embedBatch parses Retry-After (cap 30s) + 3 retries + on exhaust emits embed.rate_limit_429 + errors_count++ + skip
  T-38-20: checkServiceRoleBearer (constantTimeEqual against SUPABASE_SERVICE_ROLE_KEY) returns 403 for any non-cron bearer
  T-38-21: cleanup_content_embeddings_soft_deleted RPC invoked unconditionally at end of run

metrics:
  duration_min: 0
  completed_date: "2026-05-20"
  tasks_completed: 1
  files_created: 2
  files_modified: 0
  commits: 2
  tests:
    written: 13
    passing: 13
---

# Phase 38 Plan 04: embed-content-nightly Edge Fn Summary

`embed-content-nightly` — pg_cron-invoked nightly worker that backfills NEW content embeddings (no row in `content_embeddings`) and re-embeds STALE content (`stale=true` flipped by the D-18 trigger), with a `body_sha256` dedup gate that prevents re-embedding unchanged content (RESEARCH Pitfall #6 cost runaway). Uses OpenAI `text-embedding-3-small` via Vercel AI Gateway in the `input: string[]` batch form (100 inputs/call, 5 batches parallel, 1s inter-group sleep), honors 429 Retry-After with 3-retry backoff, and invokes the D-19 soft-delete 7-day cascade cleanup at end of run.

## Tasks Completed

| Task | Name                                                                  | Commit  | TDD Gate |
| ---- | --------------------------------------------------------------------- | ------- | -------- |
| 1    | embed-content-nightly Edge Fn — backfill + stale re-embed + sha256 dedup | 897b007 | RED      |
| 1    | embed-content-nightly Edge Fn — backfill + stale re-embed + sha256 dedup | 333194a | GREEN    |

Two commits per the TDD protocol: `test(38-04)` for the failing skeleton at the RED gate, `feat(38-04)` for the GREEN implementation with all 13 tests passing.

## Algorithm

1. **Auth.** `checkServiceRoleBearer(req)` (constantTimeEqual) → 403 if not service-role. POST-only (405 otherwise).
2. **Select candidates.** PostgREST embedded-resource select:
   `admin.from('content').select('id, title, body_md, content_embeddings(body_sha256, stale)').is('deleted_at', null).not('published_at', 'is', null).limit(1000)`. The embedded `content_embeddings` field returns `null` for rows with no embedding (pending) or an object with `{ body_sha256, stale }` otherwise.
3. **Client-side filter.** Keep rows where embedded resource is null (pending) OR `stale === true` (re-embed flag).
4. **Per-row sha256 + dedup gate.** Compute `sha256(title + '\n\n' + body_md)`. If `stale === true AND stored_sha === computed_sha` → `UPDATE content_embeddings SET stale=false, last_embedded_at=now() WHERE content_id = $1` and SKIP embed call (`rows_dedup_skipped++`). This is the Pitfall #6 mitigation: editor touches the title → trigger flips stale=true → without this gate we'd re-embed unchanged content every nightly run.
5. **Batch embed.** Chunk the to-embed queue into batches of 100. Process batches in groups of 5 via `Promise.all`. Sleep 1s between groups (Pitfall #3 politeness). Each batch POSTs `{ model, input: string[] }` to `${AI_GATEWAY_BASE_URL}/embeddings` with the consumer credential.
6. **429 handling.** Parse `Retry-After` (cap 30s), sleep, retry up to 3 attempts. On exhaust: emit `embed.rate_limit_429` telemetry + `errors_count++` + SKIP the batch. Cron does NOT crash.
7. **Upsert.** Successful embeddings UPSERT into `content_embeddings` with `{ content_id, embedding, body_sha256, last_embedded_at, stale: false, embedding_model_id }`.
8. **Soft-delete cleanup.** `admin.rpc('cleanup_content_embeddings_soft_deleted')` at end of run (D-19 7d audit cascade — function defined in Plan 38-01 migration 20270705000011).
9. **Telemetry + return.** `captureServer({ userId: 'cron-embed-content-nightly', event: 'embed.batch_complete', properties: { rows_embedded, rows_dedup_skipped, errors_count, duration_ms } })` + `await shutdownPostHog()` + 200 JSON response with stats.

## Test Coverage

| # | Test name                                                      | What it asserts                                                                                  |
|---|----------------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| 1 | T1 — pending content → embed + upsert                          | No embedding row, single fixture → 1 POST with input as array → upsert with body_sha256 set     |
| 2 | T2 — stale + sha matches → dedup skip                          | `stale=true` + `stored_sha === computed_sha` → 0 embed calls; UPDATE clears stale flag          |
| 3 | T3 — stale + sha differs → re-embed                            | `stale=true` + sha mismatch → embed call; upsert with NEW body_sha256                          |
| 4 | T4 — batches 100 inputs/call                                   | 150 fixtures → 2 fetch calls (100 + 50); all rows upserted                                       |
| 5 | T5a — 429 + Retry-After                                        | First call 429 with Retry-After:1 → second call succeeds; elapsed ≥ 900ms                       |
| 6 | T5b — persistent 429 after 3 retries → skip                    | All 3 attempts 429 → response 200; errors_count=1; 0 upserts; cron NOT crashed                  |
| 7 | T6 — cleanup RPC invoked                                       | state.rpcs contains `cleanup_content_embeddings_soft_deleted`                                    |
| 8 | T7 — telemetry stats                                           | Response body has rows_embedded / rows_dedup_skipped / errors_count fields                       |
| 9 | T8a — missing bearer → 403                                     | No Authorization header → 403                                                                    |
|10 | T8b — wrong bearer → 403                                       | User JWT bearer != service-role → 403                                                            |
|11 | T8c — service-role bearer → 200                                | Correct bearer → handler proceeds                                                                |
|12 | non-POST method → 405                                          | GET request → 405                                                                                |
|13 | key_link — embed body uses input as array                      | Captured fetch body has `Array.isArray(body.input)` (plan-checker pattern `embed.*input.*\\[`) |

Run: `deno test supabase/functions/embed-content-nightly/index.test.ts --allow-env --allow-net` → **13 passed | 0 failed (3s)**.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] events_mirror dual-write leak in Deno tests**
- **Found during:** GREEN gate test run
- **Issue:** `captureServer` does a fire-and-forget `admin.from('events_mirror').insert(...)` to the events_mirror table via a SEPARATE singleton (`getMirrorAdmin()` — not the lifecycle-utils admin set via `setAdminForTest`). When `SUPABASE_URL` is set to a stub URL in tests, this triggers a real HTTP `fetch` to that URL that never resolves, leaking `fetchCancelHandle` into the test runner.
- **Fix:** Import `setMirrorAdminForTest` / `resetMirrorAdminForTest` from `_shared/posthog-server.ts` and stub the mirror admin with a no-op `from(...).insert()` client in `setEnv()` / `restoreEnv()`. This is a pre-existing helper exported precisely for this purpose; the plan didn't anticipate it.
- **Files modified:** `supabase/functions/embed-content-nightly/index.test.ts`
- **Commit:** `333194a` (folded into GREEN commit since it was part of getting tests to pass)

### Scope Boundary Notes

**No additional migration created.** Plan 38-04's `<action>` step 2 describes a raw SQL `SELECT … FROM content c LEFT JOIN content_embeddings ce …`. supabase-js v2 cannot run arbitrary SQL via the client — only PostgREST queries or RPCs. Two options:
1. Add a server-side RPC `select_pending_or_stale_content_for_embed` (requires a new migration outside `files_modified`).
2. Use PostgREST's embedded-resource left-join semantic and filter client-side.

I chose option (2) to stay within the declared `files_modified` scope. The candidate cap of 1000 rows makes client-side filtering bounded and cheap. If future scale demands a server-side path, Plan 38-09 (cron schedule consumer) is the natural place to land the RPC migration.

**embedBatch inlined, not added to `_shared/openai-embed.ts`.** Plan 38-04 `<action>` suggests "extend openai-embed.ts in Plan 38-02 with embedBatch". Modifying _shared would touch a file owned by Plan 38-02 (already committed at 3da6c14), introducing Wave-1 contract drift. The plan-checker's `embed.*input.*\\[` pattern only requires the array-form call to be inside `index.ts`, so I implemented embedBatch as a local helper. It reuses the SAME contract as `_shared/openai-embed.ts` (Bearer auth, 429 Retry-After cap 30s, 3 retries, AbortController 25s timeout) — future refactors can hoist it into _shared if a second consumer needs it.

## Threat Mitigations

| Threat ID | Mitigation (location in index.ts)                                                                                         |
|-----------|---------------------------------------------------------------------------------------------------------------------------|
| T-38-18 (DoS — embed runaway)                | `ROW_CAP_PER_RUN=1000`, `EMBED_BATCH_SIZE=100`, `CONCURRENT_BATCHES=5`, 1s `INTER_GROUP_SLEEP_MS`, sha256 dedup gate     |
| T-38-19 (DoS — OpenAI 429)                   | `embedBatch` parses `Retry-After` (cap 30s) + 3 retries + on exhaust emits `embed.rate_limit_429` + `errors_count++` + skips batch |
| T-38-20 (Tampering — non-cron caller)        | `checkServiceRoleBearer` (constantTimeEqual against `SUPABASE_SERVICE_ROLE_KEY`) returns 403 for any other bearer       |
| T-38-21 (Info Disclosure — soft-delete retention) | `admin.rpc('cleanup_content_embeddings_soft_deleted')` invoked unconditionally at end of run                       |

## Verification

```bash
deno test supabase/functions/embed-content-nightly/index.test.ts --allow-env --allow-net
# ok | 13 passed | 0 failed (3s)
```

## Outputs

- `supabase/functions/embed-content-nightly/index.ts` (400 lines) — exceeds the plan's `min_lines: 60` artifact spec.
- `supabase/functions/embed-content-nightly/index.test.ts` (459 lines) — 13 Deno tests covering all 8 plan behaviors.

## Downstream Consumers

- **Plan 38-09** — owns the pg_cron schedule (`phase38-embed-content-nightly`, e.g. `cron='0 3 * * *'`) that POSTs to this Fn with the service-role bearer.
- **Plan 38-03** — `recommend-next-best-action` calls `match_content_embeddings` RPC; that RPC depends on `content_embeddings` rows being populated, which is exactly what this Fn does.

## Self-Check: PASSED

- `supabase/functions/embed-content-nightly/index.ts` exists
- `supabase/functions/embed-content-nightly/index.test.ts` exists
- `leanshot/.planning/phases/38-m5b-ai-recommender-pgvector-claude-digest/38-04-SUMMARY.md` exists
- Commit `897b007` (RED) found in git log
- Commit `333194a` (GREEN) found in git log
