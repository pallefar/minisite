---
phase: 48-m4-moderation
plan: 05
subsystem: moderation/banned-words
tags: [banned-words, secdef-rpc, notification-widening, rls, audit-log]
requires:
  - public.is_staff()                                              # 20261101000006
  - public.log_moderation_action(text,text,uuid,jsonb,jsonb,text)  # 20270901000009 (P48-04)
  - public.moderation_audit_log (target_type='banned_word')        # 20270901000008 (P48-04)
  - public.notification_settings + 3 siblings (P42/P44)
provides:
  - public.banned_words table
  - public.banned_word_upsert(text,text) -> uuid SECDEF
  - public.banned_word_remove(uuid) -> void SECDEF
  - notification CHECK widening: + 'banned_word_escalate'
  - notification_category_config seed: banned_word_escalate (urgent, email+in_app)
affects:
  - Plan 48-08 banned-words trigger (reads public.banned_words)
  - Plan 48-08 email-router (writes user_notifications with category='banned_word_escalate')
tech_stack:
  added: []
  patterns:
    - SECDEF RPC + public.is_staff() entry gate
    - Functional UNIQUE on lower(word) via separate index (per reference_supabase_migration_gotchas)
    - Atomic 4-table CHECK widening in one begin/commit (per feedback_planner_missed_status_enum_widening)
    - Standalone DELETE in remove RPC (per reference_postgres_no_insert_on_conflict_do_delete)
key_files:
  created:
    - supabase/migrations/20270901000010_p48_banned_words.sql
    - supabase/migrations/20270901000011_p48_banned_word_rpcs.sql
    - supabase/migrations/20270901000012_p48_notification_settings_widen_banned_word_escalate.sql
  modified: []
decisions:
  - "Phase 47 event categories NOT included in this widening because Phase 47 migration is not yet present on disk (live-verified 2026-05-23 via grep). Widened the Phase 44 7-category set to 8 by adding banned_word_escalate. If Phase 47 widening lands separately, both extensions are CHECK-only and additive."
  - "banned_words.created_by FK auth.users(id) — preserves attribution for audit log; required for the after-state snapshot to be meaningful."
  - "GRANT EXECUTE to authenticated only on both RPCs (NOT service_role) per feedback_rpc_auth_uid_vs_service_role_mismatch — banned_word_* RPCs rely on auth.uid() for both the is_staff() gate and the created_by attribution."
metrics:
  duration_min: ~12
  tasks: 3
  files: 3
  commits: 3
  completed: 2026-05-24
---

# Phase 48 Plan 05: banned_words + SECDEF RPCs + notification CHECK widening — Summary

3 migrations shipping the banned-words source of truth, staff-gated admin RPCs, and the 4-table notification CHECK widening that lets `severity='escalate'` matches fire emails to opted-in staff.

## What Was Built

### Task 1 — `banned_words` table (commit `85b4af0d`)
File: `supabase/migrations/20270901000010_p48_banned_words.sql`

- Table columns: `id uuid PK`, `word text`, `severity text CHECK ('warn'|'flag'|'escalate')`, `case_insensitive boolean default true`, `created_by uuid FK auth.users`, `created_at`, `updated_at`.
- Functional UNIQUE: `create unique index banned_words_word_uniq on public.banned_words (lower(word))` — separate functional index because inline `unique (lower(word))` is not permitted as a table constraint in Postgres (per memory `reference_supabase_migration_gotchas`).
- RLS: `enable row level security` + `banned_words_staff_select` policy gated on `public.is_staff()`. NO INSERT/UPDATE/DELETE policy for `authenticated`; all writes flow through the SECDEF RPCs in Task 2. Trigger + sweep Fn read via the service-role bypass.

### Task 2 — `banned_word_upsert` + `banned_word_remove` (commit `36bce64d`)
File: `supabase/migrations/20270901000011_p48_banned_word_rpcs.sql`

