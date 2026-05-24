-- Phase 51 Plan 51-01 — upsert_traffic_attribution + claim_traffic_attribution
-- SECDEF RPCs. First-touch immutability is enforced via ON CONFLICT exclusion.
-- Decision refs: D-02 (first-touch immutability + last-touch upsert),
-- D-04 (anon→identified stitch).
-- Requirements: TRAFFIC-01, TRAFFIC-03.
-- Threat refs: T-51-02 (tampering of first_touch_*).
--
-- upsert_traffic_attribution is called by the Plan 51-02 traffic-attribution-
-- recorder Edge Fn (HMAC-payload auth from Vercel Edge Middleware) with the
-- service-role admin client. It UPSERTs by anon_id; the ON CONFLICT clause
-- writes ONLY to last_touch_* + last_touch_at + updated_at + (org_id when
-- previously null). first_touch_* columns are NEVER overwritten after the
-- initial INSERT.
--
-- claim_traffic_attribution is called by the Plan 51-02 merge-anon-session
-- Edge Fn extension on signup — stitches anon_id → user_id, but only on
-- previously-unstitched rows (WHERE user_id IS NULL) to prevent a hostile
-- second user from rebinding an existing anon attribution.
--
-- Both are SECURITY DEFINER with execute granted to service_role only;
-- anon + authenticated denied. There is NO auth.uid() inside either body —
-- per memory feedback_rpc_auth_uid_vs_service_role_mismatch, these RPCs
-- are intended for service-role callers and must not depend on user JWT
-- context.
--
-- Migration timestamp note: renamed from 20270712000005 to 20271102000005
-- per 51-01 execute-time preflight (reference_supabase_back_dated_migration_blocks_push).

create or replace function public.upsert_traffic_attribution(
  p_anon_id          text,
  p_org_id           uuid,
  p_utm_source       text,
  p_utm_medium       text,
  p_utm_campaign     text,
  p_utm_term         text,
  p_utm_content      text,
  p_referrer         text,
  p_landing_path     text,
  p_channel_group    text,
  p_now              timestamptz
) returns void
  language sql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
  insert into public.user_traffic_attribution (
    anon_id, org_id,
    first_touch_source, first_touch_medium, first_touch_campaign,
    first_touch_term, first_touch_content,
    first_touch_referrer, first_touch_landing_path, first_touch_channel_group,
    first_touch_at,
    last_touch_source, last_touch_medium, last_touch_campaign,
    last_touch_term, last_touch_content,
    last_touch_referrer, last_touch_landing_path, last_touch_channel_group,
    last_touch_at,
    updated_at
  ) values (
    p_anon_id, p_org_id,
    p_utm_source, p_utm_medium, p_utm_campaign,
    p_utm_term, p_utm_content,
    p_referrer, p_landing_path, p_channel_group,
    p_now,
    p_utm_source, p_utm_medium, p_utm_campaign,
    p_utm_term, p_utm_content,
    p_referrer, p_landing_path, p_channel_group,
    p_now,
    p_now
  )
  on conflict (anon_id) do update set
    -- D-02 immutability: first_touch_* columns are NEVER listed here.
    org_id                   = coalesce(public.user_traffic_attribution.org_id, excluded.org_id),
    last_touch_source        = excluded.last_touch_source,
    last_touch_medium        = excluded.last_touch_medium,
    last_touch_campaign      = excluded.last_touch_campaign,
    last_touch_term          = excluded.last_touch_term,
    last_touch_content       = excluded.last_touch_content,
    last_touch_referrer      = excluded.last_touch_referrer,
    last_touch_landing_path  = excluded.last_touch_landing_path,
    last_touch_channel_group = excluded.last_touch_channel_group,
    last_touch_at            = excluded.last_touch_at,
    updated_at               = excluded.updated_at;
$$;

revoke execute on function public.upsert_traffic_attribution(
  text, uuid, text, text, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.upsert_traffic_attribution(
  text, uuid, text, text, text, text, text, text, text, text, timestamptz
) to service_role;


-- ---------------------------------------------------------------------------
-- claim_traffic_attribution — stitches anon_id → user_id on signup.
-- Idempotent: re-calls on an already-stitched row are no-ops. Late stitch
-- (anon_id row exists but user_id was null) sets it.
-- ---------------------------------------------------------------------------
create or replace function public.claim_traffic_attribution(
  p_anon_id text,
  p_user_id uuid
) returns void
  language sql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
  update public.user_traffic_attribution
  set user_id    = p_user_id,
      updated_at = now()
  where anon_id  = p_anon_id
    and user_id  is null;
$$;

revoke execute on function public.claim_traffic_attribution(text, uuid)
  from public, anon, authenticated;

grant execute on function public.claim_traffic_attribution(text, uuid)
  to service_role;

comment on function public.upsert_traffic_attribution(
  text, uuid, text, text, text, text, text, text, text, text, timestamptz
) is
  'Phase 51 / D-02 — UPSERT a traffic touch keyed by anon_id. ON CONFLICT updates only last_touch_* + (org_id when previously null); first_touch_* is immutable post-insert. Service-role only (called from traffic-attribution-recorder Fn).';

comment on function public.claim_traffic_attribution(text, uuid) is
  'Phase 51 / D-04 — Stitch anon attribution to a Supabase user. Idempotent; only sets user_id on previously-unstitched rows. Service-role only (called from merge-anon-session Fn).';
