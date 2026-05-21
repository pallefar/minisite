-- ============================================================================
-- Phase 37 Plan 37-05 (HELP-05 / HELP-06) — CSAT idempotency anchor,
-- SLA-breach dedupe state, alert-recipient on-call list, and the
-- AFTER UPDATE trigger that fires `helpdesk-csat-send` on ticket close.
-- ============================================================================
--
-- This migration supports both halves of Plan 37-05:
--
--   • helpdesk-csat-send (HELP-05) — invoked by trg_helpdesk_on_ticket_close
--     when a ticket transitions to status='closed'. Idempotency is anchored
--     on tickets.csat_sent_at so re-runs (and the trigger re-firing on a
--     no-op UPDATE of status) never produce a duplicate user-visible email.
--
--   • helpdesk-sla-breach-cron (HELP-06) — invoked every 5 min by the pg_cron
--     schedule shipped in plan 37-02 (migration 20270707000007). Dedupes
--     per-ticket × per-breach_type via try_record_sla_breach() — an UPSERT
--     INSERT … ON CONFLICT … DO UPDATE pattern (per memory feedback
--     state_counter_table_needs_upsert_on_event: bare UPDATE no-ops on first
--     event and the threshold never fires).
--
-- Vault contract per memory reference_supabase_pg_cron_vault_service_role_pattern:
--   The trigger reads vault.decrypted_secrets WHERE name='service_role_key'.
--   The `app.service_role_key` GUC (current_setting) does NOT exist on this
--   project — using GUC would silently fail the http_post call.
--
-- Dollar-quote nesting per memory reference_postgres_dollar_quote_nesting_in_cron_body:
--   The trigger function uses the named tag `$fn$` (not bare `$$`) so any future
--   re-use inside a do-block or cron.schedule(..., $cron$ … $cron$) body does
--   not silently terminate the outer quote on a nested `$$`.
-- ============================================================================

-- ─── Section 1 — ticket_sla_breach_state (dedupe per ticket × breach_type) ──
-- PK (ticket_id, breach_type) — at most one row per pair; UPSERT semantics.
-- ROW LEVEL SECURITY: agents in the same org may SELECT for visibility (the
-- admin observability surface in Plan 08 reads this); no INSERT/UPDATE/DELETE
-- policy is defined — only service_role (the cron Edge Fn) writes.

create table public.ticket_sla_breach_state (
  ticket_id        uuid        not null references public.tickets(id) on delete cascade,
  breach_type      text        not null check (breach_type in ('first_response','resolution')),
  last_alerted_at  timestamptz not null default now(),
  alert_count      int         not null default 1,
  primary key (ticket_id, breach_type)
);

alter table public.ticket_sla_breach_state enable row level security;

create policy "tsbs_select_agent"
  on public.ticket_sla_breach_state
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.org_members m
        join public.tickets t on t.org_id = m.org_id
       where t.id = ticket_sla_breach_state.ticket_id
         and m.user_id = auth.uid()
    )
  );

-- No INSERT / UPDATE / DELETE policy — writes are service-role-only via the
-- try_record_sla_breach() SECDEF RPC below.

comment on table public.ticket_sla_breach_state is
  'Phase 37 Plan 37-05 (HELP-06): dedupe state for SLA breach alerts. '
  'One row per (ticket_id, breach_type); UPSERTed by try_record_sla_breach().';

-- ─── Section 2 — tickets.csat_sent_at (CSAT idempotency anchor) ────────────
-- Stamped by helpdesk-csat-send after a successful sendEmail call. The Edge
-- Fn short-circuits to a no-op {skipped: 'already_sent'} when this is NOT
-- NULL, so re-firing trg_helpdesk_on_ticket_close on a same-status UPDATE
-- (e.g. a closed→closed no-op) never produces a duplicate email.

alter table public.tickets
  add column if not exists csat_sent_at timestamptz;

comment on column public.tickets.csat_sent_at is
  'Phase 37 Plan 37-05 (HELP-05): set by helpdesk-csat-send on first successful '
  'CSAT email dispatch. NULL = no CSAT email yet. Acts as the idempotency anchor.';

-- ─── Section 3 — sla_targets.alert_recipients (admin-editable on-call list) ─
-- Per-tier email list edited from the Plan 08 admin surface. The cron Edge Fn
-- builds its recipient set as union(assigned_to email, alert_recipients[],
-- env SLA_BREACH_DEFAULT_ONCALL_EMAILS).

alter table public.sla_targets
  add column if not exists alert_recipients text[] not null default array[]::text[];

