-- Phase 32 Plan 32-04 — I18N-08: admin-editable locale_overrides hot-patch surface.
--
-- Per CONTEXT D-08: per-org overrides (org_id NOT NULL) + global overrides
-- (org_id IS NULL) — both modes share one table; uniqueness uses COALESCE so
-- NULL collides with NULL.
-- Per 32-RESEARCH Open Item #5: `published` flag drains drafts from the public
-- read path so admins can stage edits before flipping them live.
--
-- RLS shape (plan-checker iter-1+2 fixes applied):
--   SELECT — published=true rows scoped to user's orgs OR globals (org_id IS NULL)
--   INSERT/UPDATE/DELETE — admin-only via Phase 24 is_admin_at_least('admin'::admin_role)
--     (admin_role is a COLUMN on profiles — NOT a separate admin_users table;
--      added by 20270601000027_profiles_admin_role_column.sql).
--
-- updated_at: inline locale_overrides_set_updated_at() (no shared helper exists;
-- mirrors the landing_pages pattern in 20261101000002_page_builder_tables.sql).
--
-- FK target: public.organizations (renamed from clinic_orgs in Phase 28
-- migration 20270601100001_p28_reconcile_orgs_to_organizations.sql).

create table public.locale_overrides (
  id          uuid        primary key default gen_random_uuid(),
  org_id      uuid        references public.organizations(id) on delete cascade,
  lng         text        not null check (lng in ('en', 'es')),
  ns          text        not null,
  key         text        not null,
  value       text        not null,
  published   boolean     not null default false,
  created_by  uuid        references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Unique-key using coalesce so NULL org_id (global) collides only with itself.
create unique index locale_overrides_unique_key
  on public.locale_overrides
  (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), lng, ns, key);

-- Hot-path lookup index for override-backend client reads
-- (deferred to a non-partial form so it stays useful for both org-scoped and
-- global selects).
create index locale_overrides_lookup_published
  on public.locale_overrides (lng, ns, published);

-- ---------------------------------------------------------------------------
-- updated_at trigger — inline per landing_pages_set_updated_at pattern
-- (20261101000002_page_builder_tables.sql line 51).
-- ---------------------------------------------------------------------------
create or replace function public.locale_overrides_set_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger locale_overrides_set_updated_at_trigger
  before update on public.locale_overrides
  for each row execute function public.locale_overrides_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — enabled with two policies (1 SELECT + 1 ALL for admin writes).
-- ---------------------------------------------------------------------------
alter table public.locale_overrides enable row level security;

-- SELECT — authenticated readers see published rows scoped to one of their
-- orgs OR globally-published rows (org_id IS NULL).
-- Anonymous users (auth.uid() IS NULL) get ONLY org_id IS NULL globals because
-- the org_members subquery yields zero rows for them.
create policy locale_overrides_select_published on public.locale_overrides
  for select
  using (
    published = true
    and (
      org_id is null
      or org_id in (
        select org_id from public.org_members where user_id = auth.uid()
      )
    )
  );

-- INSERT/UPDATE/DELETE — admin-only via Phase 24 helper.
-- (No admin_users table exists; admin_role lives on profiles.)
create policy locale_overrides_admin_write on public.locale_overrides
  for all
  using (public.is_admin_at_least('admin'::public.admin_role))
  with check (public.is_admin_at_least('admin'::public.admin_role));

comment on table public.locale_overrides is
  'Admin-editable per-org or global translation overrides; merged on top of /locales/{lng}/{ns}.json catalog by the client + Edge Fns. Plan 32-04 / CONTEXT D-08 / 32-RESEARCH Open Item #5.';

comment on column public.locale_overrides.org_id is
  'NULL = global override (applies to every client). NOT NULL = scoped to one org via the SELECT policy.';

comment on column public.locale_overrides.published is
  'Drafts (false) are invisible to non-admin readers (RLS filter); admin clicks Publish to flip → triggers Realtime broadcast on locale_overrides:{org_id|global} channel (Plan 32-04 override-backend).';
