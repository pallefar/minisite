-- Phase 36 Plan 36-01 — REVIEW-04/08: review_cta_catalog seed table.
--
-- CONTEXT references:
--   - D-13: 5-row CTA catalog (3 web: trustpilot/g2/capterra, 2 mobile-shell:
--     apple_app_store/google_play). v1.3 surface filters out requires_mobile_shell=true.
--   - D-14: per-cohort auto-targeting by primary_org_id resolves CTA shortlist.
--   - D-16: vendor profile claim is HUMAN gate; admin flips `claimed=true` later.
--   - url_pattern CHECK restricts to https://, itms-apps:// (iOS), market:// (Android).

begin;

create table if not exists public.review_cta_catalog (
  slug                    text primary key,
  display_name            text not null,
  url_pattern             text not null check (url_pattern ~ '^(https?://|itms-apps://|market://)'),
  requires_mobile_shell   boolean not null default false,
  available_for_org_type  text not null check (available_for_org_type in ('consumer','clinic','both')),
  claimed                 boolean not null default false,
  created_at              timestamptz not null default now()
);

comment on table public.review_cta_catalog is
  'REVIEW-04/08 / D-13: CTA targets for promoter (4-5★) modal. v1.3 surfaces '
  'only requires_mobile_shell=false rows. claimed=true once founder verifies '
  'the vendor profile (D-16 HUMAN gate). available_for_org_type drives '
  'cohort-based filtering in Wave 3 surface (D-14).';

alter table public.review_cta_catalog enable row level security;

-- Catalog is non-sensitive: any authenticated user can SELECT to render the modal.
drop policy if exists review_cta_catalog_authenticated_select on public.review_cta_catalog;
create policy review_cta_catalog_authenticated_select
  on public.review_cta_catalog
  for select
  to authenticated
  using (true);

-- INSERT / UPDATE / DELETE denied for all (seed-only in v1.3 per UI-SPEC Surface F).
-- Admin claim-flip path is a future SECDEF RPC if/when needed; for v1.3 we ship
-- the 5 rows once and never mutate.

-- Seed (D-13). ON CONFLICT DO NOTHING so the migration is idempotent.
insert into public.review_cta_catalog (slug, display_name, url_pattern, requires_mobile_shell, available_for_org_type, claimed)
values
  ('trustpilot',
   'Trustpilot',
   'https://www.trustpilot.com/review/leanshot.app',
   false,
   'consumer',
   false),
  ('g2',
   'G2',
   'https://www.g2.com/products/leanshot/reviews',
   false,
   'clinic',
   false),
  ('capterra',
   'Capterra',
   'https://www.capterra.com/p/leanshot/reviews',
   false,
   'clinic',
   false),
  ('apple_app_store',
   'Apple App Store',
   'itms-apps://itunes.apple.com/app/idTBD?action=write-review',
   true,
   'both',
   false),
  ('google_play',
   'Google Play',
   'market://details?id=app.leanshot',
   true,
   'both',
   false)
on conflict (slug) do nothing;

commit;
