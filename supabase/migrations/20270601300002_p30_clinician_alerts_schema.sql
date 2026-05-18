-- Phase 30 Plan 00 — Task 1 (migration 2/5)
-- Creates 3 new org-scoped tables + clinic_matview_refresh_log.
-- Per CONTEXT D-08, D-09, D-11, D-14 + 28-EXTENSION-CONTRACT R1-R5.
--
-- Tables:
--   clinician_alerts            — alert status-machine table; debounce UNIQUE
--   clinician_alert_deliveries  — append-only delivery log
--   org_patient_thresholds      — per-patient threshold overrides
--   clinic_matview_refresh_log  — tracks last matview refresh (avoids now() in matview SELECT)
--
-- RLS: all 4 tables have RLS forced.
-- Role check: 'admin' and 'staff' (NOT 'clinician' — enum is 'admin','staff','viewer').
-- FK pattern: org_id references organizations(id) ON DELETE RESTRICT per EXTENSION-CONTRACT R3.
-- NO INSERT/UPDATE/DELETE policies for authenticated on clinician_alerts /
--   clinician_alert_deliveries / org_patient_thresholds — all writes go through SECDEFs.

begin;

-- =============================================================================
-- 1. clinician_alerts — per D-09
-- =============================================================================
create table if not exists public.clinician_alerts (
  id                uuid        not null primary key default gen_random_uuid(),
  org_id            uuid        not null references public.organizations(id) on delete restrict,
  patient_user_id   uuid        not null references auth.users(id) on delete restrict,
  alert_type        text        not null check (alert_type in ('dose_adherence', 'dose_variance')),
  severity          smallint    not null default 1 check (severity in (1, 2, 3)),
  status            text        not null default 'pending'
                                check (status in ('pending', 'acknowledged', 'snoozed', 'auto_resolved', 'delivery_failed')),
  threshold_snapshot jsonb      not null,
  ack_by            uuid        null references auth.users(id) on delete set null,
  ack_at            timestamptz null,
  snooze_until      timestamptz null,
  retry_count       smallint    not null default 0,
  last_attempt_at   timestamptz null,
  debounce_key      text        not null,
  created_at        timestamptz not null default now(),
  auto_resolved_at  timestamptz null
);

-- Org index for fast per-org queries
create index if not exists clinician_alerts_org_id_idx
  on public.clinician_alerts (org_id);

-- Partial index for pending alert queries (only pending rows indexed)
create index if not exists clinician_alerts_pending_idx
  on public.clinician_alerts (org_id, created_at desc)
  where status = 'pending';

-- UNIQUE debounce constraint per D-11:
-- debounce_key shape: {alert_type}:{patient_user_id}:{YYYY-MM-DD}
-- Combined with org_id ensures same-day same-type same-patient dedup at DB level.
create unique index if not exists clinician_alerts_debounce_uq
  on public.clinician_alerts (org_id, debounce_key);

-- RLS
alter table public.clinician_alerts enable row level security;
alter table public.clinician_alerts force row level security;

-- SELECT: org members with role 'admin' or 'staff' can read their org's alerts
create policy "clinician_alerts_select"
  on public.clinician_alerts
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = clinician_alerts.org_id
        and om.user_id = auth.uid()
        and om.role in ('admin', 'staff')
    )
  );

-- NO INSERT/UPDATE/DELETE policies for authenticated role
-- All writes go through SECDEFs (T-30-00-01 mitigation)

-- =============================================================================
-- 2. clinician_alert_deliveries — per D-14 (append-only)
-- =============================================================================
create table if not exists public.clinician_alert_deliveries (
  id           uuid        not null primary key default gen_random_uuid(),
  alert_id     uuid        not null references public.clinician_alerts(id) on delete cascade,
  channel      text        not null check (channel in ('realtime', 'email')),
  attempted_at timestamptz not null default now(),
  success      boolean     not null,
  error        text        null
);

-- Index for per-alert delivery history queries
create index if not exists clinician_alert_deliveries_alert_idx
  on public.clinician_alert_deliveries (alert_id, attempted_at desc);

