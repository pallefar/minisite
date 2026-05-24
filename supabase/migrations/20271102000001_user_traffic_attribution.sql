-- Phase 51 Plan 51-01 — user_traffic_attribution authoritative SQL table.
-- Decision refs: D-02 (first-touch + last-touch), D-04 (lt_anon_id stitch),
-- D-12 (per-org dimension), D-13 (SQL table is source of truth).
-- Requirements: TRAFFIC-01, TRAFFIC-10.
--
-- One row per anon visitor identified by `anon_id` (UUIDv4 from lt_anon_id
-- cookie set by Vercel Edge Middleware in Plan 51-02). Stitched to a Supabase
-- user via `claim_traffic_attribution` SECDEF RPC on signup (called from
-- merge-anon-session Edge Fn extension).
--
-- Columns are split into first_touch_* and last_touch_* mirrors. The
-- upsert_traffic_attribution RPC's ON CONFLICT clause writes ONLY to
-- last_touch_* + last_touch_at + updated_at + (org_id when previously null);
-- first_touch_* columns are NEVER overwritten after the initial INSERT
-- (D-02 first-touch immutability).
--
-- PHI containment: this table carries NO PHI columns (utm_* + referrer +
-- landing_path are non-PHI by construction; the recorder Edge Fn in Plan
-- 51-02 path-redacts /patient/* / /clinic/*/patient/* / /dose-log/* before
-- write per RESEARCH §Security V6).
--
-- Migration timestamp note: renamed from 20270712000001 to 20271102000001
-- per Phase 51-01 execute-time preflight to avoid back-dated push block
-- (Phase 41 migrations applied 20271101*; reference_supabase_back_dated_migration_blocks_push).
--
-- RLS policies land in 20271102000006_traffic_taxonomy_rls.sql to keep
-- policy concerns single-file per the P30 matview pattern (analog
-- 20270601300004_p30_matviews_and_cron.sql).

create table public.user_traffic_attribution (
  anon_id                       text         not null,
  user_id                       uuid         references auth.users(id) on delete cascade,
  org_id                        uuid         references public.orgs(id) on delete set null,

  -- First-touch columns — set ONCE at first anon visit; immutable thereafter
  -- (enforced by upsert_traffic_attribution RPC's ON CONFLICT exclusion).
  first_touch_source            text,
  first_touch_medium            text,
  first_touch_campaign          text,
  first_touch_term              text,
  first_touch_content           text,
  first_touch_referrer          text,
  first_touch_landing_path      text,
  first_touch_channel_group     text,
  first_touch_at                timestamptz  not null,

  -- Last-touch columns — updated on EVERY subsequent visit (UPSERT path).
  last_touch_source             text,
  last_touch_medium             text,
  last_touch_campaign           text,
  last_touch_term               text,
  last_touch_content            text,
  last_touch_referrer           text,
  last_touch_landing_path       text,
  last_touch_channel_group      text,
  last_touch_at                 timestamptz  not null,

  updated_at                    timestamptz  not null default now(),
  created_at                    timestamptz  not null default now()
);

-- Anon_id is the natural primary key — one row per anonymous visitor. UNIQUE
-- index supports the ON CONFLICT (anon_id) clause in upsert_traffic_attribution.
create unique index utat_anon_id_uq
  on public.user_traffic_attribution (anon_id);

-- Partial index — only the (typically smaller) stitched-user subset benefits
-- from a per-user lookup. Predicate is IMMUTABLE (just a NULL check) per
-- reference_supabase_migration_gotchas.
create index utat_user_id_idx
  on public.user_traffic_attribution (user_id)
  where user_id is not null;

-- Per-org last-touch lookup for the dashboard's per-clinic-org scope (D-12).
-- Partial index — only org-stamped rows are interesting to the org dashboard.
create index utat_org_id_last_touch_idx
  on public.user_traffic_attribution (org_id, last_touch_at)
  where org_id is not null;

alter table public.user_traffic_attribution enable row level security;

comment on table public.user_traffic_attribution is
  'Phase 51 / D-02 / D-13 — Authoritative per-anon-visitor traffic attribution. First-touch columns are immutable post-insert (enforced by upsert_traffic_attribution RPC). PostHog person-properties mirror is best-effort via captureServer() in 51-02 recorder Fn.';
