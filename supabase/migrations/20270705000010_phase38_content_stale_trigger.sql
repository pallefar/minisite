-- Phase 38 Plan 01 — content_stale_on_update trigger (D-18, T-38-03).
--
-- AFTER UPDATE trigger on public.content: flips content_embeddings.stale=true
-- when title or body_md changes — forces re-embed by Plan 38-04 cron worker.
--
-- SECURITY DEFINER + explicit `search_path = public, extensions` per
-- memory `reference_supabase_migration_gotchas` (T-38-03 mitigation).

create or replace function public.tg_content_mark_embedding_stale()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $fn$
begin
  if new.body_md is distinct from old.body_md
     or new.title is distinct from old.title then
    update public.content_embeddings
       set stale = true
     where content_id = new.id;
  end if;
  return new;
end;
$fn$;

revoke all on function public.tg_content_mark_embedding_stale() from public;

-- Idempotent trigger creation.
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'content_stale_on_update'
      and tgrelid = 'public.content'::regclass
  ) then
    create trigger content_stale_on_update
      after update on public.content
      for each row
      execute function public.tg_content_mark_embedding_stale();
  end if;
end $$;

comment on function public.tg_content_mark_embedding_stale() is
  'Phase 38 — flips content_embeddings.stale=true when content.body_md or content.title changes (D-18).';
