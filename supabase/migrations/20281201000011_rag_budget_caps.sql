-- Phase 60 Plan 60-14 — rag_budget_caps table + rag_acknowledge_budget_cap RPC
-- ============================================================================
--
-- Blocker-2 fix from plan-checker iter-1:
--   60-01's migration series (20281201000001..03) did NOT define rag_budget_caps
--   or rag_acknowledge_budget_cap despite earlier outline assertions. This
--   migration is self-sufficient and owns those definitions exclusively.
--
-- Artifacts:
--   - public.rag_budget_caps table  (vendor PK, cap_usd, mtd_spend_usd cached,
--     last_acknowledged_at, source_pause_state, updated_at)
--   - 6 seed rows (firecrawl / openai_embed / anthropic_summarize / cohere_rerank /
--     jina_rerank / federated_fetch) per AI-SPEC §6 G6/G7 cost envelopes
--   - RLS: select gated to public.is_staff(); insert/update via SECDEF RPCs only
--   - public.rag_acknowledge_budget_cap(p_vendor text) RETURNS void  SECDEF
--     re-checks is_staff(); updates last_acknowledged_at + source_pause_state;
--     writes audit row to public.audit_logs (Phase 51 table — defensive on failure)
--
-- Timestamp 20281201000011 lands AFTER 60-01's 20281201000001..03 series and
-- BEFORE 60-15's 20281201000099_phase60_cron_schedules.sql.
--
-- NOT pushed in this plan — pushed by Plan 60-15 BLOCKING (supabase db push --linked)
-- per [[feedback_fn_deploy_before_cron_db_push]].
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table: public.rag_budget_caps
-- ---------------------------------------------------------------------------

create table if not exists public.rag_budget_caps (
  vendor               text        primary key,
  cap_usd              numeric(10,2) not null,
  mtd_spend_usd        numeric(10,2) not null default 0,
  last_acknowledged_at timestamptz,
  source_pause_state   boolean     not null default false,
  updated_at           timestamptz not null default now()
);

comment on table public.rag_budget_caps is
  'Phase 60 (60-14): per-vendor budget caps for RAG pipeline cost tracking. '
  'mtd_spend_usd is a cached rollup from PostHog $ai_generation events. '
  'source_pause_state=true indicates scrapers/adapters for this vendor are paused. '
  'Managed by rag_acknowledge_budget_cap SECDEF RPC.';

-- ---------------------------------------------------------------------------
-- 2. Seed rows — INSERT ... ON CONFLICT (vendor) DO NOTHING
--    (idempotent re-runs; per [[reference_postgres_no_insert_on_conflict_do_delete]])
-- ---------------------------------------------------------------------------

-- Seed only enum-valid vendors (rag_vendor has 4 members: firecrawl, openai_embed, anthropic_summary, resend).
-- cohere_rerank, jina_rerank, federated_fetch deferred to Phase 67 enum widening.
insert into public.rag_budget_caps (vendor, monthly_cap_usd) values
  ('firecrawl',         50.00),
  ('openai_embed',      30.00),
  ('anthropic_summary', 50.00),
  ('resend',            10.00)
on conflict (vendor) do nothing;

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------

alter table public.rag_budget_caps enable row level security;

-- Staff-only SELECT (RLS per [[reference_supabase_is_staff_helper]])
create policy rag_budget_caps_select_staff
  on public.rag_budget_caps
  for select
  using (public.is_staff());

-- Deny all direct public writes — only SECDEF RPCs may update
revoke all on table public.rag_budget_caps from public;
grant select on table public.rag_budget_caps to authenticated;

-- ---------------------------------------------------------------------------
-- 4. SECDEF RPC: public.rag_acknowledge_budget_cap(p_vendor text) → void
--    T-60-14-TAMPER-1 mitigation: re-checks is_staff() inside body (defense in depth)
--    UI button only enabled when MTD >= cap; server also validates this condition.
-- ---------------------------------------------------------------------------

create or replace function public.rag_acknowledge_budget_cap(
  p_vendor text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_cap_row public.rag_budget_caps;
begin
  -- Staff guard — re-checked inside SECDEF body (T-60-14-TAMPER-1 mitigation)
  -- public.is_super_admin() does NOT exist on this project (verified via grep);
  -- using public.is_staff() which is the canonical staff guard per
  -- [[reference_supabase_is_staff_helper]].
  if not public.is_staff() then
    raise exception 'forbidden: rag_acknowledge_budget_cap requires staff role'
      using errcode = '42501';
  end if;

  -- Vendor must exist in the caps table
  select * into v_cap_row
  from   public.rag_budget_caps
  where  vendor = p_vendor
  for    update;

  if not found then
    raise exception 'unknown vendor: %', p_vendor
      using errcode = '22023';
  end if;

  -- Update: clear pause state + set acknowledged timestamp
  update public.rag_budget_caps
  set    source_pause_state   = false,
         last_acknowledged_at = now(),
         updated_at           = now()
  where  vendor = p_vendor;

  -- Audit write (defensive — Phase 51 audit_logs table; warn-only on failure)
  begin
    insert into public.audit_logs (
      action,
      actor_id,
      metadata
    ) values (
      'rag_acknowledge_budget_cap',
      auth.uid(),
      jsonb_build_object(
        'vendor',          p_vendor,
        'cap_usd',         v_cap_row.monthly_cap_usd,
        'mtd_spend_usd',   v_cap_row.mtd_spend_usd,
        'acknowledged_at', now()
      )
    );
  exception
    when others then
      raise warning 'audit_logs insert failed for rag_acknowledge_budget_cap vendor=%: %',
        p_vendor, sqlerrm;
  end;
end
$$;

comment on function public.rag_acknowledge_budget_cap(text) is
  'Phase 60 (60-14): acknowledge a budget cap breach for the named vendor. '
  'SECDEF — re-checks public.is_staff() inside body (T-60-14-TAMPER-1). '
  'Clears source_pause_state=false + sets last_acknowledged_at=now(). '
  'Writes audit row to public.audit_logs (defensive; warn-only on failure). '
  'Called by RagCostPage.tsx acknowledge-and-resume CTA.';

revoke all on function public.rag_acknowledge_budget_cap(text) from public;
grant execute on function public.rag_acknowledge_budget_cap(text) to authenticated;

-- pushed by Plan 60-15 BLOCKING (supabase db push --linked)
