-- Phase 9 Plan 09-01 — orgs table.
--
-- The orgs table is the workspace anchor for every clinic surface in
-- Phase 9 + Phase 10. Each org owns a slug-keyed URL prefix
-- (`app.leanshot.app/clinic/<slug>`) — the slug is therefore globally
-- unique (lowercased) AND blocklisted against routes the app already
-- owns (so an attacker can't squat `clinic/auth` etc.).
--
-- D-08 + D-09 + D-14 carry-forwards:
--   - id is the FK target for memberships, invites, roles, role_permissions
--   - slug is the URL fragment + the user-visible workspace identifier
--   - logo_storage_path points into the `org-logos` bucket (created in
--     20260801000003); Storage policies in that migration extract org_id
--     via `(storage.foldername(name))[1]` per Pitfall #6.
--   - owner_user_id is the operator who originally created the org. It is
--     `on delete restrict` so deleting an auth.users row that still owns
--     orgs surfaces as an explicit error rather than silently orphaning
--     the workspace.
--
-- RLS contract: SELECT is gated by has_permission(uid, id, 'org.read') OR
-- ownership. NO authenticated INSERT/UPDATE/DELETE — only the SECURITY
-- DEFINER RPCs in 20260801000011 (`create_org`, `update_org`, `delete_org`)
-- write. This is the same default-deny pattern Phase 7 audit_logs uses;
-- the absence of write policies IS the mitigation (T-09-S2).
--
-- Reserved-word blocklist (kept inline rather than in a separate table so
-- the CHECK constraint is self-contained and fully auditable in this
-- migration). Any new top-level route in vercel.json or App.tsx must be
-- mirrored here. Per memory `project_phase8_phase9_planning_complete.md`
-- vercel.json rewrites for `/clinic/*` are still pending — when added,
-- the slug check below already protects `clinic` from being claimed as a
-- slug.

create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null check (char_length(name) between 1 and 60),
  description text,
  website_url text,
  -- 'org-logos/<id>/logo.{ext}' or null. Path is bucket-relative inside
  -- the `org-logos` bucket — DO NOT include the bucket name as a prefix
  -- in the stored value (Pitfall #6 silently breaks Storage RLS extraction).
  logo_storage_path text,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  -- Soft-delete flag. delete_org RPC (20260801000011) does a HARD delete
  -- after cascading; deleted_at is reserved for a future "mark for deletion"
  -- workflow (Phase 10 / vNext). Nullable for now.
  deleted_at timestamptz
);

-- Slug format + reserved-word blocklist in a single CHECK so violations
-- surface with one error code from the DB layer.
alter table public.orgs
  add constraint orgs_slug_format check (
    slug ~ '^[a-z][a-z0-9-]{1,59}$'
    and slug not in (
      'api', 'auth', 'settings', 'admin', 'app', 'clinic', 'clinic-invite',
      'legal', 'login', 'logout', 'signup', 'help', 'about', 'home',
      'static', 'public', 'assets', 'functions', 'share'
    )
  );

-- Globally unique slug (case-insensitive). Operator UI lowercases input
-- BEFORE submit; the index lowercases at the DB layer too as a defense
-- in depth.
create unique index if not exists orgs_slug_idx on public.orgs (lower(slug));

-- Index for owner lookups (workspace switcher renders "Workspaces I run"
-- by selecting orgs WHERE owner_user_id = auth.uid()).
create index if not exists orgs_owner_idx on public.orgs (owner_user_id);

alter table public.orgs enable row level security;

-- SELECT: visible to (a) the owner unconditionally OR (b) any active
-- member with org.read permission. The has_permission() helper is created
-- in 20260801000009; this policy assumes it exists at apply time. Since
-- migration order is 02 < 09, the policy is created here using a forward
-- reference — Postgres only resolves the function during plan time, not at
-- DDL time, so a forward reference is safe within the same `supabase db push`.
create policy orgs_select_by_member on public.orgs
  for select to authenticated
  using (
    auth.uid() = owner_user_id
    or public.has_permission(auth.uid(), id, 'org.read')
  );

-- NO INSERT / UPDATE / DELETE policies for the authenticated role.
-- Writes go through SECURITY DEFINER RPCs only.

-- Realtime publication membership. The Phase 9 broadcast pattern uses
-- realtime.broadcast_changes() (NOT postgres_changes), but the org row is
-- still listed here for parity with Phase 5/6 in case a planner mixes
-- both patterns later.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'orgs'
  ) then
    execute 'alter publication supabase_realtime add table public.orgs';
  end if;
end $$;
