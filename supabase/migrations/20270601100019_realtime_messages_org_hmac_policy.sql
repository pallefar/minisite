-- Phase 28 Plan 04 Task 2 — RLS policy for HMAC-authenticated realtime channels.
--
-- This policy replaces (or coexists with) the Phase 9 `clinic_org_topic_select`
-- policy on `realtime.messages`. The P28 policy is topic-format-aware:
--   - Topics of shape `org-{8hex}-{table}` are gated by HMAC+claim check.
--   - The existing P9 policy (`org:<uuid>` shape) is untouched (Plan 04
--     does NOT modify Phase 9 policies — per HARD RULES, no modify clinic-realtime).
--
-- Per addendum A4: policy is a ONE-LINER calling the SECDEF helper
-- `realtime_topic_authorized`. The helper encapsulates:
--   1. Topic shape validation (malformed → false).
--   2. HMAC recomputation for each org_id in JWT claims.
--   3. Defense-in-depth claim membership check (Pitfall 2).
--
-- `current_setting('request.jwt.claims', true)::jsonb` is the correct pattern
-- for accessing JWT claims inside a Supabase Realtime RLS policy.
-- CONTEXT D-23's `claim()` helper does NOT exist — addendum A4 corrects this.

create policy "org_hmac_channel_select"
  on realtime.messages
  for select
  to authenticated
  using (
    public.realtime_topic_authorized(
      realtime.topic(),
      current_setting('request.jwt.claims', true)::jsonb
    )
  );
