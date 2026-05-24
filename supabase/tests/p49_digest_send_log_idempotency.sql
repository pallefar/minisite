-- Phase 49 Plan 05 — digest_send_log UPSERT idempotency proof.
--
-- Asserts: 2 attempts to write the same (user_id, kind, sent_date) collapse to 1 row
-- via UPSERT, OR the raw INSERT raises 23505 unique_violation when ON CONFLICT omitted.
-- This proves cron re-fires within the same UTC day don't double-send digest emails.
--
-- TODO (Wave 1 GREEN): fixture seed + assertions. Marked TODO until Wave 1 Edge Fn
-- plans (49-06/07) wire the assertions inline.

begin;

-- 1. Seed a test user row in public.profiles (or use existing fixture user_id).
-- 2. insert into public.digest_send_log (user_id, kind, sent_at, status)
--    values (<test_user>, 'daily', now(), 'sent');
-- 3. insert into public.digest_send_log (user_id, kind, sent_at, status)
--    values (<test_user>, 'daily', now(), 'skipped:no-content')
--    on conflict (user_id, kind, sent_date) do update set status = excluded.status;
-- 4. assert: select count(*) from public.digest_send_log
--             where user_id = <test_user> and kind = 'daily' and sent_date = current_date
--           equals 1.
-- 5. attempt raw INSERT (no ON CONFLICT) → assert SQLSTATE 23505 raised.
-- 6. Cleanup via rollback at end of transaction.

rollback;
