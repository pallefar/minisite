-- Phase 60 Plan 60-01 — data-layer foundation (file 2-of-3): 5 SECDEF state-machine RPCs
-- ============================================================================
--
-- 5 SECURITY DEFINER RPCs owning rag_chunks state transitions for Phase 60 admin queue:
--   1. public.approve_rag_chunk     — queued/re-queued → approved (2-person rule enforced)
--   2. public.reject_rag_chunk      — queued/re-queued → rejected + audit row
--   3. public.retract_rag_chunk     — approved → retracted (2-person rule enforced)
--   4. public.queue_rag_chunk       — rejected/retracted/approved → re-queued
--   5. public.list_rag_review_queue — list queued+re-queued chunks for admin UI
--
-- Every RPC:
--   * LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_catalog
--   * Opens with: if not public.is_staff() then raise exception 'not authorized'
--                 using errcode = '42501'; end if;
--   * REVOKE ALL ON FUNCTION ... FROM public
--   * GRANT EXECUTE ON FUNCTION ... TO authenticated  (NOT anon)
--
-- 3-LAYER 2-PERSON RULE INVARIANT (per [[feedback_3_layer_must_never_invariant_pattern]]):
--   DB layer  (this file)  — approve_rag_chunk + retract_rag_chunk guard auth.uid() <> created_by / reviewed_by
--   UI layer  (60-08)      — Approve button disabled + badge when currentUserId === created_by
--   CI eval   (60-03)      — Safety suite asserts 2-person rule at eval time
--
-- Per [[reference_profiles_email_vs_auth_users_email]]:
--   list_rag_review_queue JOINs auth.users (NOT public.profiles — profiles has NO email column).
--
-- Idempotent: all CREATE OR REPLACE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. public.approve_rag_chunk(p_chunk_id uuid) → void
--    RAG-03: queued/re-queued → approved.
--    2-person rule: auth.uid() MUST differ from chunk's created_by.
--    T-60-01-02 mitigation: DB-layer guard fires BEFORE the UPDATE.
-- ---------------------------------------------------------------------------

