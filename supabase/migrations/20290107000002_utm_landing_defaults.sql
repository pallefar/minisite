-- Phase 68 Plan 01 — Task 2
-- LAND-08 — UTM-source → default-landing-path resolver table.
--
-- `traffic-attribution-recorder` (Phase 51) reads this table to decide whether
-- a root-/ landing with a matching utm_source should be 307-redirected to the
-- audience-specific landing page (e.g. utm_source=clinic_outreach → /for-clinics).
--
-- Schema:
--   - utm_source: primary key (a single utm_source maps to at most one default landing).
--   - landing_path: must start with '/' and contain only URL-safe path chars.
--
-- RLS:
--   - SELECT for anon + authenticated (resolver runs without a user JWT for
--     pre-signup root landings).
--   - All write ops denied at policy level. Admin writes go through a SECDEF
--     RPC (defer to Phase 70 vendor/operator-action consolidation).

create table if not exists public.utm_landing_defaults (
  utm_source    text        primary key,
  landing_path  text        not null check (landing_path ~ '^/[a-z0-9/_-]+$'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.utm_landing_defaults enable row level security;

-- Read for authenticated (admin UI listing, future SECDEF admin RPC reads).
-- Bare CREATE POLICY (no IF NOT EXISTS — unsupported on remote PG per
-- [[feedback_phase_close_out_supabase_gotchas]]). Drop-then-create makes this
-- idempotent across re-applies.
drop policy if exists "utm_landing_defaults_read_authenticated" on public.utm_landing_defaults;
create policy "utm_landing_defaults_read_authenticated"
  on public.utm_landing_defaults
  for select
  to authenticated
  using (true);

-- Anon read so traffic-attribution-recorder can resolve without a user JWT
-- (root landing happens BEFORE signup).
drop policy if exists "utm_landing_defaults_read_anon" on public.utm_landing_defaults;
create policy "utm_landing_defaults_read_anon"
  on public.utm_landing_defaults
  for select
  to anon
  using (true);

-- Deny all direct writes; admin SECDEF RPC (Phase 70) is the only write path.
drop policy if exists "utm_landing_defaults_no_direct_write" on public.utm_landing_defaults;
create policy "utm_landing_defaults_no_direct_write"
  on public.utm_landing_defaults
  for all
  to authenticated
  using (false)
  with check (false);

-- Seed initial 3 mappings (clinic_outreach, coach_referral, doctor_referral).
-- `on conflict do nothing` keeps this idempotent across re-applies / drift.
insert into public.utm_landing_defaults (utm_source, landing_path) values
  ('clinic_outreach',  '/for-clinics'),
  ('coach_referral',   '/for-coaches'),
  ('doctor_referral',  '/for-doctors')
on conflict (utm_source) do nothing;

comment on table public.utm_landing_defaults is 'Phase 68 LAND-08: UTM source → default landing path resolver. Used by traffic-attribution-recorder for 307 redirect when user lands on root with matching utm_source.';
comment on column public.utm_landing_defaults.utm_source is 'utm_source value to match (e.g. clinic_outreach, coach_referral, doctor_referral). PK — one mapping per source.';
comment on column public.utm_landing_defaults.landing_path is 'Absolute path (must start with /) the user should be 307-redirected to. Validated by check constraint.';
