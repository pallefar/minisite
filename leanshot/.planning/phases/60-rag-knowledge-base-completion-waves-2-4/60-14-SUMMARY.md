---
phase: 60
plan: 14
subsystem: rag-cost-dashboard
tags: [rag, cost-dashboard, posthog, admin-ui, edge-fn]
dependency_graph:
  requires: [60-01]
  provides: [rag-cost-query Edge Fn, RagCostPage, cost-api client, rag_budget_caps migration]
  affects: [src/components/admin/rag/RagLayout.tsx]
tech_stack:
  added: []
  patterns:
    - PostHog HogQL Query API (server-side, parameterized)
    - SECDEF RPC with is_staff() re-check (T-60-14-TAMPER-1 defense-in-depth)
    - PII strip at Edge Fn boundary (positional column access only)
    - Admin JWT + profiles.is_staff() gate (T-60-14-INFO-1)
key_files:
  created:
    - supabase/migrations/20281201000011_rag_budget_caps.sql
    - supabase/functions/rag-cost-query/index.ts
    - supabase/functions/rag-cost-query/deno.json
    - supabase/functions/rag-cost-query/__tests__/posthog-query.test.ts
    - leanshot/src/lib/admin/rag/cost-api.ts
    - leanshot/src/lib/admin/rag/__tests__/cost-api.test.ts
    - leanshot/src/components/admin/rag/RagCostPage.tsx
    - leanshot/src/components/admin/rag/__tests__/RagCostPage.test.tsx
  modified:
    - leanshot/src/components/admin/rag/RagLayout.tsx
decisions:
  - No rag_cost_log table: PostHog Query API is sole source of truth per AI-SPEC §7 line 945
  - Full base RagCostPage built here (50-09 deferred; CostPlaceholder confirmed present at plan time)
  - Edge Fn deployment deferred to 60-15 BLOCKING per fn-deploy-before-cron-push rule
  - is_super_admin() does not exist on this project; is_staff() used throughout (verified via grep)
  - PlaceholderCard function removed (was only used by CostPlaceholder; TS noUnusedLocals violation)
metrics:
  duration: ~45 minutes
  completed: "2026-05-26"
  tasks_completed: 5
  files_modified: 9
---

# Phase 60 Plan 14: Cost Dashboard Extension Summary

**One-liner:** Full RagCostPage with 9 vendor/cron cards, admin-gated PostHog HogQL Edge Fn, SECDEF budget-cap RPC, and auto-pause banner wired into RagLayout.

## Vendor + Trace Identifier Strings

Downstream emitters (60-04..07, 60-11, 60-12) MUST match these strings for dashboard cards to show data:

### Vendor identifier strings (ALLOWED_VENDORS in rag-cost-query/index.ts)
| String | Card Label | Expected Emitter |
|--------|-----------|-----------------|
| `firecrawl` | Firecrawl | rag-scrape-runner (confirmed emitting) |
| `openai_embed` | OpenAI embeddings | rag-embed-approved (DRIFT — see below) |
| `anthropic_summarize` | Anthropic summarizer | rag-summarize-and-chunk (DRIFT — see below) |
| `cohere_rerank` | Cohere rerank | rag-retrieve (not yet confirmed emitting) |
| `jina_rerank` | Jina rerank | rag-retrieve (env-flag path; not yet confirmed) |
| `federated_fetch` | Federated source fetch | rag-federated-* (not yet confirmed emitting) |

### Trace rollup identifier strings (HogQL trace_id LIKE prefix)
| Identifier | Label | Trace Prefix |
|-----------|-------|-------------|
| `coach_synthesis_per_day` | Coach synthesis / day | `coach_query_` |
| `tip_of_day_per_day` | Tip-of-day cron / day | `tip_of_day_cron_` |
| `newsletter_per_week` | Newsletter cron / week | `newsletter_cron_` |

## HogQL Query Shape