- `banned_word_upsert(p_word text, p_severity text) RETURNS uuid` — `lower(p_word)` + `ON CONFLICT (lower(word)) DO UPDATE SET severity = excluded.severity, updated_at = now()`. Returns row id. Calls `log_moderation_action` with after-state JSON.
- `banned_word_remove(p_id uuid) RETURNS void` — **standalone DELETE** (per memory `reference_postgres_no_insert_on_conflict_do_delete`: `ON CONFLICT DO DELETE` does not exist in Postgres; toggle/delete via SECDEF RPC). Captures before-state via `to_jsonb(bw.*)` for the audit log.
- Both gate at entry on `public.is_staff()` (raises `42501 forbidden` otherwise). Upsert also short-circuits on invalid severity (`22023 invalid_severity`) before the audit log call.
- GRANT EXECUTE to `authenticated` only — NOT `service_role` (per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`).

### Task 3 — Atomic 4-table notification CHECK widening (commit `806d4332`)
File: `supabase/migrations/20270901000012_p48_notification_settings_widen_banned_word_escalate.sql`

- Single `begin; … commit;` wrapping `DROP CONSTRAINT IF EXISTS … ADD CONSTRAINT …` on all 4 sibling tables: `notification_settings`, `notification_category_config`, `user_notifications`, `notification_dismissal_state`.
- Widens from Phase 44's 7 categories (`dose-reminders, ai-insights, clinic-alerts, billing, marketing, community-mentions, community-replies`) to 8 by adding `banned_word_escalate`.
- Seeds `notification_category_config` row: `urgent_escalation=true`, `email_enabled_default=true`, `in_app_enabled_default=true`, `push_enabled_default=false`, no caps. UPSERT shape per memory `reference_state_counter_table_needs_upsert_on_event` for re-apply safety.

## Acceptance Criteria — All Pass

| Check | Expected | Actual |
|-------|----------|--------|
| F1 `create table if not exists public.banned_words` | ≥1 | 1 |
| F1 `severity in ('warn','flag','escalate')` | ≥1 | 1 |
| F1 `banned_words_word_uniq` references | ≥1 | 1 |
| F1 `banned_words_staff_select` references | ≥1 | 2 |
| F2 `create or replace function public.banned_word_upsert` | ≥1 | 1 |
| F2 `create or replace function public.banned_word_remove` | ≥1 | 1 |
| F2 `on conflict do delete` (negation) | 0 | 0 |
| F2 `public.is_staff()` calls | ≥2 | 2 |
| F2 standalone DELETE in remove | ≥1 | 1 |
| F3 `'banned_word_escalate'` occurrences | ≥4 | 5 (4 CHECKs + seed) |
| F3 `drop constraint if exists` | ≥4 | 4 |
| F3 `begin;` / `commit;` | 1 / 1 | 1 / 1 |
| F3 `push_enabled_default` (canonical-column proof) | ≥1 | 2 |
| F3 rejected `default_in_app\|default_email\|display_label` | 0 | 0 |
| Filename regex `^[0-9]{14}_*.sql$` | 3/3 | 3/3 |

## Decisions Made

1. **Phase 47 event categories deliberately NOT included.** Live-verified 2026-05-23 that no Phase 47 widening migration exists on disk. Widened the Phase 44 7-category set to 8 (added `banned_word_escalate`). If Phase 47 ships its `event_reminders_1d|1h|event_promotion` widening on a separate timestamp, both extensions are CHECK-only and additive — no merge collision risk.
2. **`created_by` is `NOT NULL FK auth.users(id)`.** Preserves attribution for the audit log and makes the after-state snapshot meaningful. RPC inserts use `auth.uid()` (gated by `is_staff()`).
3. **GRANT EXECUTE to `authenticated` only on both RPCs.** Per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`: these RPCs rely on `auth.uid()` for both the gate and `created_by`. Service-role callers would have a NULL actor and bypass `is_staff()` entirely — a footgun. Trigger + sweep Fn read via service-role bypass directly against `banned_words`, not through these RPCs.
4. **Severity check enforced twice** — once at the table CHECK (table constraint, always enforced) and once in the upsert RPC (short-circuit before audit log call). The double-check is intentional: the RPC version emits a typed `22023 invalid_severity` error and skips audit-logging the rejection.

## Deviations from Plan

None — plan executed exactly as written. The plan's stated Phase 47-precondition (widening sequence) was checked at execute time per the plan's own instructions; live state matched the plan-time grep result, so the canonical 7-category list shipped as-is.

## Carry-Overs / Follow-ups

- **Migrations NOT pushed.** Per orchestrator directive: operator pushes at 48-12 close-out.
- Plan 48-08 (banned-words trigger + sweep Fn + email-router) consumes:
  - `public.banned_words` table (service-role SELECT via bypass)
  - `notification_settings` / `user_notifications` accepting `category='banned_word_escalate'`
  - `notification_category_config` row for runtime defaults
- Admin UI for managing banned words (calls `banned_word_upsert` / `banned_word_remove`) lives in a later plan (not specified here).

## Self-Check: PASSED

Files created (verified `git log` + `ls`):
- `supabase/migrations/20270901000010_p48_banned_words.sql` — FOUND
- `supabase/migrations/20270901000011_p48_banned_word_rpcs.sql` — FOUND
- `supabase/migrations/20270901000012_p48_notification_settings_widen_banned_word_escalate.sql` — FOUND

Commits (verified `git log --oneline -5`):
- `85b4af0d` feat(48-05): banned_words table + RLS + functional UNIQUE — FOUND
- `36bce64d` feat(48-05): SECDEF banned_word_upsert + banned_word_remove RPCs — FOUND
- `806d4332` feat(48-05): widen notification CHECK constraints + seed banned_word_escalate — FOUND
