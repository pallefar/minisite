---
phase: 49-m4-search-email-digests
plan: 02
subsystem: search/rpc
tags: [search, rpc, fts, security-invoker, postgres, plan-summary]
dependency_graph:
  requires:
    - 49-01 (community_posts.search_en/es, course_lessons.search_en/es, events.search_en/es tsvector columns + GIN indexes)
  provides:
    - public.search_content(text, text) — cross-table SECURITY INVOKER search RPC returning top-15 (5×3 types) ranked results with `<b>`-highlighted snippets
  affects:
    - 49-05 (search-content-rpc.test.ts will fixture EN+ES + cross-tenant impersonation against this RPC)
    - 49-09 (SearchModal will call `supabase.rpc('search_content', { p_query, p_lang })`)
tech_stack:
  added: []
  patterns:
    - CTE-per-type + UNION ALL ranked top-N (D-21: LIMIT 5 per CTE BEFORE ts_headline → bounds ts_headline calls to ≤ 15)
    - SECURITY INVOKER RPC + grant-to-authenticated only (no service_role grant; RLS enforced as caller)
    - per-language branch via `case when p_lang = 'spanish' then 'spanish'::regconfig else 'english'::regconfig end`
    - websearch_to_tsquery as sole tsquery sink (T-49-04 mitigation)
key_files:
  created:
    - supabase/migrations/20271001000004_p49_search_content_rpc.sql
  modified: []
decisions:
  - "Inlined websearch_to_tsquery in every per-type CTE WHERE/SELECT instead of computing once in a `q` CTE (PLAN's <action> verbatim form had only 1 call, but PLAN's own acceptance_criteria requires ≥ 3 literal occurrences). Semantics unchanged; planner caches construction."
  - "Kept the `q` CTE for `cfg` (regconfig) only; ts_headline references `(select cfg from q)`."
  - "Header comments name D-04 / D-08 / D-21 + STRIDE flags T-49-03/04/05 (rationale stays in plan + commit; per `feedback_negation_grep_defeated_by_comment_string`, did NOT include literal `security definer` or `service_role` strings anywhere in the SQL file)."
metrics:
  duration: ~10m
  tasks_completed: 1
  files_created: 1
  files_modified: 0
  completed_date: 2026-05-24
---

# Phase 49 Plan 02: search_content SECURITY INVOKER RPC Summary

## One-liner

Shipped `public.search_content(p_query text, p_lang text default 'english')` SECURITY INVOKER SQL RPC that UNION ALLs top-5 ranked rows per type (community_posts, course_lessons, events) with `<b>`-wrapped ts_headline snippets — single round-trip from SearchModal returning ≤ 15 rows inheriting per-table RLS as the caller.

## What Shipped

**New migration:** `supabase/migrations/20271001000004_p49_search_content_rpc.sql` (132 lines, single `begin; … commit;` block).

**Function shape:**
- Signature: `public.search_content(p_query text, p_lang text default 'english') returns table (type text, id uuid, title text, snippet text, rank real, space_id uuid, course_id uuid, module_id uuid, start_at timestamptz)` — 9 columns per D-08.
- Body: `language sql` + `security invoker` + `set search_path = public`.
- 3 per-type CTEs (`posts`, `lessons`, `upcoming_events`) each:
  - filter via `<col> @@ websearch_to_tsquery(<regconfig>, coalesce(p_query, ''))`
  - rank via `ts_rank_cd(<col>, websearch_to_tsquery(...))`
  - `order by rank desc limit 5`
- Final SELECT: UNION ALL of three branches each calling `ts_headline(cfg, body_col, websearch_to_tsquery(...), 'StartSel=<b>, StopSel=</b>, MaxWords=20, MinWords=5, ShortWord=3, HighlightAll=false')`. `cfg` is pulled from a 1-row `q` CTE.
- `posts` branch additionally filters `deleted_at is null`.
- Final `order by type, rank desc`.

**Grants:**
- `revoke execute … from public`
- `grant execute … to authenticated`
- NO grant to `service_role` (per `feedback_rpc_auth_uid_vs_service_role_mismatch` + D-04 INVOKER contract — service-role caller would bypass per-table RLS and defeat the entire trust model).

## Acceptance Criteria Results

All 11 plan greps pass:

| Check | Target | Actual |
|-------|--------|--------|
| `ls 20271001000004…sql` exists | yes | yes |
| `security invoker` count | ≥ 1 | 1 |
| `security definer` count | == 0 | 0 |
| `service_role` count | == 0 | 0 |
| `language sql` count | ≥ 1 | 1 |
| `websearch_to_tsquery` count | ≥ 3 | 12 |
| `ts_headline` count | ≥ 3 | 3 |
| `limit 5` count | ≥ 3 | 3 |
| `grant  execute on function public.search_content` count | ≥ 1 | 1 |
| `revoke execute on function public.search_content` count | ≥ 1 | 1 |
| `plainto_tsquery` count | == 0 | 0 |
| Files matching `20271001000004*.sql` | == 1 | 1 |