-- RLS
alter table public.clinician_alert_deliveries enable row level security;
alter table public.clinician_alert_deliveries force row level security;

-- SELECT: org members with role 'admin' or 'staff' can read delivery log
-- Requires a JOIN to clinician_alerts to verify org membership.
create policy "clinician_alert_deliveries_select"
  on public.clinician_alert_deliveries
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.clinician_alerts ca
      join public.org_members om
        on om.org_id = ca.org_id
       and om.user_id = auth.uid()
       and om.role in ('admin', 'staff')
      where ca.id = clinician_alert_deliveries.alert_id
    )
  );

-- NO INSERT/UPDATE/DELETE policies for authenticated role
-- INSERT only via service_role (deliver-cron Edge Fn + detect-cron pg_cron)

-- =============================================================================
-- 3. org_patient_thresholds — per D-08
--    Composite PK (org_id, patient_user_id). FK to org_patient_links for link-before-override.
--
--    [Rule 1 auto-fix] org_patient_links has id uuid PK (no composite unique constraint).
--    Add a UNIQUE constraint on org_patient_links(org_id, patient_user_id) so we can
--    reference it from org_patient_thresholds. This also enforces that a patient cannot
--    be linked to the same org twice (correctness invariant for the table).
-- =============================================================================

-- Add UNIQUE constraint to org_patient_links so the composite FK reference works.
-- Uses IF NOT EXISTS-equivalent pattern: create index concurrently doesn't exist for
-- constraints, but ADD CONSTRAINT is idempotent if we check first.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.org_patient_links'::regclass
      and contype = 'u'
      and conname = 'org_patient_links_org_patient_uq'
  ) then
    alter table public.org_patient_links
      add constraint org_patient_links_org_patient_uq
      unique (org_id, patient_user_id);
  end if;
end $$;

create table if not exists public.org_patient_thresholds (
  org_id          uuid        not null references public.organizations(id) on delete restrict,
  patient_user_id uuid        not null,
  thresholds      jsonb       not null,
  set_by          uuid        null references auth.users(id) on delete set null,
  set_at          timestamptz not null default now(),
  primary key (org_id, patient_user_id)
);

-- FK to org_patient_links: enforces that a link must exist before an override can be set.
-- Now valid because org_patient_links_org_patient_uq covers (org_id, patient_user_id).
alter table public.org_patient_thresholds
  add constraint org_patient_thresholds_link_fk
  foreign key (org_id, patient_user_id)
  references public.org_patient_links(org_id, patient_user_id)
  on delete cascade;

-- RLS
alter table public.org_patient_thresholds enable row level security;
alter table public.org_patient_thresholds force row level security;

-- SELECT: org members with role 'admin' or 'staff' can read per-patient thresholds
create policy "org_patient_thresholds_select"
  on public.org_patient_thresholds
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = org_patient_thresholds.org_id
        and om.user_id = auth.uid()
        and om.role in ('admin', 'staff')
    )
  );

-- NO INSERT/UPDATE/DELETE policies for authenticated role
-- All writes go through SECDEF set_patient_dose_thresholds

-- =============================================================================
-- 4. clinic_matview_refresh_log — tracks last refresh timestamp per matview.
--    Avoids now() inside matview SELECT (Pitfall 1 in RESEARCH.md).
-- =============================================================================
create table if not exists public.clinic_matview_refresh_log (
  view_name    text        not null primary key,
  refreshed_at timestamptz not null default now()
);

-- RLS
alter table public.clinic_matview_refresh_log enable row level security;
alter table public.clinic_matview_refresh_log force row level security;

-- SELECT: any authenticated user can read refresh timestamps (not sensitive)
create policy "clinic_matview_refresh_log_select"
  on public.clinic_matview_refresh_log
  for select
  to authenticated
  using (true);

-- NO INSERT/UPDATE/DELETE policies for authenticated role
-- Written only by the matview-refresh cron (service_role)

commit;
