---
phase: 49-m4-search-email-digests
plan: 01
subsystem: database
tags: [postgres, fts, tsvector, gin, supabase, migration]

# Dependency graph
requires:
  - phase: 46-m4-courses-classroom
    provides: public.course_lessons table (title + content_md columns)
  - phase: 47-m4-events
    provides: public.events table (title + description columns)
  - phase: 44-m4-community
    provides: public.community_posts table (body column, no title per D-17)
provides:
  - "community_posts.search_en / search_es GENERATED tsvector columns (body weight A) + 2 GIN indexes"
  - "course_lessons.search_en / search_es GENERATED tsvector columns (title=A, content_md=B) + 2 GIN indexes"
  - "events.search_en / search_es GENERATED tsvector columns (title=A, description=B) + 2 GIN indexes"
affects: [49-02-search-content-rpc, 49-03-search-ui, 49-10-close-out]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-table dual-locale GENERATED tsvector columns (search_en + search_es) + matching `*_search_{en,es}_gin` GIN indexes"
    - "setweight discipline: title=A, body/content_md/description=B; community_posts is body-only at weight A (no title column)"
    - "IF NOT EXISTS idempotency on both ALTER TABLE … ADD COLUMN and CREATE INDEX"

key-files:
  created:
    - "supabase/migrations/20271001000001_p49_community_posts_fts.sql"
    - "supabase/migrations/20271001000002_p49_course_lessons_fts.sql"
    - "supabase/migrations/20271001000003_p49_events_fts.sql"
  modified: []

key-decisions:
  - "Forked Phase 37 helpdesk_fts_index.sql pattern (GENERATED ALWAYS AS STORED + GIN per locale) for all 3 content tables"
  - "community_posts indexes body alone at weight A — per D-17, community_posts has NO title column live; the SQL file contains zero `title` references (in code or comments) to prevent negation-grep false positives"
  - "Migration timestamps 20271001000001..03 chosen well beyond last existing 20270901* to avoid Wave-N collision with sibling 49-* plans"

patterns-established:
  - "Per-table FTS migration shape: `begin; alter table … add column if not exists search_{en,es} tsvector generated always as (setweight(to_tsvector('english'|'spanish', coalesce(col, '')), 'A'[ || setweight(..., 'B')]) stored; create index if not exists <table>_search_{en,es}_gin on public.<table> using gin (search_{en,es}); commit;`"
  - "Comment hygiene: rejected-alternative column names (e.g. mentioning that community_posts has no `title`) are NEVER written into committed SQL — they live only in PLAN.md and SUMMARY.md, so negation-grep guards (`grep -ic 'title' file = 0`) don't false-trip"

requirements-completed: [DIGEST-01]

# Metrics
duration: ~7min
completed: 2026-05-24
---

# Phase 49 Plan 01: Per-table FTS Foundation Summary

**Adds EN + ES GENERATED tsvector columns and GIN indexes to community_posts (body=A), course_lessons (title=A, content_md=B), and events (title=A, description=B) — foundation for Plan 49-02 search_content RPC.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-24T13:11:00Z
- **Completed:** 2026-05-24T13:18:00Z
- **Tasks:** 3
- **Files modified:** 3 (all created)

## Accomplishments
- 3 idempotent migration files (20271001000001..03) shipping per-table FTS columns and GIN indexes
- D-17 honored: community_posts FTS file contains zero `title` references in SQL or comments (validates negation-grep gate from `feedback_negation_grep_defeated_by_comment_string`)
- All 3 migrations follow Phase 37 helpdesk_fts_index.sql precedent: GENERATED ALWAYS AS STORED + IF NOT EXISTS + per-locale GIN
- Filename regex (`^[0-9]{14}_[a-z0-9_]+\.sql$`) validated; no letter suffixes

## Task Commits

Each task was committed atomically:

1. **Task 1: community_posts FTS migration (body-only, weight A per D-17)** — `8bb72a2a` (feat)
2. **Task 2: course_lessons FTS migration (title=A, content_md=B)** — `ed59e47a` (feat)
3. **Task 3: events FTS migration (title=A, description=B)** — `844d8b5c` (feat)

**Plan metadata commit:** will be appended as `docs(49-01): SUMMARY` once this file lands.

## Files Created/Modified
- `supabase/migrations/20271001000001_p49_community_posts_fts.sql` — community_posts search_en/search_es GENERATED columns (body weight A) + community_posts_search_{en,es}_gin
- `supabase/migrations/20271001000002_p49_course_lessons_fts.sql` — course_lessons search_en/search_es GENERATED columns (title=A, content_md=B) + course_lessons_search_{en,es}_gin
- `supabase/migrations/20271001000003_p49_events_fts.sql` — events search_en/search_es GENERATED columns (title=A, description=B) + events_search_{en,es}_gin

## Decisions Made
- **D-17 propagation:** community_posts SQL skeleton uses whole-body weight A (no concatenation with a title column that doesn't exist). The committed file's comment block discusses "weight discipline" generically without naming the rejected alternative.
- **Comment for idempotency rewritten** to avoid the literal phrase `add column if not exists` in a comment, so the acceptance grep `grep -c 'add column if not exists' <file>` returns exactly 2 (not 3).
- **Migration filenames** use plain `p49_<table>_fts.sql` slug (consistent with `p47_*`, `p48_*` siblings).

## Deviations from Plan

None — plan executed exactly as written.

(One in-task micro-edit on Task 1: the literal phrase `add column if not exists` appeared in a comment line, causing `grep -c 'add column if not exists'` to return 3 instead of the acceptance-criteria-mandated exactly-2. Reworded the comment to "guarded with IF NOT EXISTS on both ALTER and CREATE INDEX". This is a wording change inside an already-uncommitted file in the same task — not a deviation from the plan body.)

## Issues Encountered
None.

## User Setup Required
None — no external service configuration required. `supabase db push --linked` happens at Wave 3 close-out (Plan 49-10), per phase orchestration.

## Next Phase Readiness
- Plan 49-02 (`search_content` SECURITY INVOKER RPC) can now reference `search_en` and `search_es` on all 3 content tables.
- Migrations have NOT been applied to live DB by this plan (per task instructions: "Do NOT run `supabase db push`"). Application is gated on Plan 49-10 close-out.
- Sibling Wave-0 plans (if any same-wave plans touch these migrations dir) won't collide — timestamps `20271001000001..03` are exclusive to 49-01.

## Self-Check: PASSED

**Files exist:**
- FOUND: supabase/migrations/20271001000001_p49_community_posts_fts.sql
- FOUND: supabase/migrations/20271001000002_p49_course_lessons_fts.sql
- FOUND: supabase/migrations/20271001000003_p49_events_fts.sql

**Commits exist on branch:**
- FOUND: 8bb72a2a (community_posts FTS)
- FOUND: ed59e47a (course_lessons FTS)
- FOUND: 844d8b5c (events FTS)

**Acceptance grep gates:**
- F1 title count = 0 ✓
- F1 english body weight A ≥ 1 ✓
- F1 spanish body weight A ≥ 1 ✓
- F1 using gin = 2 ✓
- F1 add column if not exists = 2 ✓
- F2 content_md ≥ 2 ✓
- F2 using gin = 2 ✓
- F2 add column if not exists = 2 ✓
- F3 description ≥ 2 ✓
- F3 using gin = 2 ✓
- F3 add column if not exists = 2 ✓
- Filename regex matches all 3 ✓

---
*Phase: 49-m4-search-email-digests*
*Completed: 2026-05-24*
