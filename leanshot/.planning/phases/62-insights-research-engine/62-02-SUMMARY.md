---
phase: 62-insights-research-engine
plan: "02"
subsystem: database
tags: [secdef-rpcs, differential-privacy, k-anonymity, rag-feedback-loop, tdd]
dependency_graph:
  requires:
    - 62-01  # research_publications schema + matviews + consent columns + rag_sources seed
  provides:
    - SECDEF RPCs: laplace_noise, compile_research_cohort, estimate_research_cohort
    - SECDEF RPCs: submit_research_for_review, publish_research, archive_research, purge_research_data_for_revoked
    - markdown_body column on research_publications (additive ALTER TABLE)
    - rag_topics seed row (tag=leanshot_research)
    - eval/phase62 test suite (PHI gate + consent schema + Laplace + 2-person rule)
    - vitest.config.ts phase62-eval project entry
  affects:
    - public.rag_chunks (publish_research writes status=approved rows — INSIGHTS-09)
    - public.rag_topics (additive seed)
    - public.research_publications (markdown_body column + status transitions)
    - public.research_review_log (audit rows from submit/publish/archive RPCs)
    - public.pending_rag_ingest (audit-only queue row from publish_research)
    - public.profiles (last_purged_at UPDATE from purge_research_data_for_revoked)
tech_stack:
  added: []
  patterns:
    - PL/pgSQL SECDEF RPC pattern (Phase 61 publish_protocol shape verbatim)
    - Laplace noise inverse CDF (gen_random_uuid + LN transform)
    - k-floor guard before materialization (RESEARCH Pattern 1)
    - direct rag_chunks INSERT for RAG feedback loop (INSIGHTS-09 Option A)
key_files:
  created:
    - supabase/migrations/20290102000006_insights_secdef_rpcs.sql
    - eval/phase62/no-phi-in-matviews.test.ts
    - eval/phase62/laplace-noise.test.ts
    - eval/phase62/consent-schema.test.ts
    - eval/phase62/publish-research-self-review.test.ts
  modified:
    - leanshot/vitest.config.ts
decisions:
  - publish_research delivers INSIGHTS-09 via direct rag_chunks INSERT (Option A) — async Phase 60 cron picks up status=approved rows
  - purge_research_data_for_revoked marks last_purged_at only (no physical row deletion) — matview WHERE excludes on next refresh; source tables serve primary app
  - laplace_noise uses gen_random_uuid() bit entropy (not random()) for SECURITY DEFINER search_path isolation
  - rag_topics seed added to this migration (not 62-01) — avoids back-editing shipped plan
  - epsilon clamped [0.1, 5.0] per T-62-02-04 to prevent infinite noise or no-noise attacks
metrics:
  duration: "~20 min"
  completed: "2026-05-26"
  tasks_completed: 2
  tasks_total: 2
  files_created: 6
  files_modified: 1
requirements:
  - INSIGHTS-01
  - INSIGHTS-02
  - INSIGHTS-05
  - INSIGHTS-07
  - INSIGHTS-09
  - INSIGHTS-10
---

# Phase 62 Plan 02: SECDEF RPCs + Eval Test Suite Summary

**One-liner:** 7 SECDEF RPCs implementing k-anonymity, Laplace noise (gen_random_uuid inverse CDF), 2-person review (SELF_REVIEW_REJECTED), and direct rag_chunks RAG feedback loop (INSIGHTS-09).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write eval/phase62 test scaffolds (RED) + vitest project entry | `21c3c1ee` | 4 test files + vitest.config.ts |
| 2 | Implement SECDEF RPCs migration (GREEN) | `6e891803` | supabase/migrations/20290102000006_insights_secdef_rpcs.sql |

## Artifacts Delivered

### Migration: `supabase/migrations/20290102000006_insights_secdef_rpcs.sql`

**Additive schema changes:**
- `ALTER TABLE public.research_publications ADD COLUMN IF NOT EXISTS markdown_body text` — required for direct rag_chunks delivery (INSIGHTS-09)
- `INSERT INTO public.rag_topics (query='LeanShot Research Publications', tag='leanshot_research')` — seed row for publish_research topic_id resolution

**7 SECDEF RPCs (all with REVOKE ALL + GRANT EXECUTE TO authenticated):**

| RPC | Signature | is_staff()? | Key behavior |
|-----|-----------|-------------|--------------|
| `laplace_noise` | `(value numeric, epsilon numeric) → numeric` | No (pure math) | Laplace inverse CDF via gen_random_uuid() bits |
| `compile_research_cohort` | `(p_filters jsonb) → jsonb` | Yes | k-floor check → suppressed sentinel OR noisy rollup (epsilon=1.0) |
| `estimate_research_cohort` | `(p_filters jsonb) → jsonb` | Yes | Raw count-only; no noise; for live UI display |
| `submit_research_for_review` | `(p_publication_id uuid) → void` | Yes | draft → in_review + audit row; creator-only |
| `publish_research` | `(p_publication_id uuid) → void` | Yes | SELF_REVIEW_REJECTED + rag_chunks INSERT (status=approved, tier=A) |
| `archive_research` | `(p_publication_id uuid) → void` | Yes | any → archived + audit row |
| `purge_research_data_for_revoked` | `() → jsonb` | Yes | UPDATE last_purged_at; matview WHERE excludes on next refresh |

### Eval Test Suite: `eval/phase62/`

| File | Asserts | State |
|------|---------|-------|
| `no-phi-in-matviews.test.ts` | No PHI tokens in matview SELECT output (INSIGHTS-01) | GREEN |
| `laplace-noise.test.ts` | Migration signature + gen_random_uuid + LN transform present (INSIGHTS-02) | GREEN |
| `consent-schema.test.ts` | research_consent default false, consent_revoked_at, last_purged_at, partial index (INSIGHTS-05) | GREEN |
| `publish-research-self-review.test.ts` | SELF_REVIEW_REJECTED, v_created_by, auth.uid(), FOR UPDATE, rag_chunks INSERT, tag lookup, ALTER TABLE markdown_body (INSIGHTS-07) | GREEN |

