-- Phase 48 Plan 03 Task 3: hourly pg_cron job to auto-restore expired temp_suspended users
-- At each tick: UPDATE user_moderation_state SET status='active', expires_at=null
--   WHERE status='temp_suspended' AND expires_at < now()
-- Per restored row: log audit entry via log_moderation_action (Plan 48-04).
--
-- Dollar-quote tags:
--   outer $cron$ (passed to cron.schedule)
--   inner $restore$ (DO block body) — verified unique vs Phase 38 ($digest$/$winback$/$embed$),
--     Phase 47 ($reminders$), project-wide ($cleanup$/$unschedule$/$partition$).
--
-- auth.uid() is NULL in cron context — log_moderation_action records actor_id=null;
-- action_type='temp_restore' disambiguates from staff-initiated 'moderation_cleared'.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent re-apply: drop prior job if it exists.
do $unschedule$
begin
  perform cron.unschedule('phase48-temp-suspended-restore-hourly');
exception when others then null;
end $unschedule$;

select cron.schedule(
  'phase48-temp-suspended-restore-hourly',
  '0 * * * *',
  $cron$
  do $restore$
  declare
    r record;
  begin
    for r in
      update public.user_moderation_state
        set status     = 'active',
            expires_at = null,
            updated_at = now()
      where status = 'temp_suspended'
        and expires_at < now()
      returning user_id
    loop
      perform public.log_moderation_action(
        p_action_type => 'temp_restore',
        p_target_type => 'user',
        p_target_id   => r.user_id,
        p_before      => jsonb_build_object('status','temp_suspended'),
        p_after       => jsonb_build_object('status','active'),
        p_reason      => 'auto-restore on expires_at'
      );
    end loop;
  end;
  $restore$;
  $cron$
);
