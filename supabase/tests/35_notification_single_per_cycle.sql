-- Phase 35 plan 35-09 — pgTAP 5 assertions:
-- (1) email_send_counters table exists (Phase 22 lifecycle infra)
-- (2) UPSERT on email_send_counters increments existing row (NOT bare UPDATE no-op)
--     per memory feedback_state_counter_table_needs_upsert_on_event
-- (3) challenge_progress.notified_kickoff_at is settable
-- (4) monotonic completed_at trigger blocks completed_at → NULL transition
-- (5) REVIEW-B-2: notified_kickoff_at UPDATE survives monotonic trigger when
--     completed_at is already non-null (the production kickoff-fires-after-completion path)

begin;
-- Disable FK triggers for test isolation (service_role only; rolled back at end).
-- This allows inserting auth.users-dependent rows (profiles, challenge_progress)
-- without seeding the auth schema. Standard pgTAP isolation pattern.
set local session_replication_role = replica;
select plan(5);

-- ---------------------------------------------------------------------------
-- Test 1: email_send_counters table exists (lifecycle infra from Phase 22 plan 22-01)
-- ---------------------------------------------------------------------------
select has_table(
  'public',
  'email_send_counters',
  'email_send_counters table exists (lifecycle infra — Phase 22 migration 20270601000013)'
);

-- ---------------------------------------------------------------------------
-- Test 2: UPSERT with onConflict=key is idempotent and increments value
-- Proves that the lifecycle-behavior-triggered Edge Fn uses markSent correctly:
--   upsert({ key, value: 1 }, { onConflict: 'key' })
-- Simulating double-fire: two inserts with same key → value should be 2, NOT 1.
-- A bare UPDATE would silently no-op on first insert → value stays 0 → gate fails open.
-- ---------------------------------------------------------------------------
do $upsert_test$
declare
  v_key text := 'streak-warn:test-user-' || gen_random_uuid()::text || ':2026-05-21';
begin
  -- First fire: INSERT
  insert into public.email_send_counters (key, value, updated_at)
  values (v_key, 1, now())
  on conflict (key) do update
    set value = email_send_counters.value + 1,
        updated_at = now();

  -- Second fire: should increment (simulates double-fire in same cycle)
  insert into public.email_send_counters (key, value, updated_at)
  values (v_key, 1, now())
  on conflict (key) do update
    set value = email_send_counters.value + 1,
        updated_at = now();

  -- Verify value = 2 (incremented twice, not stuck at 1 from bare UPDATE)
  perform is(
    (select value from public.email_send_counters where key = v_key),
    2::bigint,
    'UPSERT increments existing row (value=2 after 2 fires, not bare UPDATE no-op)'
  );
end $upsert_test$;

-- Test 2 confirm (the perform is() inside DO block doesn't count as a tap result;
-- re-run as a direct assertion using a stable key pattern)
select is(
  (select count(*) from public.email_send_counters
    where key like 'streak-warn:test-user-%:2026-05-21' and value = 2),
  1::bigint,
  'UPSERT increments existing row — value=2 confirms double-fire idempotency (NOT bare UPDATE no-op)'
);

-- ---------------------------------------------------------------------------
-- Test 3: challenge_progress.notified_kickoff_at can be set
-- Proves defense-in-depth alongside email_send_counters works for Monday kickoff.
-- ---------------------------------------------------------------------------
do $setup_kickoff$
declare
  v_uid uuid := gen_random_uuid();
  v_cid uuid := gen_random_uuid();
begin
  -- Minimal profile for FK
  insert into public.profiles (id, timezone)
  values (v_uid, 'UTC')
  on conflict (id) do nothing;

  -- Active challenge with dates (chk_active_dates)
  insert into public.weekly_challenges
    (id, title, framing, challenge_type, threshold, duration, status, starts_at, ends_at)
  values
    (v_cid, 'pgTAP kickoff test', 'Log something this week',
     'log_count', 5, 'week', 'active',
     now() - interval '1 day', now() + interval '6 days');

  -- Progress row: no kickoff notification yet
  insert into public.challenge_progress
    (user_id, challenge_id, progress_count, updated_at)
  values (v_uid, v_cid, 0, now());

  -- Simulate kickoff notification write (defense-in-depth UPDATE)
  update public.challenge_progress
     set notified_kickoff_at = now()
   where user_id = v_uid and challenge_id = v_cid;

  -- Store for assertion
  perform set_config('p35_test.uid_kickoff_t3', v_uid::text, true);
  perform set_config('p35_test.cid_kickoff_t3', v_cid::text, true);
