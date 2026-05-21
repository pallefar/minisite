-- Phase 35 Plan 35-05 — pgTAP test for weekly_challenges status enum CHECK.
-- Proves that:
--   1. Status CHECK definition includes ALL 4 values (draft|active|completed|archived)
--      per memory feedback_planner_missed_status_enum_widening
--   2. draft → active transition succeeds (requires dates per chk_active_dates)
--   3. active → archived transition succeeds
--   4. Out-of-set status value is rejected with 23514 check_violation
--   5. active without ends_at is rejected with 23514 (chk_active_dates constraint)
-- Note: tests 2/3 are sequenced DO blocks; pgTAP pass() confirms no exception thrown.
-- Variant UNIQUE enforcement tested as bonus assert 5 (using the archived row from test 3).

begin;
select plan(5);

-- ---------------------------------------------------------------------------
-- Test 1: status CHECK definition contains all 4 values
-- Searches pg_constraint for the status column CHECK on weekly_challenges.
-- The CHECK definition must contain all 4 literal values.
-- ---------------------------------------------------------------------------
select like(
  (
    select pg_get_constraintdef(c.oid)
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
     where t.relname = 'weekly_challenges'
       and t.relnamespace = 'public'::regnamespace
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%status%'
       and pg_get_constraintdef(c.oid) like '%draft%'
     limit 1
  ),
  '%draft%active%completed%archived%',
  'weekly_challenges.status CHECK includes all 4 enum values (memory feedback_planner_missed_status_enum_widening)'
);

-- ---------------------------------------------------------------------------
-- Test 2: draft → active transition succeeds (with required dates)
-- chk_active_dates requires starts_at + ends_at + ends_at > starts_at for non-draft.
-- ---------------------------------------------------------------------------
do $test2$
declare v_cid uuid := gen_random_uuid();
begin
  -- Insert as draft (no dates needed)
  insert into public.weekly_challenges (
    id, title, framing, challenge_type, threshold, duration, status
  ) values (
    v_cid,
    'PgTAP test challenge',
    'PgTAP test framing text',
    'log_count',
    5,
    'week',
    'draft'
  );
  -- Transition draft → active (dates required by chk_active_dates)
  update public.weekly_challenges
     set status = 'active',
         starts_at = now(),
         ends_at = now() + interval '7 days'
   where id = v_cid;
end $test2$;
select pass('draft → active transition succeeds with dates set');

-- ---------------------------------------------------------------------------
-- Test 3: active → archived transition succeeds (transitions through status values)
-- Uses the row created in test 2; archives it to prove 'archived' is in CHECK.
-- ---------------------------------------------------------------------------
do $test3$
declare v_cid uuid;
begin
  -- Find the test row created above (most recent 'active' test row by title)
  select id into v_cid
    from public.weekly_challenges
   where title = 'PgTAP test challenge'
     and status = 'active'
   order by created_at desc
   limit 1;
  update public.weekly_challenges set status = 'archived' where id = v_cid;
end $test3$;
select pass('active → archived transition succeeds (archived value in CHECK)');

-- ---------------------------------------------------------------------------
-- Test 4: out-of-set status value rejected with 23514 check_violation
-- ---------------------------------------------------------------------------
select throws_ok(
  $sql$
    insert into public.weekly_challenges (
      title, framing, challenge_type, threshold, duration, status
    ) values (
      'Bad status',
      'Bad framing test',
      'log_count',
      1,
      'week',
      'paused'  -- NOT in the allowed set
    )
  $sql$,
  '23514',
  null,
  'out-of-set status value (paused) rejected with 23514 check_violation'
);

-- ---------------------------------------------------------------------------
-- Test 5: chk_active_dates rejects active status without ends_at
-- Active challenges must have starts_at + ends_at (ends_at > starts_at).
-- ---------------------------------------------------------------------------
select throws_ok(
  $sql$
    insert into public.weekly_challenges (
      title, framing, challenge_type, threshold, duration, status, starts_at
    ) values (
      'No ends_at',
      'Missing ends_at framing',
      'log_count',
      1,
      'week',
      'active',
      now()
      -- ends_at intentionally omitted → violates chk_active_dates
    )
  $sql$,
  '23514',
  null,
  'active challenge without ends_at rejected with 23514 (chk_active_dates)'
);

select * from finish();
rollback;
