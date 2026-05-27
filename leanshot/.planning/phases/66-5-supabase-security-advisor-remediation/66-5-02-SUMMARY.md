---
phase: 66-5-supabase-security-advisor-remediation
plan: 2
subsystem: supabase-security
tags: [security, search-path, function-hardening, advisor, migration]
requires:
  - Supabase project linked with applied migrations from earlier phases
provides:
  - "16 functions pinned to search_path=public,pg_temp (SEC-03 remediation)"
affects:
  - supabase/migrations/
tech-stack:
  added: []
  patterns:
    - "DO $$ EXCEPTION WHEN undefined_function — drift-safe ALTER FUNCTION (mirrors 66-5-01)"
key-files:
  created:
    - supabase/migrations/20290106000003_function_search_path_fix.sql
  modified: []
decisions:
  - "Single migration vs 16 files: one file keeps the advisor sweep atomic and minimizes filename-timestamp ordering risk"
  - "DO-block per ALTER (not 16 in one DO-block): each can independently skip on drift without short-circuiting the rest"
  - "search_path = public, pg_temp: matches Supabase advisor recommendation; pg_temp last keeps temp-table override available but unable to shadow public on lookup"
metrics:
  completed: 2026-05-27
  duration: ~6 minutes
  tasks: 1
  files: 1
---

# Phase 66.5 Plan 2: Function search_path Fix Summary

ALTER FUNCTION ... SET search_path = public, pg_temp applied to 16 functions flagged by Supabase advisor `function_search_path_mutable` (lint 0011). Single migration file, 16 drift-safe DO-blocks.

## What Shipped

**`supabase/migrations/20290106000003_function_search_path_fix.sql`** — 16 `ALTER FUNCTION ... SET search_path = public, pg_temp` statements, each wrapped in a `DO $$ ... EXCEPTION WHEN undefined_function $$` block.

### Function inventory

15 trigger functions (no-arg signature `()`):

| # | Function | Signature |
|---|----------|-----------|
| 2 | `landing_pages_set_updated_at` | `()` |
| 3 | `locale_overrides_set_updated_at` | `()` |
| 4 | `_user_changelog_dismissed_touch_updated_at` | `()` |
| 5 | `set_feature_flags_updated_at` | `()` |
| 6 | `set_affiliates_updated_at` | `()` |
| 7 | `cohort_definitions_updated_at` | `()` |
| 8 | `block_landing_page_revisions_delete` | `()` |
| 9 | `save_offer_rules_updated_at` | `()` |
| 10 | `vendor_baa_chain_set_updated_at` | `()` |
| 11 | `tg_set_updated_at` | `()` |
| 12 | `set_payouts_updated_at` | `()` |
| 13 | `_changelog_entries_touch_updated_at` | `()` |
| 14 | `site_settings_set_updated_at` | `()` |
| 15 | `tg_rag_topics_updated_at` | `()` |
| 16 | `block_landing_page_revisions_update` | `()` |

1 regular function with full signature:

| # | Function | Signature | Source migration |
|---|----------|-----------|------------------|
| 1 | `increment_rate_limit` | `(uuid, text, timestamptz)` | `20260512000001_rate_limit_counters.sql` |

PostgreSQL identifies functions by name + argument-type list. The wrong signature on `increment_rate_limit` would have silently no-op'd. Grepped each migration source to confirm signatures before writing.

## Verification

```bash
grep -cE "alter function public\." supabase/migrations/20290106000003_function_search_path_fix.sql
# 16   ✓
```

Post-apply verification (deferred to milestone close-out, requires `supabase db push` on linked project):

```bash
supabase db advisors --linked --type security --level warn \
  | jq '[.[] | select(.name=="function_search_path_mutable")] | length'
# expected: 16 → 0
```

## Deviations from Plan

None — plan executed exactly as written.

## Decisions Made

1. **Migration timestamp `20290106000003`** — chosen because newest existing on disk is `20290105000002_mfa_role_requirements.sql`, and Wave 1 sibling plan 66-5-01 owns `20290106000002` (per phase plan layout). `…000003` keeps strict forward order without colliding with the sibling.
2. **One DO-block per ALTER, not 16 in a single DO-block** — keeps each ALTER independently drift-safe; if one function is missing on remote, only that ALTER skips with NOTICE, the rest still apply.
3. **`search_path = public, pg_temp`** — exactly what Supabase advisor recommends. `pg_temp` listed *after* `public` so temp-table objects cannot shadow built-ins on resolution.

## Self-Check: PASSED

- `supabase/migrations/20290106000003_function_search_path_fix.sql` exists (160 lines, 16 `alter function public.` matches)
- Commit hash recorded below
