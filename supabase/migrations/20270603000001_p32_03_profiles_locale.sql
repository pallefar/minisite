-- Phase 32 Plan 32-03 — I18N-02: profiles.locale persistence
-- Per CONTEXT D-10: single 'es' namespace (es-419 LatAm neutral); profiles.locale stays 2-char.
-- Per CONTEXT D-08: Edge Fns read this at email-send time, default 'en' if null.
--
-- Additive column only. No RLS policy change required — existing per-row policies
-- on public.profiles already gate by auth.uid() = id. CHECK constraint enforces the
-- 2-value domain at the DB layer (mitigates T-32-03-01).

alter table public.profiles
  add column if not exists locale text not null default 'en'
  check (locale in ('en', 'es'));

comment on column public.profiles.locale is
  'User language preference. ''en'' default; ''es'' set via Settings → Language or signup detection. Read by Edge Fns at email-send time (P32-05). Single namespace per locked CONTEXT D-10 — regionalisms via locale_overrides (P32-04) if needed.';
