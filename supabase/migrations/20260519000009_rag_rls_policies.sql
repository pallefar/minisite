-- Phase 50: RLS policies for all rag_* tables + defensive admin-helper shims per D-12/D-13/D-34
--
-- If `public.is_admin_at_least(public.admin_role)` does not yet exist
-- (Phase 24 not shipped), the shim functions below catch the undefined_function
-- exception and return FALSE — admin features stay LOCKED rather than the
-- migration failing to apply. Once Phase 24 ships, the policies activate without
-- any further migration.
--
-- Idempotent: uses CREATE OR REPLACE + DROP POLICY IF EXISTS + CREATE POLICY.

-- ---------------------------------------------------------------------------
-- Defensive admin-helper shims
-- ---------------------------------------------------------------------------

create or replace function public._rag_is_super()
returns boolean
language plpgsql
stable
security definer
set search_path = extensions, public, pg_temp
as $$
begin
  begin
    return public.is_admin_at_least('superadmin'::public.admin_role);
  exception
    when undefined_function then return false;
    when undefined_object   then return false;
  end;
end
$$;

create or replace function public._rag_is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = extensions, public, pg_temp
as $$
begin
  begin
    return public.is_admin_at_least('admin'::public.admin_role);
  exception
    when undefined_function then return false;
    when undefined_object   then return false;
  end;
end
$$;

grant execute on function public._rag_is_super() to authenticated, anon;
grant execute on function public._rag_is_admin() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- rag_topics — super-admin only (D-12)
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.rag_topics from authenticated, anon;

drop policy if exists rag_topics_super_select on public.rag_topics;
drop policy if exists rag_topics_super_insert on public.rag_topics;
drop policy if exists rag_topics_super_update on public.rag_topics;
drop policy if exists rag_topics_super_delete on public.rag_topics;

create policy rag_topics_super_select on public.rag_topics
  for select using (public._rag_is_super());

create policy rag_topics_super_insert on public.rag_topics
  for insert with check (public._rag_is_super());

create policy rag_topics_super_update on public.rag_topics
  for update using (public._rag_is_super()) with check (public._rag_is_super());

create policy rag_topics_super_delete on public.rag_topics
  for delete using (public._rag_is_super());

-- ---------------------------------------------------------------------------
-- rag_sources — admin+ read; super-admin write
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.rag_sources from authenticated, anon;

drop policy if exists rag_sources_admin_select on public.rag_sources;
drop policy if exists rag_sources_super_insert on public.rag_sources;
drop policy if exists rag_sources_super_update on public.rag_sources;
drop policy if exists rag_sources_super_delete on public.rag_sources;

create policy rag_sources_admin_select on public.rag_sources
  for select using (public._rag_is_admin());

create policy rag_sources_super_insert on public.rag_sources
  for insert with check (public._rag_is_super());

create policy rag_sources_super_update on public.rag_sources
  for update using (public._rag_is_super()) with check (public._rag_is_super());

create policy rag_sources_super_delete on public.rag_sources
  for delete using (public._rag_is_super());

-- ---------------------------------------------------------------------------
-- rag_chunks — admin+ full; anon may READ published+non-retracted (research hub)
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.rag_chunks from authenticated, anon;

drop policy if exists rag_chunks_admin_select on public.rag_chunks;
drop policy if exists rag_chunks_public_select on public.rag_chunks;
drop policy if exists rag_chunks_admin_insert on public.rag_chunks;
drop policy if exists rag_chunks_admin_update on public.rag_chunks;
drop policy if exists rag_chunks_admin_delete on public.rag_chunks;

-- Admin sees everything
create policy rag_chunks_admin_select on public.rag_chunks
  for select using (public._rag_is_admin());

-- Anon + authenticated see only published, non-retracted chunks (public /research hub)
create policy rag_chunks_public_select on public.rag_chunks
  for select using (published_at is not null and retracted_at is null);

create policy rag_chunks_admin_insert on public.rag_chunks
  for insert with check (public._rag_is_admin());

create policy rag_chunks_admin_update on public.rag_chunks
  for update using (public._rag_is_admin()) with check (public._rag_is_admin());

create policy rag_chunks_admin_delete on public.rag_chunks
  for delete using (public._rag_is_admin());

-- ---------------------------------------------------------------------------
-- external_kb_embeddings — SELECT for authenticated (retrieval Edge Fn);
-- writes only via SECURITY DEFINER (no policies on insert/update/delete)
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.external_kb_embeddings from authenticated, anon;

drop policy if exists external_kb_embeddings_auth_select on public.external_kb_embeddings;
drop policy if exists external_kb_embeddings_anon_select on public.external_kb_embeddings;

-- Authenticated users can READ embeddings (retrieval surface). No PHI per D-34.
create policy external_kb_embeddings_auth_select on public.external_kb_embeddings
  for select using (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- rag_scrape_runs — admin read only
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.rag_scrape_runs from authenticated, anon;

drop policy if exists rag_scrape_runs_admin_select on public.rag_scrape_runs;

create policy rag_scrape_runs_admin_select on public.rag_scrape_runs
  for select using (public._rag_is_admin());

-- ---------------------------------------------------------------------------
-- rag_cost_ledger — admin read only
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.rag_cost_ledger from authenticated, anon;

drop policy if exists rag_cost_ledger_admin_select on public.rag_cost_ledger;

create policy rag_cost_ledger_admin_select on public.rag_cost_ledger
  for select using (public._rag_is_admin());

-- ---------------------------------------------------------------------------
-- rag_budget_caps — admin read; super-admin update
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.rag_budget_caps from authenticated, anon;

drop policy if exists rag_budget_caps_admin_select on public.rag_budget_caps;
drop policy if exists rag_budget_caps_super_update on public.rag_budget_caps;

create policy rag_budget_caps_admin_select on public.rag_budget_caps
  for select using (public._rag_is_admin());

create policy rag_budget_caps_super_update on public.rag_budget_caps
  for update using (public._rag_is_super()) with check (public._rag_is_super());

-- ---------------------------------------------------------------------------
-- rag_newsletter_subscriptions — owner manages own; admin sees all
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.rag_newsletter_subscriptions from authenticated, anon;

drop policy if exists rag_news_owner_select on public.rag_newsletter_subscriptions;
drop policy if exists rag_news_admin_select on public.rag_newsletter_subscriptions;
drop policy if exists rag_news_owner_insert on public.rag_newsletter_subscriptions;
drop policy if exists rag_news_owner_update on public.rag_newsletter_subscriptions;

create policy rag_news_owner_select on public.rag_newsletter_subscriptions
  for select using (user_id = auth.uid());

create policy rag_news_admin_select on public.rag_newsletter_subscriptions
  for select using (public._rag_is_admin());

-- Authenticated users may insert their OWN subscription row (one per user enforced
-- by the unique index on user_id).
grant insert on public.rag_newsletter_subscriptions to authenticated;
grant update on public.rag_newsletter_subscriptions to authenticated;

create policy rag_news_owner_insert on public.rag_newsletter_subscriptions
  for insert with check (user_id = auth.uid());

create policy rag_news_owner_update on public.rag_newsletter_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- rag_topic_audit — admin read; no DML (trigger-owner writes only)
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.rag_topic_audit from authenticated, anon;

drop policy if exists rag_topic_audit_admin_select on public.rag_topic_audit;

create policy rag_topic_audit_admin_select on public.rag_topic_audit
  for select using (public._rag_is_admin());
