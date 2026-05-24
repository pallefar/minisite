-- Phase 48 Plan 48-05 Task 1 — banned_words table + RLS + functional UNIQUE.
--
-- Purpose: source of truth for the banned-words trigger (Plan 48-08) and the
-- sweep Edge Function. Severity ladder mirrors moderation:
--   warn      -> soft warn, no removal
--   flag      -> queue for human review
--   escalate  -> fire urgent email to opted-in staff (notification category
--                `banned_word_escalate`, widened in 20270901000012)
--
-- Writes ONLY via SECDEF RPCs banned_word_upsert + banned_word_remove
-- (Plan 48-05 Task 2, migration 20270901000011). The trigger + sweep Fn read
-- via the service-role bypass; staff admin UI reads via the SELECT policy.
--
-- Memory references:
--   reference_supabase_is_staff_helper       — staff RLS via public.is_staff()
--   reference_supabase_migration_gotchas     — UNIQUE on lower(word) MUST be a
--                                              separate functional index;
--                                              inline `unique (lower(word))` is
--                                              NOT permitted as a table constraint
--   reference_postgres_no_insert_on_conflict_do_delete
--                                            — banned_word_remove is a standalone
--                                              DELETE in the sibling migration

begin;

create table if not exists public.banned_words (
  id               uuid        primary key default gen_random_uuid(),
  word             text        not null,
  severity         text        not null check (severity in ('warn','flag','escalate')),
  case_insensitive boolean     not null default true,
  created_by       uuid        not null references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Functional UNIQUE on lower(word). Inline `unique (lower(word))` as a table
-- constraint is not permitted in Postgres; a separate index is required (per
-- memory reference_supabase_migration_gotchas).
create unique index if not exists banned_words_word_uniq
  on public.banned_words (lower(word));

alter table public.banned_words enable row level security;

-- Staff SELECT only. NO INSERT/UPDATE/DELETE policy for authenticated; all
-- writes flow through SECDEF RPCs (Task 2). Trigger + sweep Fn read via
-- service-role bypass.
drop policy if exists banned_words_staff_select on public.banned_words;
create policy banned_words_staff_select
  on public.banned_words for select to authenticated
  using (public.is_staff());

commit;
