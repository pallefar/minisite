-- Phase 41 Plan 41-02 — Custom-iframe per-deployment hostname allowlist.
-- Decision refs: D-14 (per-deployment allowlist), D-17 (superadmin-only),
-- EMBED-07 (Custom-iframe security model).
--
-- Stores the set of hostnames that the v1.3 superadmin has explicitly
-- whitelisted for use as Custom-iframe `embedUrl` hostnames. Reads are
-- consumed by:
--   • Plan 41-03's Vercel Edge Middleware (anon SELECT via PostgREST)
--     to dynamically extend the `frame-src` CSP directive at request time.
--   • Plan 41-06's superadmin admin UI to render the allowlist table.
--   • Plan 41-05's CustomIframeBlock editor preview (via Plan 41-06's
--     client wrappers in src/lib/admin/iframe-allowlist.ts) for client-side
--     validation parity with the server-side validator.
--
-- Writes flow exclusively through the two SECDEF RPCs shipped in the
-- sibling migration `20271101000002_p41_iframe_allowlist_rpcs.sql`:
--   • public.add_iframe_allowlist_hostname(p_hostname text) returns uuid
--   • public.remove_iframe_allowlist_hostname(p_id uuid) returns void
-- The RPCs gate on `public.is_admin_at_least('superadmin'::public.admin_role)`
-- and audit every mutation via `public.log_admin_action` (6-arg canonical).
--
-- RLS posture: anon + authenticated may SELECT all rows. No INSERT / UPDATE
-- / DELETE policies are defined — mirrors the audit_logs default-deny
-- pattern. Hostnames are NOT sensitive: they are emitted into the
-- server-rendered CSP `frame-src` header of every page anyway, so anon
-- read access does not leak any production secret.

create table public.iframe_allowlist (
  id                  uuid        primary key default gen_random_uuid(),
  hostname            text        not null unique,
  added_by_user_id    uuid        references auth.users(id) on delete set null,
  added_at            timestamptz not null default now(),
  last_used_at        timestamptz
);

create index iframe_allowlist_hostname_idx
  on public.iframe_allowlist (hostname);

alter table public.iframe_allowlist enable row level security;

-- Public-SELECT policy — required by the Plan 41-03 Vercel Edge Middleware
-- which fetches via PostgREST with the anon key. Hostnames are not secret
-- (they appear in served HTML CSP headers).
create policy "iframe_allowlist_select_public"
  on public.iframe_allowlist
  for select
  to anon, authenticated
  using (true);

-- NOTE: no INSERT / UPDATE / DELETE policies. All writes MUST flow through
-- the SECDEF RPCs in the sibling migration. RLS-default-deny + missing
-- write policies = effectively impossible for any role to mutate this
-- table outside the SECDEF call path.

comment on table public.iframe_allowlist is
  'Phase 41 / D-14 / D-17 / EMBED-07 — Custom-iframe per-deployment hostname allowlist. Writes flow only via SECDEF RPCs add_iframe_allowlist_hostname / remove_iframe_allowlist_hostname.';
