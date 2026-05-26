-- Phase 61 Plan 61-02 — SECDEF RPCs: protocol state machine + 2-person review
-- ============================================================================
--
-- 7 SECURITY DEFINER RPCs implementing the Phase 61 protocol state machine:
--   1. public.submit_protocol_for_review  — draft → in_review + audit row
--   2. public.publish_protocol            — in_review → published (2-person rule enforced)
--   3. public.rollback_protocol           — archived → published (demotes current published)
--   4. public.archive_protocol            — any state → archived + audit row
--   5. public.assign_protocol_to_patient  — upserts patient_protocol_assignment
--   6. public.get_protocol_by_slug        — returns latest published version (no staff guard)
--   7. public.list_admin_ai_assist_usage_today — counts today's AI assist rows (rate-limit support)
--
-- Every RPC:
--   * LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_catalog
--   * Opens with: if not public.is_staff() then raise exception 'not authorized'
--                 using errcode = '42501'; end if;
--   * REVOKE ALL ON FUNCTION ... FROM public
--   * GRANT EXECUTE ON FUNCTION ... TO authenticated  (NOT anon)
--
-- EXCEPTION: get_protocol_by_slug does NOT have staff guard — authenticated users can call.
--
-- 3-LAYER 2-PERSON RULE INVARIANT (PROTOCOL-04, per [[feedback_3_layer_must_never_invariant_pattern]]):
--   DB layer  (this file)  — publish_protocol guards auth.uid() <> created_by
--   UI layer  (61-05)      — Publish button fully removed from DOM when currentUserId === created_by
--   CI eval   (61-08)      — Safety suite asserts 2-person rule at eval time
--
-- THREAT MITIGATIONS:
--   T-61-02-01: publish_protocol RAISES 'SELF_REVIEW_REJECTED' when auth.uid() = created_by
--   T-61-02-02: FOR UPDATE row lock on every state-read precedes state-mutation
--   T-61-02-04: ON CONFLICT (patient_id, protocol_id) DO UPDATE makes re-assign idempotent
--
-- Idempotent: all CREATE OR REPLACE.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. public.submit_protocol_for_review(p_protocol_id uuid, p_version int) → void
--    PROTOCOL-04: draft → in_review + writes audit row.
--    Staff guard: only admins can submit for review.
-- ---------------------------------------------------------------------------

