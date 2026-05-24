-- Phase 46 Plan 01 — Course SECDEF RPCs.
--
-- Implements:
--   D-09 / D-12: update_lesson_position — UPSERT with GREATEST(...) on
--                max_position_reached_seconds so scrub-back never regresses.
--   D-10 / D-12: complete_lesson — server-side ≥95% gate over duration_seconds
--                (bypassable by courses.enforce_completion=false).
--   D-11 / D-14: complete_course — (required_completed / required_total) ≥
--                completion_threshold_pct/100; emits placeholder certificate
--                row that generate-course-certificate Edge Fn finalizes via
--                HMAC token update.
--
-- Threat refs:
--   T-46-02 Tampering (fake-position): mitigated by GREATEST() preserving server
--   max + complete_lesson re-reading server value (not trusting client input).
--   T-46-07 Elevation: SECDEF revokes from public/anon; grants to authenticated only.
--
-- Per memory reference_supabase_migration_gotchas:
--   SECURITY DEFINER + SET search_path = public, extensions, pg_catalog on every function.
--   (extensions schema needed for pg_catalog operators + gen_random_uuid().)
--
-- Per memory reference_rpc_auth_uid_vs_service_role_mismatch:
--   All 3 RPCs reference auth.uid() and MUST be called with a user JWT, not
--   service-role. Lesson-progress-beacon Edge Fn explicitly mirrors the
--   user-JWT pattern (passes access_token in body for sendBeacon).

begin;

