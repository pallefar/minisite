-- Phase 15 Plan 01 — Append-only enforcement on landing_page_revisions
-- via BEFORE UPDATE / BEFORE DELETE triggers.
--
-- D-07 / PAGE-07: revisions are append-only. The RLS policy matrix in
-- migration 07 already denies UPDATE / DELETE for every role (no policy
-- exists), but service_role bypasses RLS. The triggers below provide
-- defence-in-depth: even a service_role caller (or a forgotten migration
-- that grants UPDATE elsewhere) cannot mutate or directly delete a revision.
--
-- Cascade-distinction choice (CHOICE: `pg_trigger_depth()` > 0):
-- We use `pg_trigger_depth()` rather than a `set local
-- app.allow_revision_cascade = 'true'` GUC. Rationale:
--   * `pg_trigger_depth()` is automatic — no caller has to remember to set
--     a GUC before deleting a landing_pages row. Deleting a page cascades
--     to its revisions via the FK ON DELETE CASCADE in migration 02; that
--     cascade runs inside a parent trigger, so trigger depth > 0.
--   * The GUC approach requires every legitimate caller (RPCs, future
--     account-deletion functions) to remember the bypass. Easy to forget.
--   * The `pg_trigger_depth()` approach is what Postgres itself recommends
--     for "allow cascade, deny direct" semantics.
-- Threat: a hypothetical attacker would need to trigger the delete from
-- within ANOTHER trigger, which would itself be an EoP. Acceptable.

-- ----------------------------------------------------------------------------
-- 1. Block UPDATE — every role, no exceptions.
-- ----------------------------------------------------------------------------
create or replace function public.block_landing_page_revisions_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'landing_page_revisions is append-only (phase 15 D-07)'
    using errcode = 'P0001';
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'landing_page_revisions_block_update'
  ) then
    create trigger landing_page_revisions_block_update
      before update on public.landing_page_revisions
      for each row execute function public.block_landing_page_revisions_update();
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Block direct DELETE — allow cascade from landing_pages parent.
--    Cascade detected via pg_trigger_depth() > 0: when the user runs
--    `DELETE FROM landing_pages WHERE id = ?`, Postgres fires the cascade
--    delete on landing_page_revisions internally; that nested fire has
--    pg_trigger_depth() = 1. A user-driven `DELETE FROM landing_page_revisions
--    WHERE id = ?` has pg_trigger_depth() = 0 and is rejected.
-- ----------------------------------------------------------------------------
create or replace function public.block_landing_page_revisions_delete()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 then
    -- Cascaded delete from landing_pages (or further-nested context). Allow.
    return old;
  end if;
  raise exception 'landing_page_revisions is append-only — direct DELETE forbidden (phase 15 D-07)'
    using errcode = 'P0001';
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'landing_page_revisions_block_delete'
  ) then
    create trigger landing_page_revisions_block_delete
      before delete on public.landing_page_revisions
      for each row execute function public.block_landing_page_revisions_delete();
  end if;
end $$;
