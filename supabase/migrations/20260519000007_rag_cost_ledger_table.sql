-- Phase 50: rag_cost_ledger + rag_budget_caps + rag_mtd_spend_by_vendor() per D-30
--
-- Captures every paid vendor call (firecrawl / openai_embed / anthropic_summary /
-- resend) so the admin cost dashboard can compute MTD spend and the auto-pause
-- worker (Plan 50-04) can pause runs when a vendor budget is breached.
--
-- D-30 default caps (USD/month):
--   firecrawl=200, openai_embed=50, anthropic_summary=300, resend=20
--
-- Idempotent.

-- ---------------------------------------------------------------------------
-- Vendor enum
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'rag_vendor' and typnamespace = 'public'::regnamespace
  ) then
    create type public.rag_vendor as enum (
      'firecrawl', 'openai_embed', 'anthropic_summary', 'resend'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Cost ledger
-- ---------------------------------------------------------------------------

create table if not exists public.rag_cost_ledger (
  id uuid primary key default gen_random_uuid(),
  vendor public.rag_vendor not null,
  ts timestamptz not null default now(),
  amount_usd numeric(10, 4) not null check (amount_usd >= 0),
  topic_id uuid references public.rag_topics(id) on delete set null,
  source_id uuid references public.rag_sources(id) on delete set null,
  action text not null,
  meta jsonb default '{}'::jsonb
);

create index if not exists rag_cost_ledger_vendor_ts_idx
  on public.rag_cost_ledger (vendor, ts desc);

create index if not exists rag_cost_ledger_topic_ts_idx
  on public.rag_cost_ledger (topic_id, ts desc);

alter table public.rag_cost_ledger enable row level security;

-- ---------------------------------------------------------------------------
-- Budget caps (admin-editable; super-admin updates only)
-- ---------------------------------------------------------------------------

create table if not exists public.rag_budget_caps (
  vendor public.rag_vendor primary key,
  monthly_cap_usd numeric(10, 2) not null,
  last_paused_at timestamptz,
  last_acknowledged_at timestamptz
);

alter table public.rag_budget_caps enable row level security;

insert into public.rag_budget_caps (vendor, monthly_cap_usd) values
  ('firecrawl',         200.00),
  ('openai_embed',       50.00),
  ('anthropic_summary', 300.00),
  ('resend',             20.00)
on conflict (vendor) do nothing;

-- ---------------------------------------------------------------------------
-- MTD aggregation: returns one row per vendor with month-to-date spend +
-- configured cap + percent-used (rounded to 2 dp).
-- ---------------------------------------------------------------------------

create or replace function public.rag_mtd_spend_by_vendor()
returns table (
  vendor public.rag_vendor,
  mtd_usd numeric,
  monthly_cap_usd numeric,
  pct_used numeric
)
language sql
stable
security definer
set search_path = extensions, public, pg_temp
as $$
  select
    bc.vendor,
    coalesce(
      sum(l.amount_usd) filter (where l.ts >= date_trunc('month', now())),
      0
    ) as mtd_usd,
    bc.monthly_cap_usd,
    round(
      (
        coalesce(
          sum(l.amount_usd) filter (where l.ts >= date_trunc('month', now())),
          0
        ) / nullif(bc.monthly_cap_usd, 0)
      ) * 100,
      2
    ) as pct_used
  from public.rag_budget_caps bc
  left join public.rag_cost_ledger l on l.vendor = bc.vendor
  group by bc.vendor, bc.monthly_cap_usd
$$;

grant execute on function public.rag_mtd_spend_by_vendor() to authenticated;
