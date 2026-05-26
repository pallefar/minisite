-- Phase 60 Plan 60-11 — kb_tip_of_day table + SECDEF write wrapper
-- ============================================================================
--
-- RAG-07: stores per-user daily tip of the day (one row per user per UTC date).
--
-- Single tip per day rule:
--   UNIQUE(user_id, date_utc) enforced at DB level — concurrent Fn invocations
--   for the same user/date silently no-op via ON CONFLICT DO NOTHING in the
--   SECDEF wrapper (idempotent).
--
-- Write path: service-role ONLY via public.write_kb_tip_of_day() SECDEF RPC.
--   No authenticated INSERT/UPDATE/DELETE policies — RLS denies all.
--   Only SELECT for own rows is exposed via RLS.
--
-- Deferred: cron schedule registration in 60-15 (per [[feedback_fn_deploy_before_cron_db_push]]).
-- Deferred: db push in 60-15 BLOCKING task.
--
-- References:
--   - 20260519000003_rag_chunks_table.sql  (kb_chunks FK target; public.rag_chunks)
--   - 20281201000003_phase60_push_categories.sql (research_tips notification_category_config seed)
--   - 60-11-PLAN.md Task 1

-- ---------------------------------------------------------------------------
-- Extension guard
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.kb_tip_of_day (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  date_utc          date not null,
  chunk_id          uuid not null references public.rag_chunks(id) on delete cascade,
  generated_at      timestamptz not null default now(),
  push_dispatched_at timestamptz null,
  -- Denormalized from the chunk at write time for card rendering without a JOIN
  source_tier       text not null,
  topic_tag         text not null,
  topic_slug        text not null,
  headline          text not null,
  body              text not null,
  source_name       text not null,
  evidence_date     date not null,
  canonical_url     text not null
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.kb_tip_of_day enable row level security;

-- Users may only read their own tips
create policy kb_tip_of_day_select_own
  on public.kb_tip_of_day
  for select
  using (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies for anon or authenticated role —
-- all writes go through the SECDEF function below (service-role)

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Primary lookup: user's tip for today (card fetch query)
create unique index kb_tip_of_day_user_date_uniq
  on public.kb_tip_of_day(user_id, date_utc);

-- Secondary lookup: cascade retraction from 60-08 (chunk revoked → retract tips)
create index if not exists kb_tip_of_day_chunk_id_idx
  on public.kb_tip_of_day(chunk_id);

-- ---------------------------------------------------------------------------
-- SECDEF write wrapper
-- ---------------------------------------------------------------------------
-- Edge Fn uses service_role key; wrapping in SECDEF is belt-and-suspenders
-- shape enforcement + enables fine-grained GRANT without exposing raw table.

create or replace function public.write_kb_tip_of_day(
  p_user_id      uuid,
  p_date_utc     date,
  p_chunk_id     uuid,
  p_source_tier  text,
  p_topic_tag    text,
  p_topic_slug   text,
  p_headline     text,
  p_body         text,
  p_source_name  text,
  p_evidence_date date,
  p_canonical_url text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.kb_tip_of_day (
    user_id, date_utc, chunk_id,
    source_tier, topic_tag, topic_slug,
    headline, body, source_name,
    evidence_date, canonical_url
  ) values (
    p_user_id, p_date_utc, p_chunk_id,
    p_source_tier, p_topic_tag, p_topic_slug,
    p_headline, p_body, p_source_name,
    p_evidence_date, p_canonical_url
  )
  on conflict (user_id, date_utc) do nothing
  returning id into v_id;

  return v_id; -- null on conflict (already written for today)
end;
$$;

-- Grant to service_role only — no anon/authenticated grants
grant execute on function public.write_kb_tip_of_day(
  uuid, date, uuid, text, text, text, text, text, text, date, text
) to service_role;

-- ---------------------------------------------------------------------------
-- Push category seed (belt-and-suspenders — 60-01 migration 20281201000003
-- is the primary owner; this INSERT is idempotent ON CONFLICT DO NOTHING so
-- re-deploying this migration without 60-01 still produces a valid row)
-- ---------------------------------------------------------------------------

insert into public.notification_category_config (
  category, daily_cap, weekly_cap, urgent_escalation,
  push_enabled_default, email_enabled_default, in_app_enabled_default
) values (
  'research_tips', 1, 7, false, true, true, true
)
on conflict (category) do nothing;

-- end migration 20281201000004
