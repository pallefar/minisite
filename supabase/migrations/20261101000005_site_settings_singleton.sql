-- Phase 15 Plan 01 — `public.site_settings` (singleton config row).
--
-- D-15: Global SEO defaults live in a single config row, edited via the
-- `/admin` staff settings panel (is_staff-gated). Per-page SEO overrides
-- cascade on top.
--
-- Singleton enforcement (T-15-01-12 mitigation): a partial unique index on
-- the constant `(true)` allows AT MOST one row to satisfy the predicate.
-- A second insert raises 23505 (unique-violation) at the DB level. Even
-- if RLS / app code were somehow bypassed, the DB rejects the second row.
--
-- Initial INSERT seeds the default row so the renderer never sees an empty
-- site_settings (it ALWAYS reads exactly one row). The `on conflict do
-- nothing` keeps re-apply safe.

create table public.site_settings (
  id                   uuid primary key default gen_random_uuid(),
  site_name            text not null default 'LeanShot',
  default_description  text,
  favicon_url          text,
  default_og_image     text,
  updated_at           timestamptz not null default now()
);

-- Singleton: at most one row may satisfy ((true)).
-- Predicate is a constant — IMMUTABLE-safe (Pitfall 1 doesn't apply but worth noting).
create unique index site_settings_singleton on public.site_settings ((true));

-- updated_at trigger
create or replace function public.site_settings_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'site_settings_set_updated_at_trigger'
  ) then
    create trigger site_settings_set_updated_at_trigger
      before update on public.site_settings
      for each row execute function public.site_settings_set_updated_at();
  end if;
end $$;

-- Seed the singleton row — idempotent (singleton index prevents a 2nd insert).
-- We use a WHERE NOT EXISTS pattern because `on conflict ((true))` on a partial
-- unique index doesn't work directly. This is concurrency-safe enough for a
-- one-time migration: the singleton index will reject any race-winner duplicate.
insert into public.site_settings (site_name)
select 'LeanShot'
where not exists (select 1 from public.site_settings);
