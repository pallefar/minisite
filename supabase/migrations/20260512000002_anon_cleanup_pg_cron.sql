-- Phase 4 D-04 (CONTEXT D-02 trade-off; T-04-05 mitigation).
--
-- Anonymous Supabase auth (D-02) mints an `auth.users` row with
-- `is_anonymous = true` on first AI send. Returning visitors reuse the
-- cached JWT, but users who never link to an email accumulate rows
-- indefinitely. This pg_cron job deletes anonymous rows older than
-- 30 days, daily at 03:00 UTC.
--
-- Cascade depth:
--   `auth.users` → `public.ai_messages` (ON DELETE CASCADE)
--   `auth.users` → `public.rate_limit_counters` (ON DELETE CASCADE)
-- A single auth.users delete therefore removes the user's conversation
-- log + counter rows in one transaction.
--
-- pg_cron extension is enabled by default on Supabase projects since
-- 2024. The `create extension if not exists` prepend is a no-op safety
-- net for older projects.

create extension if not exists pg_cron;

select cron.schedule(
  'cleanup-anon-users',
  '0 3 * * *',
  $$
    delete from auth.users
    where is_anonymous = true
      and created_at < now() - interval '30 days';
  $$
);