create or replace function public.approve_rag_chunk(
  p_chunk_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_created_by uuid;
  v_status     public.rag_chunk_status;
begin
  -- Staff guard (T-60-01-01 mitigation)
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Lock the row to prevent concurrent double-approve race condition
  select created_by, status
  into   v_created_by, v_status
  from   public.rag_chunks
  where  id = p_chunk_id
  for    update;

  if not found then
    raise exception 'chunk % not found', p_chunk_id;
  end if;

  -- 2-person rule guard (T-60-01-02 mitigation):
  -- Pre-Phase-60 rows have created_by IS NULL — those bypass the rule (exempt).
  -- New chunks created in Phase 60+ have created_by populated by scraper/adapter.
  if v_created_by is not null and v_created_by = auth.uid() then
    raise exception '2-person rule: publisher (%) cannot equal creator (%)',
      auth.uid(), v_created_by
      using errcode = '42501';
  end if;

  -- State precondition: only queued or re-queued chunks can be approved
  if v_status not in ('queued', 're-queued') then
    raise exception 'cannot approve chunk in status %', v_status;
  end if;

  update public.rag_chunks
  set    status      = 'approved',
         published_at = now(),
         reviewed_by  = auth.uid(),
         reviewed_at  = now()
  where  id = p_chunk_id;
end
$$;

comment on function public.approve_rag_chunk(uuid) is
  'Phase 60 (60-01/60-08, RAG-03): approve a queued/re-queued rag_chunk. '
  '2-person rule DB layer — auth.uid() <> created_by. '
  'Part of 3-layer invariant: DB (this) + UI badge (60-08) + CI eval (60-03). '
  'See [[feedback_3_layer_must_never_invariant_pattern]].';

revoke all on function public.approve_rag_chunk(uuid) from public;
grant execute on function public.approve_rag_chunk(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. public.reject_rag_chunk(p_chunk_id uuid, p_reason rag_reject_reason, p_notes text) → void
--    RAG-03: queued/re-queued → rejected + inserts audit row into kb_chunk_rejections.
--    Note: 2-person rule does NOT apply to reject (per CONTEXT.md — rejecting your
--    own submission is allowed; only PUBLISHING requires a second reviewer).
-- ---------------------------------------------------------------------------

create or replace function public.reject_rag_chunk(
  p_chunk_id uuid,
  p_reason   public.rag_reject_reason,
  p_notes    text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_status public.rag_chunk_status;
begin
  -- Staff guard (T-60-01-01 mitigation)
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Lock the row
  select status
  into   v_status
  from   public.rag_chunks
  where  id = p_chunk_id
  for    update;

  if not found then
    raise exception 'chunk % not found', p_chunk_id;
  end if;

  -- State precondition
  if v_status not in ('queued', 're-queued') then
    raise exception 'cannot reject chunk in status %', v_status;
  end if;

  update public.rag_chunks
  set    status       = 'rejected',
         reject_reason = p_reason,
         reviewed_by   = auth.uid(),
         reviewed_at   = now()
  where  id = p_chunk_id;

  -- AUDIT WRITE (D-rejection-audit per CONTEXT.md):
  -- Wrapped defensively so a transient audit failure does NOT block the rejection.
  begin
    insert into public.kb_chunk_rejections (chunk_id, reason, notes, actor_id)
    values (p_chunk_id, p_reason, p_notes, auth.uid());
  exception
    when others then
      raise warning 'audit insert into kb_chunk_rejections failed for chunk %: %',
        p_chunk_id, sqlerrm;
  end;
end
$$;

comment on function public.reject_rag_chunk(uuid, public.rag_reject_reason, text) is
  'Phase 60 (60-01/60-08, RAG-03): reject a queued/re-queued rag_chunk. '
  'Inserts audit row into kb_chunk_rejections (D-rejection-audit). '
  'No 2-person rule on reject — only publish/retract require second reviewer. '
  'Audit insert is defensive (warn-only on failure, rejection still lands).';

revoke all on function public.reject_rag_chunk(uuid, public.rag_reject_reason, text) from public;
grant execute on function public.reject_rag_chunk(uuid, public.rag_reject_reason, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. public.retract_rag_chunk(p_chunk_id uuid, p_reason text) → void
--    RAG-03: approved → retracted.
--    2-person rule: the staffer who originally published the chunk (reviewed_by)
--    cannot be the one retracting it — same safety principle as approve.
-- ---------------------------------------------------------------------------

create or replace function public.retract_rag_chunk(
  p_chunk_id uuid,
  p_reason   text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_status      public.rag_chunk_status;
  v_reviewed_by uuid;
begin
  -- Staff guard (T-60-01-01 mitigation)
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Lock the row
  select status, reviewed_by
  into   v_status, v_reviewed_by
  from   public.rag_chunks
  where  id = p_chunk_id
  for    update;

  if not found then
    raise exception 'chunk % not found', p_chunk_id;
  end if;

  -- State precondition: can only retract an approved (published) chunk
  if v_status <> 'approved' then
    raise exception 'cannot retract chunk in status %', v_status;
  end if;

  -- 2-person rule on retract:
  -- The staffer who published the chunk cannot be the one retracting it.
  -- reviewed_by was set by approve_rag_chunk to the approver's uid.
  -- Pre-Phase-60 rows where reviewed_by IS NULL bypass this guard (exempt).
  if v_reviewed_by is not null and v_reviewed_by = auth.uid() then
    raise exception '2-person rule: retracting staffer (%) cannot be the original publisher (%)',
      auth.uid(), v_reviewed_by
      using errcode = '42501';
  end if;

  update public.rag_chunks
  set    status           = 'retracted',
         retracted_at     = now(),
         retracted_reason = p_reason,
         reviewed_by      = auth.uid()
  where  id = p_chunk_id;
end
$$;

comment on function public.retract_rag_chunk(uuid, text) is
  'Phase 60 (60-01/60-08, RAG-03): retract a published rag_chunk. '
  '2-person rule DB layer: retracting staffer cannot be the original publisher. '
  'Part of 3-layer invariant: DB (this) + UI badge (60-08) + CI eval (60-03). '
  'See [[feedback_3_layer_must_never_invariant_pattern]].';

revoke all on function public.retract_rag_chunk(uuid, text) from public;
grant execute on function public.retract_rag_chunk(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. public.queue_rag_chunk(p_chunk_id uuid) → void
--    RAG-03: rejected/retracted/approved → re-queued.
--    Clears review state so 2-person rule applies fresh on next approve call.
--    Used by scraper/federated adapter after editing a previously processed chunk.
-- ---------------------------------------------------------------------------

create or replace function public.queue_rag_chunk(
  p_chunk_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_status public.rag_chunk_status;
begin
  -- Staff guard (T-60-01-01 mitigation)
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select status
  into   v_status
  from   public.rag_chunks
  where  id = p_chunk_id
  for    update;

  if not found then
    raise exception 'chunk % not found', p_chunk_id;
  end if;

  -- State precondition: only non-initial states can be re-queued
  if v_status not in ('rejected', 'retracted', 'approved') then
    raise exception 'cannot re-queue chunk in status %', v_status;
  end if;

  -- Clear review state so 2-person rule applies fresh on next approve call.
  -- Intentionally keeps reject_reason for analytics (rejection history preserved).
  update public.rag_chunks
  set    status           = 're-queued',
         published_at     = null,
         retracted_at     = null,
         retracted_reason = null,
         reviewed_by      = null,
         reviewed_at      = null
  where  id = p_chunk_id;
end
$$;

comment on function public.queue_rag_chunk(uuid) is
  'Phase 60 (60-01/60-07/60-08, RAG-03): re-queue a rejected/retracted/approved chunk. '
  'Clears review state (published_at, retracted_at, reviewed_by, reviewed_at). '
  'Retains reject_reason for analytics. 2-person rule resets on next approve call.';

revoke all on function public.queue_rag_chunk(uuid) from public;
grant execute on function public.queue_rag_chunk(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. public.list_rag_review_queue(p_limit, p_offset, p_tier, p_topic_tag) → TABLE
--    RAG-03: return queued+re-queued chunks for the 60-08 admin review UI.
--    JOINs auth.users (NOT public.profiles) to surface creator email.
--    Per [[reference_profiles_email_vs_auth_users_email]]: profiles has NO email column.
--    T-60-01-04 mitigation: RPC exposes only the chunk's own reviewed_by email
--    via SECDEF privilege; caller cannot SELECT auth.users directly.
-- ---------------------------------------------------------------------------

create or replace function public.list_rag_review_queue(
  p_limit     int     default 50,
  p_offset    int     default 0,
  p_tier      text    default null,
  p_topic_tag text    default null
)
returns table (
  chunk_id          uuid,
  topic_tag         text,
  source_tier       public.rag_source_tier,
  summary           text,
  source_url        text,
  created_by        uuid,
  created_by_email  text,
  scraped_at        timestamptz,
  queue_age_hours   numeric
)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  -- Staff guard (T-60-01-01 mitigation)
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select
    c.id                                                           as chunk_id,
    c.topic_tag,
    c.source_tier,
    c.summary,
    c.canonical_url                                                as source_url,
    c.created_by,
    u.email                                                        as created_by_email,
    c.scraped_at,
    round(
      extract(epoch from (now() - c.scraped_at)) / 3600, 2
    )::numeric                                                     as queue_age_hours
  from   public.rag_chunks c
  -- JOIN auth.users (NOT public.profiles — the profiles table has no email column; see [[reference_profiles_email_vs_auth_users_email]])
  left   join auth.users u on u.id = c.created_by
  where  c.status in ('queued', 're-queued')
    -- Optional tier filter (parameterized — no string interpolation)
    and (p_tier is null or c.source_tier::text = p_tier)
    -- Optional topic_tag filter
    and (p_topic_tag is null or c.topic_tag = p_topic_tag)
  order  by c.scraped_at asc   -- FIFO queue
  limit  p_limit
  offset p_offset;
end
$$;

comment on function public.list_rag_review_queue(int, int, text, text) is
  'Phase 60 (60-01/60-08, RAG-03): list queued/re-queued chunks for admin review UI. '
  'JOINs auth.users for created_by_email (NOT from profiles — profiles has no email column). '
  'T-60-01-04: SECDEF exposes only the row''s own creator email; caller cannot SELECT auth.users. '
  '60-08 UI uses created_by UUID to compare against currentUserId for the 2-person-rule badge.';

revoke all on function public.list_rag_review_queue(int, int, text, text) from public;
grant execute on function public.list_rag_review_queue(int, int, text, text) to authenticated;

-- ============================================================================
-- Shorthand GRANT / REVOKE (no arg-type suffix) for grep-compatibility
-- These duplicate the per-function grant/revoke above and are valid Postgres
-- when function names are unique within the schema (which these are).
-- Plan 60-01 static-grep invariant 8+9 greps for this shorter pattern form.
-- ============================================================================

revoke all on function public.approve_rag_chunk from public;
grant execute on function public.approve_rag_chunk to authenticated;

revoke all on function public.reject_rag_chunk from public;
grant execute on function public.reject_rag_chunk to authenticated;

revoke all on function public.retract_rag_chunk from public;
grant execute on function public.retract_rag_chunk to authenticated;

revoke all on function public.queue_rag_chunk from public;
grant execute on function public.queue_rag_chunk to authenticated;

revoke all on function public.list_rag_review_queue from public;
grant execute on function public.list_rag_review_queue to authenticated;

-- ============================================================================
-- 3-LAYER 2-PERSON RULE INVARIANT ENFORCEMENT SUMMARY
-- (per [[feedback_3_layer_must_never_invariant_pattern]])
-- ============================================================================
--
--  Layer 1 — DB (this file):
--    approve_rag_chunk:  if v_created_by is not null and v_created_by = auth.uid() → raise '2-person rule'
--    retract_rag_chunk:  if v_reviewed_by is not null and v_reviewed_by = auth.uid() → raise '2-person rule'
--    → Cannot be bypassed by direct SQL or UI tamper.
--
--  Layer 2 — UI badge (60-08):
--    Approve button disabled + warning badge when currentUserId === created_by UUID.
--    → Prevents accidental trigger; UX signal + DB double-catch.
--
--  Layer 3 — CI eval safety suite (60-03):
--    Automated test asserts that approve_rag_chunk returns errcode 42501 when
--    caller == creator. Runs on every PR.
--    → Catches regressions before they reach production.
--
-- ============================================================================
-- end migration 20281201000002
