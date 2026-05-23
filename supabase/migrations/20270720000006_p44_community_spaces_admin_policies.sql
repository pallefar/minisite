-- Phase 44 Plan 09: admin write policies on community_spaces.
-- Pinned to public.is_staff() per iter-2 BLOCKER-3 fix.
--
-- The is_staff() helper (20261101000006_is_staff_helper.sql) is a SECURITY DEFINER
-- function that reads profiles.is_staff column (boolean) and returns it.
-- This prevents privilege escalation via manipulating the execution context.
--
-- The canonical staff check is public.is_staff() — Fix-B pin (iter-2).
-- No raw table lookup; the SECDEF helper encapsulates the profiles.is_staff read.
--
-- DELETE intentionally omitted: spaces use soft-archive (Phase 45).
-- Hard delete is admin-console-only and not exposed via PostgREST.

alter table public.community_spaces enable row level security;

drop policy if exists cspace_insert_staff on public.community_spaces;
create policy cspace_insert_staff on public.community_spaces
  for insert
  to authenticated
  with check (public.is_staff());

drop policy if exists cspace_update_staff on public.community_spaces;
create policy cspace_update_staff on public.community_spaces
  for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());
