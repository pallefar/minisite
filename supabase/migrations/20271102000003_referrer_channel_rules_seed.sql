-- Phase 51 Plan 51-01 — referrer_channel_rules operator-editable table + ~80 seed rows
-- + classify_channel_group_with_referrer() wrapper.
-- Decision refs: D-03 (curated referrer-domain taxonomy seeded from Snowplow
-- referer-parser https://github.com/snowplow-referer-parser).
-- Requirements: TRAFFIC-05.
--
-- When utm fields are absent, the matview refresh + recorder Edge Fn fall back
-- to referrer-domain classification. Lower priority int wins (mirrors
-- channel_groups). Operator-editable via the Plan 51-09 admin UI; new rows
-- take effect at next matview refresh.
--
-- Seed list sourced from Snowplow referer-parser (Apache-2.0 licensed). The
-- canonical channel_group labels reference the rows seeded in
-- 20271102000002_channel_groups.sql via ON UPDATE CASCADE so an operator
-- relabel propagates.
--
-- Migration timestamp note: renamed from 20270712000003 to 20271102000003
-- per 51-01 execute-time preflight (reference_supabase_back_dated_migration_blocks_push).
--
-- RLS policies land in 20271102000006_traffic_taxonomy_rls.sql.

create table public.referrer_channel_rules (
  id                    uuid         primary key default gen_random_uuid(),
  referrer_domain       text         not null unique,
  channel_group_label   text         not null references public.channel_groups(label) on update cascade,
  priority              int          not null default 50,
  created_at            timestamptz  not null default now(),
  updated_at            timestamptz  not null default now()
);

-- Domain-lookup index. Explicit unique even though the column constraint
-- already implies one — mirrors P30 matview pattern of stating intent.
create unique index rcr_domain_uq
  on public.referrer_channel_rules (referrer_domain);

-- Seed ~80 well-known referrers across Organic Search / Organic Social /
-- Email / Referral. Derived from Snowplow referer-parser referers.yml
-- (Apache-2.0 license; sourced 2026-05-24). Priority defaults to 50; can
-- be edited by operator for tighter overrides.
insert into public.referrer_channel_rules (referrer_domain, channel_group_label, priority) values
  -- Organic Search (25 search-engine domains)
  ('google.com',              'Organic Search', 40),
  ('www.google.com',          'Organic Search', 40),
  ('google.co.uk',            'Organic Search', 40),
  ('google.de',               'Organic Search', 40),
  ('google.fr',               'Organic Search', 40),
  ('google.es',               'Organic Search', 40),
  ('google.it',               'Organic Search', 40),
  ('google.com.br',           'Organic Search', 40),
  ('google.com.au',           'Organic Search', 40),
  ('google.ca',               'Organic Search', 40),
  ('bing.com',                'Organic Search', 40),
  ('www.bing.com',            'Organic Search', 40),
  ('duckduckgo.com',          'Organic Search', 40),
  ('search.brave.com',        'Organic Search', 40),
  ('brave.com',               'Organic Search', 40),
  ('yahoo.com',               'Organic Search', 40),
  ('search.yahoo.com',        'Organic Search', 40),
  ('baidu.com',               'Organic Search', 40),
  ('www.baidu.com',           'Organic Search', 40),
  ('yandex.ru',               'Organic Search', 40),
  ('yandex.com',              'Organic Search', 40),
  ('ecosia.org',              'Organic Search', 40),
  ('startpage.com',           'Organic Search', 40),
  ('kagi.com',                'Organic Search', 40),
  ('qwant.com',               'Organic Search', 40),

  -- Organic Social (25 social domains)
  ('facebook.com',            'Organic Social', 41),
  ('m.facebook.com',          'Organic Social', 41),
  ('l.facebook.com',          'Organic Social', 41),
  ('lm.facebook.com',         'Organic Social', 41),
  ('instagram.com',           'Organic Social', 41),
  ('l.instagram.com',         'Organic Social', 41),
  ('www.instagram.com',       'Organic Social', 41),
  ('x.com',                   'Organic Social', 41),
  ('twitter.com',             'Organic Social', 41),
  ('mobile.twitter.com',      'Organic Social', 41),
  ('t.co',                    'Organic Social', 41),
  ('tiktok.com',              'Organic Social', 41),
  ('www.tiktok.com',          'Organic Social', 41),
  ('linkedin.com',            'Organic Social', 41),
  ('www.linkedin.com',        'Organic Social', 41),
  ('lnkd.in',                 'Organic Social', 41),
  ('reddit.com',              'Organic Social', 41),
  ('old.reddit.com',          'Organic Social', 41),
  ('m.reddit.com',            'Organic Social', 41),
  ('www.reddit.com',          'Organic Social', 41),
  ('pinterest.com',           'Organic Social', 41),
  ('www.pinterest.com',       'Organic Social', 41),
  ('threads.net',             'Organic Social', 41),
  ('mastodon.social',         'Organic Social', 41),
  ('bsky.app',                'Organic Social', 41),

  -- Email (15 webmail domains)
  ('mail.google.com',         'Email', 20),
  ('mail.yahoo.com',          'Email', 20),
  ('outlook.com',             'Email', 20),
  ('outlook.live.com',        'Email', 20),
  ('outlook.office.com',      'Email', 20),
  ('mail.ru',                 'Email', 20),
  ('e.mail.ru',               'Email', 20),
  ('m.yandex.ru',             'Email', 20),
  ('mail.yandex.com',         'Email', 20),
  ('mail.proton.me',          'Email', 20),
  ('proton.me',               'Email', 20),
  ('icloud.com',              'Email', 20),
  ('mail.aol.com',            'Email', 20),
  ('zoho.com',                'Email', 20),
  ('fastmail.com',            'Email', 20),

  -- Referral (15 notable referral domains)
  ('news.ycombinator.com',    'Referral', 50),
  ('producthunt.com',         'Referral', 50),
  ('www.producthunt.com',     'Referral', 50),
  ('github.com',              'Referral', 50),
  ('www.github.com',          'Referral', 50),
  ('medium.com',              'Referral', 50),
  ('dev.to',                  'Referral', 50),
  ('stackoverflow.com',       'Referral', 50),
  ('lobste.rs',               'Referral', 50),
  ('substack.com',            'Referral', 50),
  ('quora.com',               'Referral', 50),
  ('www.quora.com',           'Referral', 50),
  ('hackernoon.com',          'Referral', 50),
  ('discord.com',             'Referral', 50),
  ('slack.com',               'Referral', 50);

-- Wrapper classifier — falls through from utm-based classification to
-- referrer-host lookup to the 'Direct' fallback. Stable (depends on
-- channel_groups + referrer_channel_rules contents).
create or replace function public.classify_channel_group_with_referrer(
  p_utm_source    text,
  p_utm_medium    text,
  p_utm_campaign  text,
  p_referrer_host text
) returns text
  language sql
  stable
  set search_path = pg_catalog, public, extensions
as $$
  select coalesce(
    public.classify_channel_group(p_utm_source, p_utm_medium, p_utm_campaign),
    (
      select channel_group_label
      from public.referrer_channel_rules
      where referrer_domain = lower(p_referrer_host)
      order by priority asc
      limit 1
    ),
    'Direct'
  );
$$;

alter table public.referrer_channel_rules enable row level security;

comment on table public.referrer_channel_rules is
  'Phase 51 / D-03 — Operator-editable referrer-domain to channel_group mapping. ~80 seed rows derived from Snowplow referer-parser (Apache-2.0). When utm fields are absent, classify_channel_group_with_referrer() falls through to this lookup.';
