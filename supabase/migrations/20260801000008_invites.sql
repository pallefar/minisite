-- Phase 9 Plan 09-01 — invites table.
--
-- D-01: custom invites table with hashed token. The raw token is sent
-- ONLY in the email URL; the DB stores `invite_token_hash` (sha256). On
-- accept/reject the Edge Function (Plan 09-06) hashes the URL token and
-- looks the row up by hash. This mirrors the Phase 8 D-03 share-token
-- pattern verbatim — same risk surface, same review.
--
-- D-02 anti-enumeration: send_invite (RPC in 20260801000011) never
-- branches on auth.users existence — it always inserts the invite and
-- always returns 200 to the operator UI. The auth.users lookup happens
-- at acceptance time inside the Edge Function (State C/D branch).
--
-- D-17: 7-day expiry. send_invite sets expires_at = now() + 7 days. The
-- partial index on active invites (NOT-yet-accepted, NOT-yet-rejected)
-- uses ONLY column IS NULL predicates per Pitfall #5 — no now() in the
-- predicate (would break IMMUTABLE).
--
-- D-18: consent_scope_at_acceptance is FROZEN at acceptance time. The
-- accept_invite_* RPCs write this column once and never again. It is the
-- audit trail of what the patient consented to AT acceptance (the
-- mutable consent_scope lives on memberships).
--
-- RLS contract: SELECT gated by has_permission(uid, org_id,
-- 'members.list') — same gate as memberships SELECT-by-org. NO writes —
-- only RPCs. The token hash is column-level visible to anyone who passes
-- the row-level gate (operator with members.list); since the operator is
-- the one who created the invite, this is acceptable. The raw token is
-- NEVER stored.

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (length(email) between 3 and 254),
  org_id uuid not null references public.orgs(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete set null,
  invite_token_hash text not null,
  -- Operator-suggested defaults for the consent dialog (jsonb of 10 booleans).
  requested_scope jsonb not null default '{}'::jsonb,
  -- Frozen-at-acceptance snapshot (D-18). Null until accepted.
  consent_scope_at_acceptance jsonb,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  rejected_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  -- Mutually exclusive: an invite is either accepted or rejected, not both.
  check ((accepted_at is null) or (rejected_at is null))
);

-- Token-hash uniqueness — needed for the accept-by-hash lookup.
create unique index if not exists invites_token_hash_idx
  on public.invites (invite_token_hash);

-- Active invites per org (Pitfall #5 — IMMUTABLE-safe; no now() in predicate).
-- Active = not yet accepted AND not yet rejected. The "not expired" check
-- happens in the query WHERE clause, NOT in the index predicate.
create index if not exists invites_org_active_idx
  on public.invites (org_id, expires_at)
  where accepted_at is null and rejected_at is null;

-- Per-email lookup (case-insensitive) for the accept flow + the operator's
-- "have we already invited this email?" check.
create index if not exists invites_email_idx
  on public.invites (lower(email));

-- Now that invites exists, attach the deferred FK from memberships (07).
alter table public.memberships
  add constraint memberships_invited_from_invite_id_fkey
  foreign key (invited_from_invite_id) references public.invites(id) on delete set null;

alter table public.invites enable row level security;

-- SELECT by any org member with `members.list` — operator's pending-invites list.
create policy invites_select_by_org_manager on public.invites
  for select to authenticated
  using (public.has_permission(auth.uid(), org_id, 'members.list'));

-- NO INSERT / UPDATE / DELETE — RPCs only.
