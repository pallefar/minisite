-- Phase 22 plan 22-11 — D-06 / GDPR-03: cron tick that picks up `pending`
-- DSAR requests and invokes the `dsar-export` Edge Function (plan 22-04).
--
-- Analog: supabase/migrations/20270601000017_lifecycle_cron_schedules.sql (lifecycle cron + Vault bearer)
-- Pitfalls applied: reference_supabase_migration_filename_regex.md (no letter suffix);
--                   reference_vendor_gated_send_health_check.md (graceful no-op when Vault key missing).
--
-- Why a cron tick (not a trigger or user-callable Fn)?
--   - dsar-export requires the service_role bearer (T-22-29 server-side-only auth model from plan 22-04).
--   - Trigger-fired net.http_post would block the user's `create_dsar_request` RPC on a 9-step orchestration
--     (bundle assembly + jsPDF + ZIP + Storage upload + signed-URL + transactional email).
--   - The cron decouples the user UI from the heavy server path: user POSTs `create_dsar_request` (returns
--     a UUID immediately + INSERTs row with status='pending') → cron tick at next 5-min boundary picks the
--     pending row up → dsar-export updates status to 'in_progress' then 'completed' → DsarPortalPage
--     observes the status transitions via Supabase Realtime / poll.
--
-- 5-minute cadence rationale: balances "user impatience" (UI-SPEC line 612 promises 24h normal-case) vs
-- pg_cron job density (parallel with lifecycle-behavior-triggered 15-minute cadence on the same instance).
-- Plan 22-04 sets the per-tick LIMIT to 10 pending rows; at 5-min cadence that's 2880/day throughput —
-- more than sufficient for a v1.2 single-tenant workload.
--
-- Vault dependency (BL-7-style vendor pass): `vault.decrypted_secrets` row name='service_role_key' is the
-- service-role bearer source. If the secret is NOT loaded (Phase 19 deferred vendor pass per
-- project_phase19_pre_plan_state.md), the DO block exits without sending — DSAR requests remain `pending`
-- until the vendor pass completes, at which point the next 5-minute tick processes the backlog.
-- This is the SAME graceful-degradation pattern shipped by Phase 19 monthly-payout cron + Phase 22
-- lifecycle crons. Admin can also manually invoke dsar-export via the dashboard with a fresh service-role
-- bearer; the manual invocation is idempotent (Edge Fn step 2 short-circuits non-`pending` rows with 200).
--
-- Status-machine ownership audit (per feedback_status_machine_transition_owner.md):
--   pending     ← public.create_dsar_request RPC (migration 18 — plan 22-04)   — already shipped
--   in_progress ← dsar-export Edge Fn step 2 (`UPDATE status='in_progress'`)   — already shipped
--   completed   ← dsar-export Edge Fn final step                               — already shipped
--   rejected    ← dsar-export Edge Fn catch / public.admin_reject_dsar RPC     — already shipped
-- THIS migration adds NO new writers; it only schedules the trigger that hands `pending` rows to the
-- shipped writer. S6 audit unchanged.
--
-- STRIDE register:
--   T-22-66 D  Vault key missing → DSAR stuck pending (CONTEXT D-66 acceptance): mitigated here by the
--              `if v_service_key is null then return; end if;` short-circuit (no error log spam; admin
--              alert via the deferred-items tracker rather than a per-tick exception).
--   T-22-67 D  Cron overlapping tick hammering dsar-export: bounded by LIMIT 10 + STORE-method ZIP + per-tick
--              cadence (5 min > Edge Fn max execution wall-clock). No SKIP LOCKED needed at v1.2 volume.
--   T-22-68 I  service_role_key in pg_cron job log: pg_cron stores the literal $$ body in cron.job, so the
--              SELECT against vault.decrypted_secrets is evaluated each invocation — the literal key never
--              lands in cron.job_run_details output. (Same posture as plan 22-02 / 19-09 crons.)

create extension if not exists pg_cron;

select cron.schedule(
  'dsar-export-tick',
  '*/5 * * * *',
  $cronbody$
    do $body$
    declare
      v_request record;
      v_service_key text;
    begin
      select decrypted_secret
        into v_service_key
        from vault.decrypted_secrets
       where name = 'service_role_key'
       limit 1;

      if v_service_key is null then
        -- T-22-66 graceful no-op. Vendor pass (Vault key load) not yet completed.
        return;
      end if;

      for v_request in
        select id
          from public.dsar_requests
         where status = 'pending'
         order by requested_at
         limit 10
      loop
        perform net.http_post(
          url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/dsar-export',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_service_key
          ),
          body := jsonb_build_object('request_id', v_request.id),
          timeout_milliseconds := 60000
        );
      end loop;
    end $body$;
  $cronbody$
);