-- ============================================================================
-- update_lesson_position(p_lesson_id, p_last_position_seconds, p_max_position_reached_seconds)
-- D-09 / D-12: UPSERT with GREATEST(...) on max_position_reached_seconds.
-- ============================================================================
create or replace function public.update_lesson_position(
  p_lesson_id                     uuid,
  p_last_position_seconds         integer,
  p_max_position_reached_seconds  integer
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_user_id   uuid := auth.uid();
  v_course_id uuid;
begin
  if v_user_id is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- Resolve course_id via module → course join (single query).
  select m.course_id
    into v_course_id
    from public.course_lessons l
    join public.course_modules m on m.id = l.module_id
   where l.id = p_lesson_id;

  if v_course_id is null then
    raise exception 'lesson_not_found' using errcode = '02000';
  end if;

  -- D-12 + RESEARCH Pattern 7: GREATEST(...) preserves server-known max.
  -- A client posting a smaller value (scrub-back) does NOT regress the watch ceiling.
  insert into public.lesson_progress (
    user_id, lesson_id, course_id,
    last_position_seconds, max_position_reached_seconds, last_seen_at
  )
  values (
    v_user_id, p_lesson_id, v_course_id,
    p_last_position_seconds, p_max_position_reached_seconds, now()
  )
  on conflict (user_id, lesson_id) do update set
    last_position_seconds        = excluded.last_position_seconds,
    max_position_reached_seconds = GREATEST(public.lesson_progress.max_position_reached_seconds, excluded.max_position_reached_seconds),
    last_seen_at                 = now();
end;
$fn$;

comment on function public.update_lesson_position(uuid, integer, integer) is
  'P46 D-09/D-12: UPSERT lesson_progress; GREATEST() preserves max_position_reached_seconds vs scrub-back.';

revoke all     on function public.update_lesson_position(uuid, integer, integer) from public;
revoke execute on function public.update_lesson_position(uuid, integer, integer) from anon;
grant  execute on function public.update_lesson_position(uuid, integer, integer) to authenticated;

-- ============================================================================
-- complete_lesson(p_lesson_id) -> boolean
-- D-10 / D-12: server-side ≥95% gate over duration_seconds.
-- Returns true when (re-)completed; false when threshold not met.
-- ============================================================================
create or replace function public.complete_lesson(
  p_lesson_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_user_id              uuid    := auth.uid();
  v_duration             integer;
  v_enforce              boolean;
  v_max_position         integer;
  v_already_completed_at timestamptz;
  v_ratio                numeric;
begin
  if v_user_id is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- Load lesson duration + course enforcement flag (single 3-table join).
  select l.duration_seconds, c.enforce_completion
    into v_duration, v_enforce
    from public.course_lessons l
    join public.course_modules m on m.id = l.module_id
    join public.courses        c on c.id = m.course_id
   where l.id = p_lesson_id;

  if v_duration is null and v_enforce is null then
    raise exception 'lesson_not_found' using errcode = '02000';
  end if;

  -- Load server-trusted max position for this user/lesson + idempotency check.
  select max_position_reached_seconds, completed_at
    into v_max_position, v_already_completed_at
    from public.lesson_progress
   where user_id = v_user_id and lesson_id = p_lesson_id;

  -- No progress row → cannot complete (client must update_lesson_position first).
  if v_max_position is null then
    return false;
  end if;

  -- Idempotent: already complete → return true without flipping completed_at.
  if v_already_completed_at is not null then
    return true;
  end if;

  -- D-10 / D-12: ≥95% server-side gate over duration_seconds (bypassable per-course).
  if coalesce(v_enforce, true) = true then
    if v_duration is null or v_duration <= 0 then
      -- Unknown duration → cannot evaluate; refuse completion until duration is set.
      return false;
    end if;
    v_ratio := v_max_position::numeric / nullif(v_duration, 0);
    if v_ratio < 0.95 then
      return false;
    end if;
  end if;

  -- Mark complete.
  update public.lesson_progress
     set completed_at = now()
   where user_id = v_user_id and lesson_id = p_lesson_id;

  return true;
end;
$fn$;

comment on function public.complete_lesson(uuid) is
  'P46 D-10/D-12: server-side ≥95% gate (bypassable per-course); idempotent re-completion.';

revoke all     on function public.complete_lesson(uuid) from public;
revoke execute on function public.complete_lesson(uuid) from anon;
grant  execute on function public.complete_lesson(uuid) to authenticated;

-- ============================================================================
-- complete_course(p_course_id) -> table(certificate_id uuid, already_issued boolean)
-- D-11 / D-14: (required_completed / required_total) >= threshold_pct/100 gates.
-- Emits placeholder verification_token; Edge Fn computes HMAC and UPDATEs.
-- ============================================================================
create or replace function public.complete_course(
  p_course_id uuid
)
returns table(certificate_id uuid, already_issued boolean)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_user_id          uuid    := auth.uid();
  v_threshold_pct    integer;
  v_required_total   integer;
  v_required_done    integer;
  v_existing_cert    uuid;
  v_new_cert         uuid;
begin
  if v_user_id is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- Load course threshold; raise if course missing.
  select completion_threshold_pct
    into v_threshold_pct
    from public.courses
   where id = p_course_id;

  if v_threshold_pct is null then
    raise exception 'course_not_found' using errcode = '02000';
  end if;

  -- Count required lessons in course.
  select count(*)
    into v_required_total
    from public.course_lessons l
    join public.course_modules m on m.id = l.module_id
   where m.course_id = p_course_id
     and l.is_required = true;

  if v_required_total = 0 then
    raise exception 'course_has_no_required_lessons' using errcode = '02000';
  end if;

  -- Count required lessons this user has completed.
  select count(*)
    into v_required_done
    from public.course_lessons l
    join public.course_modules m on m.id = l.module_id
    join public.lesson_progress p
      on p.lesson_id   = l.id
     and p.user_id     = v_user_id
     and p.completed_at is not null
   where m.course_id = p_course_id
     and l.is_required = true;

  -- D-11: threshold gate.
  if (v_required_done::numeric / nullif(v_required_total, 0) * 100) < v_threshold_pct then
    raise exception 'course_not_complete' using errcode = 'P0001';
  end if;

  -- Idempotency: existing certificate (latest version) wins.
  select id
    into v_existing_cert
    from public.certificates
   where user_id = v_user_id and course_id = p_course_id
   order by version desc, issued_at desc
   limit 1;

  if v_existing_cert is not null then
    certificate_id := v_existing_cert;
    already_issued := true;
    return next;
    return;
  end if;

  -- D-14: insert placeholder verification_token; Edge Fn computes the HMAC
  -- over (cert_id, user_id, course_id, issued_at) and UPDATEs the row.
  insert into public.certificates (user_id, course_id, version, verification_token)
    values (v_user_id, p_course_id, 1, 'PENDING_' || gen_random_uuid()::text)
    returning id into v_new_cert;

  certificate_id := v_new_cert;
  already_issued := false;
  return next;
end;
$fn$;

comment on function public.complete_course(uuid) is
  'P46 D-11/D-14: threshold-gate + idempotent certificate emission; HMAC token finalized by Edge Fn.';

revoke all     on function public.complete_course(uuid) from public;
revoke execute on function public.complete_course(uuid) from anon;
grant  execute on function public.complete_course(uuid) to authenticated;

commit;