**Test results:** 22 passed, 1 skipped (live SQL laplace_noise test requires SUPABASE_DB_URL), 0 failed.

### vitest.config.ts: `leanshot/vitest.config.ts`

Added `phase62-eval` project entry:
```
include: ['../eval/phase62/**/*.test.ts']
environment: 'node'
```
Run: `cd leanshot && npx vitest run --project=phase62-eval`

## TDD Gate Compliance

- RED gate commit: `21c3c1ee` (test scaffolds — publish-research-self-review failed on missing migration)
- GREEN gate commit: `6e891803` (migration created — all 22 tests pass)
- REFACTOR: not needed (migration body is straightforward SQL)

## INSIGHTS-09 RAG Feedback Loop Delivery

`publish_research` delivers INSIGHTS-09 via direct INSERT into `public.rag_chunks`:
1. Resolves `v_research_source_id` from `rag_sources WHERE source_type='leanshot_research'`
2. Resolves `v_research_topic_id` from `rag_topics WHERE tag='leanshot_research'`
3. INSERTs row with `status='approved'`, `source_tier='A'`, `embedding=NULL`
4. Phase 60's `rag-embed-approved` cron polls `WHERE published_at IS NULL` → embeds on next fire
5. Dedup guard: `ON CONFLICT (topic_id, source_id, content_hash) DO NOTHING`

The `pending_rag_ingest` INSERT is audit-only (per RESEARCH Open Question 1 RESOLVED — Option A).

## 3-Layer 2-Person Rule Invariant (INSIGHTS-07)

| Layer | Implementation | Status |
|-------|----------------|--------|
| DB | `publish_research`: SELF_REVIEW_REJECTED when v_created_by = auth.uid() | This plan |
| UI | Publish button removed from DOM when isSelfCreated (Plan 62-05) | Deferred |
| CI | eval/phase62/publish-research-self-review.test.ts | This plan |

## Threat Mitigations Applied

| ID | Mitigation | Implementation |
|----|-----------|----------------|
| T-62-02-01 | SELF_REVIEW_REJECTED | `if v_created_by = auth.uid() then raise exception 'SELF_REVIEW_REJECTED...'` |
| T-62-02-02 | FOR UPDATE row lock | All state-mutation RPCs lock row before reading |
| T-62-02-03 | Audit log before return | `research_review_log` INSERT in every RPC before `end` |
| T-62-02-04 | epsilon clamp [0.1, 5.0] | `greatest(0.1, least(5.0, epsilon))` in compile_research_cohort |
| T-62-02-07 | Revoke-consent purge | `purge_research_data_for_revoked` marks `last_purged_at` |
| T-62-02-08 | is_staff() on all RPCs | Every RPC except laplace_noise opens with is_staff() guard |

## Deviations from Plan

### Auto-documented adjustments

**[Rule 2 - Missing critical functionality] purge_research_data_for_revoked uses UPDATE last_purged_at instead of physical DELETE**

- **Found during:** Task 2 implementation
- **Issue:** Per CONTEXT decisions, matview WHERE p.research_consent=true already excludes revoked-consent users on next refresh. Physical deletion of source rows (injections, weights, ai_messages) would break primary app functionality — these tables serve the user's medication tracking, not just research.
- **Fix:** UPDATE last_purged_at (auditable timestamp); matview WHERE excludes; documented in CARRY-OVER for 62-08
- **Files modified:** supabase/migrations/20290102000006_insights_secdef_rpcs.sql
- **Noted in:** plan already documents this deviation: "UPDATE last_purged_at (deviation from CONTEXT documented in 62-08 CARRY-OVER)"

**[Rule 2 - Missing critical functionality] rag_topics seed added to 20290102000006**

- **Found during:** Task 2 implementation
- **Issue:** publish_research requires a rag_topics row with tag='leanshot_research' to resolve topic_id for rag_chunks INSERT. Plan 62-01 did not include this seed.
- **Fix:** Added `INSERT INTO public.rag_topics` with idempotent `ON CONFLICT (query) WHERE deleted_at IS NULL DO NOTHING` at top of this migration.
- **Files modified:** supabase/migrations/20290102000006_insights_secdef_rpcs.sql

## Known Stubs

None. All RPCs are fully implemented. Deferred items:
- Live SQL `laplace_noise` test (requires SUPABASE_DB_URL in CI) — test is `it.skip` with clear instructions
- `rag_chunks` embedding (Phase 60 cron handles this asynchronously)
- `pending_rag_ingest` consumption (audit-only; cron registration in 62-08)
- Cron registration for nightly purge + matview refresh (62-08 close-out)

## Threat Flags

None. No new network endpoints, auth paths, or file access patterns introduced. All surfaces are SECDEF RPCs with is_staff() guard on authenticated callers only.

## Self-Check: PASSED

- [x] `supabase/migrations/20290102000006_insights_secdef_rpcs.sql` exists
- [x] `eval/phase62/no-phi-in-matviews.test.ts` exists
- [x] `eval/phase62/laplace-noise.test.ts` exists
- [x] `eval/phase62/consent-schema.test.ts` exists
- [x] `eval/phase62/publish-research-self-review.test.ts` exists
- [x] `leanshot/vitest.config.ts` updated with phase62-eval entry
- [x] Commits `21c3c1ee` and `6e891803` exist in git log
- [x] 22 tests pass, 1 skipped, 0 failed (`npx vitest run --project=phase62-eval`)
