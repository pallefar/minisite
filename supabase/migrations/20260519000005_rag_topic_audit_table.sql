-- Phase 50: rag_topic_audit — append-only audit trail for rag_topics CRUD per D-14
--
-- Captures before/after JSONB snapshots on every INSERT/UPDATE/DELETE of
-- public.rag_topics. Trigger function respects the `app.suppress_audit` GUC so
-- bulk maintenance ops can opt out (per [[reference_supabase_migration_gotchas]]).
--
-- Idempotent.

-- ---------------------------------------------------------------------------
-- Audit table
-- ---------------------------------------------------------------------------

create table if not exists public.rag_topic_audit (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.rag_topics(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  action text not null check (action in ('create', 'update', 'delete', 'restore')),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists rag_topic_audit_topic_idx
  on public.rag_topic_audit (topic_id, created_at desc);

alter table public.rag_topic_audit enable row level security;

-- ---------------------------------------------------------------------------
-- Trigger function: writes audit rows; respects app.suppress_audit GUC
-- ---------------------------------------------------------------------------

create or replace function public.fn_rag_topic_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
begin
  -- Allow bulk migrations / maintenance to suppress audit writes
  if current_setting('app.suppress_audit', true) = 'on' then
    return coalesce(new, old);
  end if;

  insert into public.rag_topic_audit (
    topic_id,
    actor_user_id,
    action,
    before_data,
    after_data
  ) values (
    coalesce(new.id, old.id),
    auth.uid(),
    case tg_op
      when 'INSERT' then 'create'
      when 'UPDATE' then (
        case
          when new.deleted_at is not null and old.deleted_at is null then 'delete'
          when new.deleted_at is null and old.deleted_at is not null then 'restore'
          else 'update'
        end
      )
      when 'DELETE' then 'delete'
    end,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  return coalesce(new, old);
end
$$;

-- ---------------------------------------------------------------------------
-- Attach trigger to rag_topics
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_rag_topic_audit'
  ) then
    create trigger trg_rag_topic_audit
      after insert or update or delete on public.rag_topics
      for each row execute function public.fn_rag_topic_audit_trigger();
  end if;
end $$;
