---
phase: 48-m4-moderation
plan: 01
subsystem: database
tags: [postgres, supabase, migration, community_reports, partial-unique, rls, moderation]

requires:
  - phase: 45-m4-community-spaces-member-directory-opt-in-dms-leaderboard
    provides: public.community_reports base table (status='open', reporter_user_id, target_type, target_id, reason jsonb)
provides:
  - community_reports.status CHECK widened from ('open') to ('open','triaged','resolved','dismissed')
  - community_reports.triaged_by (uuid, nullable, FK auth.users)
  - community_reports.triaged_at (timestamptz, nullable)
  - community_reports.dismissed_reason (text, nullable)
  - community_reports_active_dedup_uniq partial UNIQUE (reporter_user_id, target_type, target_id) WHERE status IN ('open','triaged') — D-02 cooldown
  - community_reports_banned_word_dedup_uniq partial UNIQUE (target_type, target_id) WHERE reason->>'source'='banned_word' — D-11 idempotency
affects: [48-02 report_content RPC (catches 23505 on cooldown), 48-08 banned-word trigger (on conflict do nothing), 48-Wave1 banned-word sweep Fn, 48-06 RLS proof tests]

tech-stack:
  added: []
  patterns:
    - "Partial UNIQUE index as idempotency primitive (UNIQUE + catch 23505 in RPC, not SELECT-then-INSERT)"
    - "Status CHECK widening via DROP+ADD in same begin/commit txn (per feedback_planner_missed_status_enum_widening)"
    - "Triage audit columns (actor_uuid + timestamp + reason text) added nullable for backward compatibility with Phase 45 'open'-only rows"

key-files:
  created:
    - supabase/migrations/20270901000001_p48_community_reports_extend.sql
  modified: []

key-decisions:
  - "Cooldown enforced via partial UNIQUE + 23505 catch in Plan 48-02 RPC (not ON CONFLICT DO DELETE — syntax does not exist per reference_postgres_no_insert_on_conflict_do_delete)"
  - "Banned-word idempotency via partial UNIQUE on (target_type, target_id) WHERE reason->>'source'='banned_word' — supports re-invocation of Wave 1 sweep Fn without duplicate rows"
  - "All triage audit columns added nullable (no DEFAULT, no NOT NULL) — pre-existing 'open' rows remain valid post-widening"

patterns-established:
  - "M4 moderation idempotency: partial UNIQUE WHERE <literal IMMUTABLE predicate> + ON CONFLICT DO NOTHING (for triggers) or 23505-catch (for RPCs). Both predicates are IMMUTABLE (literal status set + literal jsonb arrow text)."
  - "Status enum widening in M4: DROP+ADD CHECK constraint in single begin/commit transaction"

requirements-completed: [MOD-01]

# Metrics
duration: 6min
completed: 2026-05-24
---

# Phase 48 Plan 01: community_reports triage widening + dedup UNIQUEs Summary

**Widens Phase 45 `community_reports` to support D-01 4-state triage workflow + D-02 atomic cooldown via partial UNIQUE + D-11 banned-word idempotent sweep via partial UNIQUE — all in a single begin/commit transaction.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-24T01:27:00Z
- **Completed:** 2026-05-24T01:33:26Z
- **Tasks:** 1
- **Files modified:** 1 (created)

## Accomplishments
- `community_reports_status_chk` CHECK constraint DROP+ADD-ed in same txn to allow 4 states (`open`, `triaged`, `resolved`, `dismissed`).
- 3 triage audit columns added nullable: `triaged_by uuid → auth.users(id)`, `triaged_at timestamptz`, `dismissed_reason text`.
- `community_reports_active_dedup_uniq` partial UNIQUE created — enforces the D-02 per-reporter cooldown atomically (Plan 48-02's `report_content` RPC catches 23505).
- `community_reports_banned_word_dedup_uniq` partial UNIQUE created — supports `on conflict do nothing` for the Plan 48-08 trigger and the Wave 1 sweep Fn, so banned-word detection is idempotent.

## Task Commits

1. **Task 1: community_reports triage widening + cooldown UNIQUE + banned-word UNIQUE** — `f4f57ec3` (feat)

_Plan was a single non-TDD task; no test/refactor commits expected._

## Files Created/Modified
- `supabase/migrations/20270901000001_p48_community_reports_extend.sql` (created) — 55 lines, 1 begin/commit txn. Widens status CHECK, adds 3 nullable triage audit columns, creates 2 partial UNIQUE indexes.

## Decisions Made
- **Idempotency primitive:** partial UNIQUE + `on conflict do nothing` (triggers) / 23505-catch (RPCs). Rejected `ON CONFLICT DO DELETE` (does not exist in Postgres per `reference_postgres_no_insert_on_conflict_do_delete`).
- **Header style:** forked from `supabase/migrations/20270720000004_p44_notification_community.sql` (single begin/commit + threat-model comment block).
- **Filename:** `20270901000001_p48_community_reports_extend.sql` — strict 14-digit prefix per `reference_supabase_migration_filename_regex`; verified no collision via `ls supabase/migrations/20270901000001*.sql | wc -l == 1`.

## Deviations from Plan

None - plan executed exactly as written.

All 13 acceptance-criteria greps passed on first commit:

| Gate | Result |
|------|--------|
| File exists | 1 |
| Filename collision check | exactly 1 file matching `20270901000001*.sql` |
| Status CHECK widen string | 1 |
| `add column if not exists triaged_by` | 1 |
| `add column if not exists triaged_at` | 1 |
| `add column if not exists dismissed_reason` | 1 |
| `community_reports_active_dedup_uniq` | 1 |
| `community_reports_banned_word_dedup_uniq` | 1 |
| `reason->>'source' = 'banned_word'` predicate | 1 |
| `begin;` count | 1 |
| `commit;` count | 1 |
| Rejected `on conflict do delete` in committed file (case-insensitive) | 0 |
| Filename regex compliance | 1 |

## Issues Encountered
None.

## User Setup Required

None - migration applies at Phase 48 close-out (Plan 48-12) via operator-run `supabase db push --linked`.

## Next Phase Readiness
- **Plan 48-02** (`report_content` RPC) can now rely on the cooldown partial UNIQUE: insert + catch 23505 → return `{ ok: false, reason: 'cooldown' }`.
- **Plan 48-06** (RLS proof tests) can reference both partial UNIQUEs in its assertions; tests GREEN after the Plan 48-12 db push.
- **Plan 48-08** (banned-word trigger) + Wave 1 sweep Fn can `insert ... on conflict do nothing` against `community_reports_banned_word_dedup_uniq`.
- Migration is idempotent (`if not exists` on columns + indexes; `if exists` on constraint drop) — safe to re-apply.

## Self-Check: PASSED

- `supabase/migrations/20270901000001_p48_community_reports_extend.sql` — FOUND.
- Commit `f4f57ec3` — FOUND in worktree-agent-adc6f2aed1c9f4fe5 branch (verified via `git rev-parse --short HEAD`).
- All 13 acceptance-criteria greps re-run post-write: PASS.
- No timestamp collision (`ls supabase/migrations/20270901000001*.sql | wc -l` == 1).

---
*Phase: 48-m4-moderation*
*Completed: 2026-05-24*