For vendor queries:
```sql
SELECT toDate(timestamp) as day, sum(toFloat(coalesce(properties.$ai_generation_usage_total_cost, '0'))) as cost
FROM events
WHERE event = '$ai_generation'
  AND properties.vendor = {vendor:String}
  AND timestamp >= now() - INTERVAL {days:Int64} DAY
GROUP BY day
ORDER BY day
```

For trace rollup queries:
```sql
SELECT toDate(timestamp) as day, sum(toFloat(coalesce(properties.$ai_generation_usage_total_cost, '0'))) as cost
FROM events
WHERE event = '$ai_generation'
  AND startsWith(properties.trace_id, {prefix:String})
  AND timestamp >= now() - INTERVAL {days:Int64} DAY
GROUP BY day
ORDER BY day
```

Parameterized — no injection via vendor param (server-side allowlist is defense-in-depth).

## Discoveries for Downstream Phases

### Vendor String Drift (IMPORTANT for 60-04..07)

During codebase audit, the following vendor string mismatches were found:

1. **rag-embed-approved** (`openai_embed` expected):
   - Actually emits `$ai_generation` WITHOUT a `vendor` property at all
   - The properties emitted: `model`, `prompt_tokens`, `usage_total_cost`, `latency_ms`, `trace_id`
   - Impact: dashboard `openai_embed` card will show `$0 / —` until 60-05 is fixed to emit `vendor: 'openai_embed'`

2. **rag-summarize-and-chunk** (`anthropic_summarize` expected):
   - Actually emits `vendor: 'anthropic_summary'` (missing the `e` at end)
   - The `$ai_generation` properties do NOT include the vendor field from the captureRagEvent call
   - Impact: dashboard `anthropic_summarize` card will show `$0 / —` until vendor string is corrected

3. **rag-retrieve** (cohere_rerank / jina_rerank expected): No `$ai_generation` events found in code yet — 60-06 presumably ships these.

4. **rag-federated-*** (federated_fetch expected): No `$ai_generation` vendor events found — 60-07 presumably ships these.

**Dashboard resilience:** Cards show `$0 / —` placeholder for vendors with no matching PostHog data. This is correct behavior (Test 2 in RagCostPage.test.tsx). No blocking issue.

### Sparkline Props (Confirmed)
- `Sparkline` prop signature: `values` (NOT `data`), plus `width`, `height`, `color`, `fill`, `showLastDot`, `className`, `label`
- Empty state uses `values={[0,0,0,0,0,0,0]}` with `label="no data yet"` for accessible fallback

### useToast Hook Signature
- `useToast()` returns `(message: string, kind?: 'success' | 'error' | 'info') => void`
- Auto-dismisses after 2400ms

### is_super_admin() Does Not Exist
- Confirmed via grep of all migrations: no `is_super_admin` function exists on this project
- Both rag-cost-query Edge Fn and rag_acknowledge_budget_cap RPC use `public.is_staff()` only

## Decisions Made

1. **No rag_cost_log table**: PostHog Query API is the sole source of truth per AI-SPEC §7. Creating a parallel table would duplicate PostHog's role (anti-pattern per feedback_3_layer_must_never_invariant_pattern).

2. **Full base RagCostPage built here**: 50-09 deferred stretch wave was confirmed as NOT shipped (`RagLayout.tsx` still had `CostPlaceholder`). This plan owns all 9 cards (3 base + 3 Phase 60 retrieval + 3 cron).

3. **Edge Fn deployment deferred to 60-15 BLOCKING**: Per `feedback_fn_deploy_before_cron_db_push` — all Phase 60 Fn deploys happen in 60-15 after migrations.

4. **PlaceholderCard function removed**: Was only used by CostPlaceholder; removing CostPlaceholder caused `noUnusedLocals` TS error. Rule 3 auto-fix: removed PlaceholderCard too. No functional impact.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Remove PlaceholderCard after CostPlaceholder deletion**
- **Found during:** Task 4 (RagLayout.tsx edit)
- **Issue:** Deleting `CostPlaceholder` left `PlaceholderCard` (the only caller) as unused code. `noUnusedLocals: true` in tsconfig.app.json caused `tsc -b --noEmit` to fail.
- **Fix:** Removed `PlaceholderCard` function from RagLayout.tsx
- **Files modified:** `leanshot/src/components/admin/rag/RagLayout.tsx`
- **Commit:** eb700a53