Filename matches strict `^[0-9]{14}_[A-Za-z0-9_]+\.sql$` (no letter-suffix; won't be `Skipped` by Supabase CLI per `reference_supabase_migration_filename_regex`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Internal inconsistency in PLAN <action> vs <acceptance_criteria>]**
- **Found during:** Task 1 verify step (grep gates after first write).
- **Issue:** PLAN.md `<action>` block embeds a verbatim function body (lines 84–170) that calls `websearch_to_tsquery` only ONCE (inside a `q` CTE producing `q.tsq`, then referenced as `q.tsq` everywhere else). PLAN.md `<acceptance_criteria>` AND `must_haves.truths` AND `<verify><automated>` all require `websearch_to_tsquery` ≥ 3 literal occurrences.
- **Diagnosis:** Planner-arithmetic slip — the ≥ 3 contract was clearly intended (matches the 3-CTE / 3-ts_headline pattern), but the example body was structured for performance (compute tsq once) rather than to satisfy the literal-string contract. Two acceptance criteria failed on first write (websearch count = 1, expected ≥ 3).
- **Fix:** Restructured the function so each per-type CTE inlines `websearch_to_tsquery(<regconfig>, coalesce(p_query, ''))` in BOTH its WHERE predicate (for the `@@` match) and its `ts_rank_cd` argument. Kept the `q` CTE for `cfg` only (used by ts_headline). Final count: 12 occurrences (well above the ≥ 3 floor; reflects 4 sites × 3 types).
- **Semantic impact:** None. Postgres planner hoists/caches the parameterized tsquery construction; both forms are functionally identical. The inlined form is also slightly more readable per branch (no need to reason about `q` CTE join behavior with FROM-clause comma joins). All threat mitigations T-49-03/04/05 preserved.
- **Files modified:** `supabase/migrations/20271001000004_p49_search_content_rpc.sql` (rewritten before commit; single landed commit).
- **Commit:** `d68a0f10` (this commit message documents the deviation inline).

### Out-of-Scope Discoveries

None.

### Deferred Items

None.

## Threat Surface Touched

| Threat ID | Mitigation Implemented |
|-----------|------------------------|
| T-49-03 (I — info disclosure) | `security invoker` + `set search_path = public` ensures per-table RLS on `community_posts` / `course_lessons` / `events` fires as the caller. No `bypassrls` role grant. |
| T-49-04 (T — SQL injection via p_query) | Only sink is `websearch_to_tsquery(regconfig, coalesce(p_query, ''))` — fully parameterized; pathological input yields empty result, not crash. `coalesce(p_query, '')` defends against NULL. |
| T-49-05 (D — ts_headline DoS) | Each per-type CTE applies `order by rank desc limit 5` BEFORE the outer SELECT materializes `ts_headline`. Worst-case ts_headline invocations bounded to 15. |

No new threat surface beyond the threat_model declared in PLAN.md.

## Cross-Phase Coordination

- **Wave 0 dep (49-01):** Already shipped FTS columns + GIN indexes (`20271001000001`, `20271001000002`, `20271001000003`). This RPC references `community_posts.search_en/es`, `course_lessons.search_en/es`, `events.search_en/es` — all present.
- **Wave 0 sibling (49-04 widening + 49-04 digest_send_log at `20271001000005-6`):** Independent schema; no overlap.
- **Wave 1 sibling (49-03 helper RPCs at `20271001000007`):** Independent functions.
- **Wave 3 close-out:** Will run `supabase db push --linked` to apply this migration; this plan deliberately does NOT push (per executor instructions + phase pattern).
- **Wave 2/3 consumers:** Plan 49-05 (test scaffold) and Plan 49-09 (SearchModal) will call this RPC. Contract surface (signature + 9-col return shape + ranking semantics) is final.

## Validation Notes

This is a SQL-only migration; runtime validation is gated by `supabase db push --linked` which is owned by the phase close-out, NOT by this plan. The acceptance_criteria grep gates fully exercise the static contract surface (signature, language, grants, CTE LIMIT pattern, sink choice).

Per memory `feedback_negation_grep_defeated_by_comment_string`: no rejected-alternative strings (`security definer`, `service_role`, `plainto_tsquery`, `to_tsquery` without `websearch_` prefix) appear anywhere in the committed file — including comments. The rationale-trail lives in this SUMMARY + PLAN.md + the commit message body only.

## Self-Check: PASSED

- `supabase/migrations/20271001000004_p49_search_content_rpc.sql` — FOUND (4276 bytes).
- commit `d68a0f10` — FOUND on `worktree-agent-a9d0288a50880f126`.
- All 11 acceptance_criteria greps — PASSED (see table above).
- No state/roadmap/db-push side effects per executor instructions.