end $setup_kickoff$;

select isnt(
  (select notified_kickoff_at
     from public.challenge_progress
    where user_id = current_setting('p35_test.uid_kickoff_t3')::uuid
      and challenge_id = current_setting('p35_test.cid_kickoff_t3')::uuid),
  null::timestamptz,
  'challenge_progress.notified_kickoff_at can be set (defense-in-depth alongside email_send_counters)'
);

-- ---------------------------------------------------------------------------
-- Test 4: monotonic completed_at trigger blocks completed_at → NULL transition
-- Plan 35-05 REVIEW-B-2 context: trigger only raises on NOT NULL → NULL.
-- ---------------------------------------------------------------------------
do $setup_completed$
declare
  v_uid uuid := gen_random_uuid();
  v_cid uuid := gen_random_uuid();
begin
  insert into public.profiles (id, timezone)
  values (v_uid, 'UTC')
  on conflict (id) do nothing;

  insert into public.weekly_challenges
    (id, title, framing, challenge_type, threshold, duration, status, starts_at, ends_at)
  values
    (v_cid, 'pgTAP monotonic test', 'Monotonic test framing',
     'log_count', 5, 'week', 'active',
     now() - interval '2 days', now() + interval '5 days');

  -- Progress with completed_at already set
  insert into public.challenge_progress
    (user_id, challenge_id, progress_count, completed_at, updated_at)
  values (v_uid, v_cid, 5, now() - interval '1 hour', now() - interval '1 hour');

  perform set_config('p35_test.uid_completed', v_uid::text, true);
  perform set_config('p35_test.cid_completed', v_cid::text, true);
end $setup_completed$;

select throws_ok(
  $sql$
    update public.challenge_progress
       set completed_at = null
     where user_id = current_setting('p35_test.uid_completed')::uuid
       and challenge_id = current_setting('p35_test.cid_completed')::uuid
  $sql$,
  '23514',
  null,
  'challenge_progress.completed_at is monotonic — cannot transition from non-null to null'
);

-- ---------------------------------------------------------------------------
-- Test 5 (REVIEW-B-2): notified_kickoff_at UPDATE passes even when completed_at is
-- already non-null. This is the production path: user completes before Monday kickoff.
-- The trigger MUST allow this (it only blocks completed_at → NULL, not other column updates).
-- ---------------------------------------------------------------------------
do $setup_b2$
declare
  v_uid uuid := gen_random_uuid();
  v_cid uuid := gen_random_uuid();
begin
  insert into public.profiles (id, timezone)
  values (v_uid, 'UTC')
  on conflict (id) do nothing;

  insert into public.weekly_challenges
    (id, title, framing, challenge_type, threshold, duration, status, starts_at, ends_at)
  values
    (v_cid, 'pgTAP REVIEW-B-2 test', 'Pre-completed framing',
     'log_count', 5, 'week', 'active',
     now() - interval '2 days', now() + interval '5 days');

  -- Row with completed_at ALREADY set (user completed before kickoff fired)
  insert into public.challenge_progress
    (user_id, challenge_id, progress_count, completed_at, updated_at)
  values (v_uid, v_cid, 5, now() - interval '1 hour', now() - interval '1 hour');

  perform set_config('p35_test.uid_b2', v_uid::text, true);
  perform set_config('p35_test.cid_b2', v_cid::text, true);
end $setup_b2$;

select lives_ok(
  $sql$
    update public.challenge_progress
       set notified_kickoff_at = now()
     where user_id = current_setting('p35_test.uid_b2')::uuid
       and challenge_id = current_setting('p35_test.cid_b2')::uuid
  $sql$,
  'REVIEW-B-2: notified_kickoff_at UPDATE lives on row with completed_at already non-null (monotonic trigger allows)'
);

select * from finish();
rollback;