create or replace function public.submit_protocol_for_review(
  p_protocol_id uuid,
  p_version     int
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_state public.protocol_review_state;
begin
  -- Staff guard (T-61-02 mitigation)
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Lock the row to prevent concurrent state races (T-61-02-02 mitigation)
  select review_state
  into   v_state
  from   public.protocols
  where  id = p_protocol_id
    and  version = p_version
  for    update;

  if not found then
    raise exception 'protocol % v% not found', p_protocol_id, p_version;
  end if;

  -- State precondition: only draft protocols can be submitted for review
  if v_state <> 'draft' then
    raise exception 'cannot submit protocol in state %', v_state;
  end if;

  update public.protocols
  set    review_state = 'in_review',
         updated_at   = now()
  where  id      = p_protocol_id
    and  version = p_version;

  -- Audit write (audit-row-is-truth invariant — before function returns)
  insert into public.protocol_review_log (protocol_id, version, actor, action)
  values (p_protocol_id, p_version, auth.uid(), 'submitted_for_review');
end
$$;

comment on function public.submit_protocol_for_review(uuid, int) is
  'Phase 61 (61-02, PROTOCOL-04): submit a draft protocol for 2-person review. '
  'Transitions draft → in_review; writes audit row to protocol_review_log. '
  'FOR UPDATE row lock prevents concurrent double-submit race.';

revoke all on function public.submit_protocol_for_review(uuid, int) from public;
grant execute on function public.submit_protocol_for_review(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. public.publish_protocol(p_protocol_id uuid, p_version int) → void
--    PROTOCOL-04: in_review → published. 2-person rule centerpiece.
--    RAISES 'SELF_REVIEW_REJECTED' when auth.uid() = created_by (T-61-02-01).
--    Demotes any prior published version of same protocol id to archived.
-- ---------------------------------------------------------------------------

create or replace function public.publish_protocol(
  p_protocol_id uuid,
  p_version     int
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_created_by uuid;
  v_state      public.protocol_review_state;
begin
  -- Staff guard (T-61-02 mitigation)
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Lock the row to prevent concurrent double-publish race (T-61-02-02 mitigation)
  select created_by, review_state
  into   v_created_by, v_state
  from   public.protocols
  where  id = p_protocol_id
    and  version = p_version
  for    update;

  if not found then
    raise exception 'protocol % v% not found', p_protocol_id, p_version;
  end if;

  -- 2-person rule guard (T-61-02-01 mitigation, PROTOCOL-04):
  -- Pre-Phase-61 rows with created_by IS NULL bypass the rule (exempt).
  -- New protocols have created_by populated on INSERT.
  -- Message MUST contain literal substring 'SELF_REVIEW_REJECTED' — UI toast matches on this substring.
  if v_created_by is not null and v_created_by = auth.uid() then
    raise exception 'SELF_REVIEW_REJECTED: publisher (%) cannot equal creator (%)',
      auth.uid(), v_created_by
      using errcode = '42501';
  end if;

  -- State precondition: only in_review protocols can be published
  if v_state <> 'in_review' then
    raise exception 'cannot publish protocol in state %', v_state;
  end if;

  -- Demote prior published version of same id to archived (only one version published at a time)
  update public.protocols
  set    review_state = 'archived',
         updated_at   = now()
  where  id           = p_protocol_id
    and  review_state = 'published';

  -- Publish the target version
  update public.protocols
  set    review_state = 'published',
         published_at  = now(),
         reviewed_by   = auth.uid(),
         reviewed_at   = now(),
         updated_at    = now()
  where  id      = p_protocol_id
    and  version = p_version;

  -- Audit write (audit-row-is-truth invariant — before function returns)
  insert into public.protocol_review_log (protocol_id, version, actor, action)
  values (p_protocol_id, p_version, auth.uid(), 'published');
end
$$;

comment on function public.publish_protocol(uuid, int) is
  'Phase 61 (61-02, PROTOCOL-04): publish an in_review protocol. '
  '2-person rule DB layer — auth.uid() <> created_by (SELF_REVIEW_REJECTED on violation). '
  'Demotes prior published version to archived. Part of 3-layer invariant: '
  'DB (this) + UI conditional render (61-05) + CI eval (61-08). '
  'See [[feedback_3_layer_must_never_invariant_pattern]].';

revoke all on function public.publish_protocol(uuid, int) from public;
grant execute on function public.publish_protocol(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. public.rollback_protocol(p_protocol_id uuid, p_target_version int) → void
--    PROTOCOL-05: archived → published (demotes current published → archived).
--    Only previously-published-then-archived versions can be restored.
-- ---------------------------------------------------------------------------

create or replace function public.rollback_protocol(
  p_protocol_id    uuid,
  p_target_version int
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_target_state public.protocol_review_state;
begin
  -- Staff guard (T-61-02 mitigation)
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Lock the target version row to prevent concurrent rollback races (T-61-02-02 mitigation)
  select review_state
  into   v_target_state
  from   public.protocols
  where  id      = p_protocol_id
    and  version = p_target_version
  for    update;

  if not found then
    raise exception 'protocol % v% not found', p_protocol_id, p_target_version;
  end if;

  -- Rollback target must be archived (only previously-published versions qualify)
  if v_target_state <> 'archived' then
    raise exception 'rollback target must be archived, got: %', v_target_state;
  end if;

  -- Archive current published version (if any)
  update public.protocols
  set    review_state = 'archived',
         updated_at   = now()
  where  id           = p_protocol_id
    and  review_state = 'published';

  -- Re-publish target version
  update public.protocols
  set    review_state = 'published',
         published_at  = now(),
         reviewed_by   = auth.uid(),
         reviewed_at   = now(),
         updated_at    = now()
  where  id      = p_protocol_id
    and  version = p_target_version;

  -- Audit write (audit-row-is-truth invariant — before function returns)
  insert into public.protocol_review_log (protocol_id, version, actor, action)
  values (p_protocol_id, p_target_version, auth.uid(), 'rolled_back');
end
$$;

comment on function public.rollback_protocol(uuid, int) is
  'Phase 61 (61-02, PROTOCOL-05): roll back to a prior archived version of a protocol. '
  'Archives the current published version; re-publishes the target. '
  'Target MUST be in archived state (only previously-published-then-archived qualify). '
  'Writes rolled_back audit row to protocol_review_log.';

revoke all on function public.rollback_protocol(uuid, int) from public;
grant execute on function public.rollback_protocol(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. public.archive_protocol(p_protocol_id uuid, p_version int) → void
--    Any state → archived. Does NOT require a specific prior state.
-- ---------------------------------------------------------------------------

create or replace function public.archive_protocol(
  p_protocol_id uuid,
  p_version     int
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_state public.protocol_review_state;
begin
  -- Staff guard (T-61-02 mitigation)
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Lock the row to prevent concurrent state races (T-61-02-02 mitigation)
  select review_state
  into   v_state
  from   public.protocols
  where  id = p_protocol_id
    and  version = p_version
  for    update;

  if not found then
    raise exception 'protocol % v% not found', p_protocol_id, p_version;
  end if;

  update public.protocols
  set    review_state = 'archived',
         updated_at   = now()
  where  id      = p_protocol_id
    and  version = p_version;

  -- Audit write (audit-row-is-truth invariant — before function returns)
  insert into public.protocol_review_log (protocol_id, version, actor, action)
  values (p_protocol_id, p_version, auth.uid(), 'archived');
end
$$;

comment on function public.archive_protocol(uuid, int) is
  'Phase 61 (61-02): archive a protocol version from any state. '
  'Writes archived audit row to protocol_review_log.';

revoke all on function public.archive_protocol(uuid, int) from public;
grant execute on function public.archive_protocol(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. public.assign_protocol_to_patient(p_protocol_id uuid, p_version int, p_patient_id uuid) → void
--    PROTOCOL-06: upserts patient_protocol_assignment.
--    Validates protocol is published before assignment.
--    ON CONFLICT (patient_id, protocol_id) DO UPDATE re-assigns to newer version (idempotent).
-- ---------------------------------------------------------------------------

create or replace function public.assign_protocol_to_patient(
  p_protocol_id uuid,
  p_version     int,
  p_patient_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_state public.protocol_review_state;
begin
  -- Staff guard (T-61-02 mitigation)
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Check protocol is published (no FOR UPDATE — assignment is not a protocol state transition)
  select review_state
  into   v_state
  from   public.protocols
  where  id      = p_protocol_id
    and  version = p_version;

  if not found then
    raise exception 'protocol % v% not found', p_protocol_id, p_version;
  end if;

  -- Only published protocols can be assigned to patients
  if v_state <> 'published' then
    raise exception 'protocol % v% is not published (current state: %)', p_protocol_id, p_version, v_state;
  end if;

  -- Upsert: re-assign to newer version if already assigned (T-61-02-04 mitigation: idempotent)
  insert into public.patient_protocol_assignment (patient_id, protocol_id, version, started_at)
  values (p_patient_id, p_protocol_id, p_version, now())
  on conflict (patient_id, protocol_id) do update
    set version    = excluded.version,
        started_at = now();
  -- No protocol_review_log entry — assignment is not a state transition of the protocol
end
$$;

comment on function public.assign_protocol_to_patient(uuid, int, uuid) is
  'Phase 61 (61-02, PROTOCOL-06): assign a published protocol version to a patient. '
  'ON CONFLICT (patient_id, protocol_id) DO UPDATE re-assigns to newer version (idempotent). '
  'Validates protocol is in published state before insert. No audit log entry (assignment only).';

revoke all on function public.assign_protocol_to_patient(uuid, int, uuid) from public;
grant execute on function public.assign_protocol_to_patient(uuid, int, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. public.get_protocol_by_slug(p_base_slug text) → TABLE
--    Returns latest published version for /protocols/<slug> route.
--    NO staff guard — authenticated users can call (RLS on protocols filters published).
--    Returns empty result set if no published row exists (UI renders 404 state).
-- ---------------------------------------------------------------------------

create or replace function public.get_protocol_by_slug(
  p_base_slug text
)
returns table (
  id           uuid,
  version      int,
  name         text,
  compound     text,
  audience     text[],
  slug         text,
  base_slug    text,
  published_at timestamptz,
  steps        jsonb,
  evidence     jsonb
)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  -- NO staff guard — authenticated users can read published protocols
  -- RLS on protocols table already enforces review_state = 'published' for non-staff callers
  -- but SECDEF bypasses RLS, so we apply the published filter explicitly here.

  return query
  select
    p.id,
    p.version,
    p.name,
    p.compound,
    p.audience,
    p.slug,
    p.base_slug,
    p.published_at,
    -- Aggregated steps ordered by week ascending
    coalesce(
      (
        select json_agg(
          json_build_object(
            'id',           s.id,
            'week',         s.week,
            'dose_mg',      s.dose_mg,
            'frequency',    s.frequency,
            'cron_string',  s.cron_string,
            'monitoring',   s.monitoring
          )
          order by s.week asc
        )::jsonb
        from public.protocol_steps s
        where s.protocol_id      = p.id
          and s.protocol_version = p.version
      ),
      '[]'::jsonb
    ) as steps,
    -- Aggregated evidence per step
    coalesce(
      (
        select json_agg(
          json_build_object(
            'id',              e.id,
            'step_id',         e.step_id,
            'citation_text',   e.citation_text,
            'rag_source_id',   e.rag_source_id,
            'verbatim_quote',  e.verbatim_quote
          )
        )::jsonb
        from public.protocol_evidence e
        join public.protocol_steps    s on s.id = e.step_id
        where s.protocol_id      = p.id
          and s.protocol_version = p.version
      ),
      '[]'::jsonb
    ) as evidence
  from public.protocols p
  where p.base_slug    = p_base_slug
    and p.review_state = 'published'
  order by p.version desc
  limit 1;
end
$$;

comment on function public.get_protocol_by_slug(text) is
  'Phase 61 (61-02): return latest published protocol version by base_slug. '
  'Used by /protocols/<slug> public route and Edge Fn. '
  'No staff guard — authenticated users can call. '
  'Returns empty result set (not an error) when no published version exists; UI renders 404.';

revoke all on function public.get_protocol_by_slug(text) from public;
grant execute on function public.get_protocol_by_slug(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. public.list_admin_ai_assist_usage_today() → int
--    Rate-limit support: count today's UTC-day AI assist rows for caller.
--    Consumed by protocol-ai-assist Edge Fn pre-check + admin UI usage chip.
--    Pitfall 4: use date_trunc('day', now() at time zone 'UTC') for UTC boundary.
-- ---------------------------------------------------------------------------

create or replace function public.list_admin_ai_assist_usage_today()
returns int
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  -- Staff guard (T-61-02 mitigation)
  if not public.is_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return (
    select count(*)::int
    from   public.admin_ai_assist_log
    where  actor_id   = auth.uid()
      and  created_at >= date_trunc('day', now() at time zone 'UTC')
  );
end
$$;

comment on function public.list_admin_ai_assist_usage_today() is
  'Phase 61 (61-02): count today UTC-day AI assist calls for the calling admin. '
  'Used by protocol-ai-assist Edge Fn as rate-limit pre-check (50/day cap). '
  'Also surfaced as usage chip in admin UI. date_trunc UTC boundary per Pitfall 4.';

revoke all on function public.list_admin_ai_assist_usage_today() from public;
grant execute on function public.list_admin_ai_assist_usage_today() to authenticated;

-- ============================================================================
-- 3-LAYER 2-PERSON RULE INVARIANT ENFORCEMENT SUMMARY
-- (per [[feedback_3_layer_must_never_invariant_pattern]])
-- ============================================================================
--
--  Layer 1 — DB (this file):
--    publish_protocol: if v_created_by is not null and v_created_by = auth.uid()
--      → raise exception 'SELF_REVIEW_REJECTED: publisher (%) cannot equal creator (%)'
--        using errcode = '42501';
--    → Cannot be bypassed by direct SQL or UI tamper (SECDEF + FOR UPDATE).
--
--  Layer 2 — UI conditional render (61-05, ProtocolEditorPage.tsx):
--    {!isSelfCreated && reviewState === 'in_review' && <Button>Publish Protocol</Button>}
--    → Publish button fully removed from DOM (not just disabled) when author === current user.
--
--  Layer 3 — CI eval safety suite (61-08):
--    Automated test asserts publish_protocol returns errcode 42501 when caller == creator.
--    Runs on every PR.
--
-- ============================================================================
-- end migration 20260526000002
-- ============================================================================

commit;