**2. [Rule 3 - Blocking] Fix import-x/order lint error + remove unused const**
- **Found during:** Overall verification
- **Issue:** `Button` import appeared after `Card` (alphabetical order violation). `TRACE_ROLLUP_REQUEST_KEYS` const was assigned but never used (exported then un-exported).
- **Fix:** Moved `Button` import before `Card`; removed the `TRACE_ROLLUP_REQUEST_KEYS` const entirely.
- **Files modified:** `leanshot/src/components/admin/rag/RagCostPage.tsx`
- **Commit:** 2f453277

## Test Results

| Test Suite | Count | Result |
|-----------|-------|--------|
| Deno: posthog-query.test.ts | 7 | PASS |
| Vitest: cost-api.test.ts | 12 | PASS |
| Vitest: RagCostPage.test.tsx | 14 | PASS |
| **Total** | **33** | **PASS** |

## Architecture

```
Browser (staff only)
  ↓ fetchCostRollup()     [src/lib/admin/rag/cost-api.ts]
  ↓ supabase.functions.invoke('rag-cost-query')
  ↓
Edge Fn: rag-cost-query   [supabase/functions/rag-cost-query/index.ts]
  - JWT verify → profiles.is_staff() gate
  - Vendor allowlist check
  - PostHog Query API (Bearer POSTHOG_PERSONAL_API_KEY)
  - HogQL: SELECT day, cost FROM events WHERE vendor = ?
  - Strip all columns except [day, cost] (T-60-14-PII-1)
  - Return { results: [{ vendor, mtd_usd, sparkline_7d }] }

Browser
  ↓ fetchBudgetCaps()
  ↓ supabase.from('rag_budget_caps').select(...)
  ↓
PostgREST (RLS: is_staff()) → rag_budget_caps table

Auto-pause banner → acknowledgeBudgetCap(vendor)
  ↓ supabase.rpc('rag_acknowledge_budget_cap', { p_vendor })
  ↓
SECDEF RPC (re-checks is_staff()) → UPDATE rag_budget_caps + audit_logs
```

## Known Stubs

None — all 9 cards render from live PostHog data (or show `$0 / —` if no events yet for that vendor). Budget cap data reads from `rag_budget_caps` table with seeded rows.

## Deployment Notes

- Migration `20281201000011_rag_budget_caps.sql`: pushed by 60-15 BLOCKING
- Edge Fn `rag-cost-query`: deployed by 60-15 BLOCKING
- No new npm packages added

## Self-Check: PASSED

All files exist:
- [x] `supabase/migrations/20281201000011_rag_budget_caps.sql`
- [x] `supabase/functions/rag-cost-query/index.ts`
- [x] `supabase/functions/rag-cost-query/deno.json`
- [x] `supabase/functions/rag-cost-query/__tests__/posthog-query.test.ts`
- [x] `leanshot/src/lib/admin/rag/cost-api.ts`
- [x] `leanshot/src/lib/admin/rag/__tests__/cost-api.test.ts`
- [x] `leanshot/src/components/admin/rag/RagCostPage.tsx`
- [x] `leanshot/src/components/admin/rag/__tests__/RagCostPage.test.tsx`
- [x] `leanshot/src/components/admin/rag/RagLayout.tsx` (modified)

Commits verified:
- [x] b4da3044 feat(60-14): ship rag_budget_caps migration
- [x] 50171c0d feat(60-14): build rag-cost-query Edge Fn
- [x] 3c4d4723 feat(60-14): build cost-api browser client wrapper
- [x] b98c81db feat(60-14): build RagCostPage
- [x] eb700a53 feat(60-14): wire RagCostPage into RagLayout
- [x] 2f453277 fix(60-14): fix import order + remove unused const