comment on column public.sla_targets.alert_recipients is
  'Phase 37 Plan 37-05 (HELP-06): admin-editable on-call email list, per (org_id, tier). '
  'Merged with assigned_to + env fallback by helpdesk-sla-breach-cron.';

-- ─── Section 4 — try_record_sla_breach() SECDEF RPC ────────────────────────
-- The load-bearing UPSERT-dedupe primitive for HELP-06.
--
-- supabase-js .upsert() does not natively support a WHERE clause on the
-- DO UPDATE branch, so the cron Edge Fn calls this RPC instead. Returns:
--   true   — row inserted OR an existing row was updated (dedupe window expired).
--   false  — existing row within dedupe window; caller MUST skip the email send.
--
-- The WHERE clause on DO UPDATE is the dedupe clamp — when the existing row's
-- last_alerted_at is < dedupe_hours old, the UPDATE matches no row, RETURNING
-- yields nothing, and v_alerted stays false. coalesce() guards the NULL path.
--
-- search_path is pinned per memory reference_supabase_migration_gotchas
-- (SECURITY DEFINER without an explicit search_path is a CVE-class footgun).

create or replace function public.try_record_sla_breach(
  p_ticket_id   uuid,
  p_breach_type text,
  p_dedupe_hours int default 24
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_alerted boolean := false;
begin
  if p_breach_type not in ('first_response','resolution') then
    raise exception 'invalid breach_type: %', p_breach_type using errcode = '22023';
  end if;

  insert into public.ticket_sla_breach_state (ticket_id, breach_type)
  values (p_ticket_id, p_breach_type)
  on conflict (ticket_id, breach_type) do update
    set last_alerted_at = now(),
        alert_count     = ticket_sla_breach_state.alert_count + 1
    where ticket_sla_breach_state.last_alerted_at < now() - make_interval(hours => p_dedupe_hours)
  returning true into v_alerted;

  return coalesce(v_alerted, false);
end
$fn$;

revoke execute on function public.try_record_sla_breach(uuid, text, int) from public;
grant  execute on function public.try_record_sla_breach(uuid, text, int) to service_role;

comment on function public.try_record_sla_breach(uuid, text, int) is
  'Phase 37 Plan 37-05 (HELP-06): UPSERT-dedupe primitive for SLA breach alerts. '
  'Returns true when caller should send the alert email; false when within dedupe window.';

-- ─── Section 5 — helpdesk_on_ticket_close() trigger function ───────────────
-- Fires helpdesk-csat-send via pg_net.http_post on the closed-transition.
--
-- Trigger contract (Plan 37-05 <interfaces>):
--   AFTER UPDATE OF status ON public.tickets
--   WHEN (old.status <> 'closed' AND new.status = 'closed')
--
-- The Edge Fn handles idempotency via tickets.csat_sent_at — so even if this
-- trigger fires multiple times (e.g. closed→pending→closed) the user gets at
-- most one CSAT email.
--
-- AFTER vs BEFORE: must be AFTER so the row is fully committed before the
-- Edge Fn reads it back via SUPABASE_URL/REST.

create or replace function public.helpdesk_on_ticket_close()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_key  text;
  v_url  constant text := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/helpdesk-csat-send';
begin
  -- Only fire on the open→closed transition (idempotent on same-status UPDATE).
  if (old.status is distinct from 'closed') and new.status = 'closed' then

    select decrypted_secret
      into v_key
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;

    if v_key is null then
      raise notice 'helpdesk_on_ticket_close: vault service_role_key entry missing — skipping CSAT';
      return new;
    end if;

    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object('ticket_id', new.id),
      timeout_milliseconds := 30000
    );
  end if;

  return new;
end
$fn$;

revoke execute on function public.helpdesk_on_ticket_close() from public;

comment on function public.helpdesk_on_ticket_close() is
  'Phase 37 Plan 37-05 (HELP-05): AFTER UPDATE OF status trigger function — '
  'invokes helpdesk-csat-send Edge Fn on the open→closed transition via '
  'pg_net.http_post with the service_role_key from vault.decrypted_secrets.';

-- ─── Section 6 — trg_helpdesk_on_ticket_close trigger ──────────────────────
-- Idempotent: drop-then-create so re-running this migration on a partial-apply
-- environment converges to the desired definition.

drop trigger if exists trg_helpdesk_on_ticket_close on public.tickets;

create trigger trg_helpdesk_on_ticket_close
  after update of status on public.tickets
  for each row
  execute function public.helpdesk_on_ticket_close();
