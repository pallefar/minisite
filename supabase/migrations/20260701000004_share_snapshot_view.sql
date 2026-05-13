-- Phase 8 Plan 08-01 — public.share_snapshot_view (SC#3 structural exclusion).
--
-- The "AI conversation history is never included" guarantee from SC#3 is
-- enforced HERE, at the schema layer, by the absence of a join to the
-- AI conversation log table (created in an earlier phase; intentionally
-- unnamed here so the structural-exclusion grep gate passes on this
-- migration too). A reviewer can grep the migration source and verify the
-- forbidden identifier returns ZERO matches. The Task 2 verify command in
-- 08-01-PLAN.md performs exactly this check.
--
-- View shape: one row per auth.users user, each entity surface aggregated
-- as a jsonb array via correlated subquery + jsonb_agg. This keeps the
-- Edge Function snapshot handler trivial — a single SELECT returns the
-- whole snapshot tuple, no per-table fan-out at the application layer.
--
-- Tables joined (Phase 5 + Phase 6 sync surface; ALL singular table names,
-- confirmed from migration files):
--   public.injections  (Phase 5)
--   public.weights     (Phase 6)
--   public.meals       (Phase 6)
--   public.workouts    (Phase 6)
--   public.supplements (Phase 6)
--   public.mood        (Phase 6, singular)
--   public.sleep       (Phase 6, singular)
--   public.symptoms    (Phase 6)
--   public.vials       (Phase 6)
--   public.settings    (Phase 6)
--   public.photos      (Phase 6)
--
-- INTENTIONALLY OMITTED (SC#3 structural enforcement):
--   The AI conversation log table (created in an earlier phase) is NEVER
--   joined here and NEVER surfaced in the snapshot. This is the negative-
--   space contract: the absence of that table from the FROM/JOIN list IS
--   the enforcement. Do NOT add it; doing so breaks the SC#3 guarantee.
--   The Edge Function (Plan 08-02) reads from this view (service_role
--   bypass) and serializes each column into SnapshotResponse — there is no
--   path that could re-introduce that table without also editing this
--   migration. The Task 2 verify command grep-counts the forbidden
--   identifier in this file and fails the build if it ever appears.
--
-- Grants: service_role only. The view is server-internal; the Edge Function
-- is the sole reader. Authenticated callers cannot SELECT from it directly
-- (no GRANT to authenticated; default-deny applies via Supabase API exposure
-- rules and the no-grant stance here).

create or replace view public.share_snapshot_view as
select
  u.id as user_id,

  -- Patient display name. Reads from auth.users.raw_user_meta_data (Phase 5
  -- onboarding writes first_name here). Coalesces to empty string so the
  -- view never returns SQL NULL for the name column — the Edge Function
  -- can render an empty patient_first_name field cleanly.
  coalesce(u.raw_user_meta_data->>'first_name', '') as patient_first_name,

  -- Per-entity arrays. Each subquery is a SELECT-only read against the
  -- corresponding sync table, scoped by user_id; service_role bypass means
  -- RLS doesn't apply, but the user_id filter in the subquery is the
  -- correct boundary.
  (select coalesce(jsonb_agg(row_to_json(i.*)), '[]'::jsonb)
     from public.injections i where i.user_id = u.id) as injections,

  (select coalesce(jsonb_agg(row_to_json(w.*)), '[]'::jsonb)
     from public.weights w where w.user_id = u.id) as weights,

  (select coalesce(jsonb_agg(row_to_json(m.*)), '[]'::jsonb)
     from public.meals m where m.user_id = u.id) as meals,

  (select coalesce(jsonb_agg(row_to_json(wk.*)), '[]'::jsonb)
     from public.workouts wk where wk.user_id = u.id) as workouts,

  (select coalesce(jsonb_agg(row_to_json(s.*)), '[]'::jsonb)
     from public.supplements s where s.user_id = u.id) as supplements,

  (select coalesce(jsonb_agg(row_to_json(mo.*)), '[]'::jsonb)
     from public.mood mo where mo.user_id = u.id) as mood,

  (select coalesce(jsonb_agg(row_to_json(sl.*)), '[]'::jsonb)
     from public.sleep sl where sl.user_id = u.id) as sleep,

  (select coalesce(jsonb_agg(row_to_json(sy.*)), '[]'::jsonb)
     from public.symptoms sy where sy.user_id = u.id) as symptoms,

  (select coalesce(jsonb_agg(row_to_json(v.*)), '[]'::jsonb)
     from public.vials v where v.user_id = u.id) as vials,

  (select coalesce(jsonb_agg(row_to_json(st.*)), '[]'::jsonb)
     from public.settings st where st.user_id = u.id) as settings,

  -- photos.storage_path is the bucket path; the Edge Function MINTS a
  -- short-lived signed URL per row at request time (per 06-04 pattern).
  -- That happens in Plan 08-02's snapshot handler, not in this view —
  -- view definitions cannot call privileged storage functions, and signed
  -- URLs are time-bound so caching them inside a view is wrong.
  (select coalesce(jsonb_agg(row_to_json(p.*)), '[]'::jsonb)
     from public.photos p where p.user_id = u.id) as photos

from auth.users u;

-- Service-role-only access. The Edge Function is the sole reader; authenticated
-- callers MUST NOT be able to SELECT from this view (no grant + default-deny).
revoke all on public.share_snapshot_view from public;
grant select on public.share_snapshot_view to service_role;
