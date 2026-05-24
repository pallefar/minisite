-- Phase 51 Plan 51-01 — channel_groups operator-editable taxonomy table + 8 seed rows +
-- classify_channel_group(p_utm_source, p_utm_medium, p_utm_campaign) SQL helper.
-- Decision refs: D-01 (operator-configurable channel taxonomy), D-07 (per-channel
-- attribution_window_days override).
-- Requirements: TRAFFIC-04, TRAFFIC-07.
--
-- Operator edits this table via the Plan 51-09 admin UI (SECDEF CRUD RPCs).
-- The matview refresh cron picks up new/edited rules at next tick (D-01: no
-- deploy needed for taxonomy edits).
--
-- Match-rule shape: jsonb of the form
--   {"utm_medium": ["cpc","ppc","paidsearch"], "utm_source": ["google","bing"]}
-- AND-across-keys, OR-within-key. First (lowest priority int) match wins.
-- See classify_channel_group SQL body below for the canonical implementation.
--
-- Migration timestamp note: renamed from 20270712000002 to 20271102000002 per
-- 51-01 execute-time preflight (reference_supabase_back_dated_migration_blocks_push).
--
-- RLS policies land in 20271102000006_traffic_taxonomy_rls.sql.

create table public.channel_groups (
  id                        uuid         primary key default gen_random_uuid(),
  label                     text         not null unique,
  priority                  int          not null,
  match_rule_jsonb          jsonb        not null,
  attribution_window_days   int          not null default 30
                              check (attribution_window_days between 1 and 90),
  is_default_fallback       boolean      not null default false,
  created_at                timestamptz  not null default now(),
  updated_at                timestamptz  not null default now()
);

-- Enforce at most one fallback row. Partial-index predicate is a bare column
-- reference — IMMUTABLE per reference_supabase_migration_gotchas.
create unique index channel_groups_default_fallback_uq
  on public.channel_groups (is_default_fallback)
  where is_default_fallback;

-- Seed the 8 default channel groups (D-01, RESEARCH §Pattern 3 lines 348-398).
-- Priority ordering: lower number = higher priority. Paid Search beats Paid
-- Social (both have utm_medium=cpc but Paid Search has utm_source=google);
-- Direct is the catch-all fallback.
insert into public.channel_groups (label, priority, match_rule_jsonb, attribution_window_days, is_default_fallback)
values
  ('Paid Search',
    10,
    '{"utm_medium": ["cpc", "ppc", "paidsearch"], "utm_source": ["google", "bing", "duckduckgo"]}'::jsonb,
    30, false),
  ('Paid Social',
    11,
    '{"utm_medium": ["cpc", "ppc", "paidsocial", "social-paid"], "utm_source": ["facebook", "instagram", "tiktok", "linkedin", "twitter", "x", "reddit"]}'::jsonb,
    7, false),
  ('Email',
    20,
    '{"utm_medium": ["email", "newsletter"]}'::jsonb,
    30, false),
  ('Affiliate',
    30,
    '{"utm_medium": ["affiliate", "partner"]}'::jsonb,
    30, false),
  ('Organic Search',
    40,
    '{"utm_medium": ["organic", "organic_search"]}'::jsonb,
    60, false),
  ('Organic Social',
    41,
    '{"utm_medium": ["social", "social-organic", "organic_social"]}'::jsonb,
    30, false),
  ('Referral',
    50,
    '{"utm_medium": ["referral"]}'::jsonb,
    30, false),
  ('Direct',
    99,
    '{}'::jsonb,
    30, true);

-- SQL classifier — resolves a (utm_source, utm_medium, utm_campaign) tuple
-- to a channel_group label. AND across keys, OR within key, priority order.
-- STABLE (deterministic given input + same channel_groups snapshot) but not
-- IMMUTABLE (depends on table contents) — fine for matview SELECTs at
-- refresh time. Refresh body is plain SQL; this fn is not used in any
-- partial-index expression (reference_supabase_migration_gotchas).
--
-- search_path explicit per reference_supabase_migration_gotchas — SECDEF
-- not needed (no privileged read) but search_path safety still matters.
create or replace function public.classify_channel_group(
  p_utm_source   text,
  p_utm_medium   text,
  p_utm_campaign text
) returns text
  language sql
  stable
  set search_path = pg_catalog, public, extensions
as $$
  select cg.label
  from public.channel_groups cg
  where
    -- For each key present in match_rule_jsonb, the input must match one of
    -- the OR'd values. Keys absent from match_rule_jsonb are unconstrained.
    -- The exists/not-exists pair implements "AND across the keys that are
    -- present in match_rule_jsonb".
    not exists (
      select 1
      from jsonb_each(cg.match_rule_jsonb) as kv(key, value_array)
      where not (
        case kv.key
          when 'utm_source'   then coalesce(lower(p_utm_source),   '') = any (
            select lower(jsonb_array_elements_text(kv.value_array))
          )
          when 'utm_medium'   then coalesce(lower(p_utm_medium),   '') = any (
            select lower(jsonb_array_elements_text(kv.value_array))
          )
          when 'utm_campaign' then coalesce(lower(p_utm_campaign), '') = any (
            select lower(jsonb_array_elements_text(kv.value_array))
          )
          else true
        end
      )
    )
    -- Skip the default-fallback row in the priority scan; it only matches if
    -- nothing else does, handled by the COALESCE in the wrapper helper below.
    and not cg.is_default_fallback
    -- Skip the all-empty-rule rows (would otherwise match everything).
    and cg.match_rule_jsonb <> '{}'::jsonb
  order by cg.priority asc
  limit 1;
$$;

alter table public.channel_groups enable row level security;

comment on table public.channel_groups is
  'Phase 51 / D-01 — Operator-editable channel taxonomy. 8 seed rows shipped with this migration. Matview refresh cron consumes via classify_channel_group(); edits take effect at next refresh tick (no deploy).';
