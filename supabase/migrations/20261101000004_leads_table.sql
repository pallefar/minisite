-- Phase 15 Plan 01 — `public.leads` table.
--
-- Lead capture (D-12): native form/opt-in block POSTs to `lead-capture` Edge
-- Function (Plan 15-07) → writes to this table. Only service_role can
-- INSERT (Edge Function uses the service-role key); only is_staff users can
-- SELECT (Phase 15 staff dashboard). Public reads forbidden — PII (email).
--
-- ip_hash (T-15-01-08): SHA-256 of client IP, computed by the lead-capture
-- Edge Function. Not the raw IP. Used for rate-limit + spam analytics only.
--
-- Separate file so leads can ship even if page-builder rolls back. The
-- `page_id` FK is ON DELETE SET NULL so deleting a page doesn't wipe its
-- lead history (audit trail preserved).
--
-- RLS policies created in migration 07 (page_builder_rls).

create table public.leads (
  id                uuid primary key default gen_random_uuid(),
  page_id           uuid references public.landing_pages(id) on delete set null,
  email             text not null,
  name              text,
  extra_fields      jsonb not null default '{}'::jsonb,
  ip_hash           text,                                  -- SHA-256 of client IP; PII-safe
  honeypot_flagged  boolean not null default false,
  created_at        timestamptz not null default now()
);

-- Index for per-page lead listing in the staff dashboard.
create index idx_leads_page_created_desc
  on public.leads(page_id, created_at desc)
  where page_id is not null;

-- Index for global lead chronology in the staff dashboard.
create index idx_leads_created_desc on public.leads(created_at desc);
