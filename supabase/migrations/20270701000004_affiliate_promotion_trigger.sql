-- Phase 26 Plan 01 — AFTER INSERT/UPDATE trigger: standard → gold promotion (D-02).
--
-- AFFTIER-01 success criterion: when an affiliate's 10th paid/confirmed conversion
-- lands, the trigger auto-promotes affiliates.tier from 'standard' to 'gold' and
-- writes ONE audit_logs row. Concurrent inserts at the N=10 boundary produce
-- exactly one audit row (Pitfall 3 race-safe ratchet via `WHERE tier='standard'`).
--
-- Trigger fires on:
--   AFTER INSERT (status in ('paid','confirmed'))                                 — new row at threshold
--   AFTER UPDATE OF status (transition INTO 'paid' or 'confirmed' from anything)  — back-fill case
--
-- Race-safety (Pitfall 3): the UPDATE includes `AND tier = 'standard'` so the
-- SECOND concurrent UPDATE becomes a no-op (rows-affected = 0 → FOUND = false →
-- no audit row). This is the canonical pattern from `feedback_planner_iter1_anti_patterns`.
--
-- Audit emission — RULE 1 DEVIATION FROM PLAN BODY (auto-fix per executor rules):
-- The plan-body INSERT only populated Phase-24 columns (actor_user_id, target_user_id,
-- action_name, source, etc.), but `public.audit_logs` was created in Phase 7 with
-- legacy `action text NOT NULL CHECK (...)` + `user_id_hash text NOT NULL`. The
-- plan-body INSERT would fail at runtime on those NOT NULL constraints and on
-- the CHECK (since 'affiliate_tier_auto_promoted' isn't in the constraint's
-- accepted-values list yet). This migration therefore:
--   (a) populates the legacy `action` + `user_id_hash` columns alongside the
--       Phase-24 columns, mirroring the Phase 19 admin-RPC pattern at
--       supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql:178-202;
--   (b) extends the audit_logs_action_check CHECK constraint via drop+re-add to
--       include 'affiliate_tier_auto_promoted' (preserving every prior value
--       verbatim from migration 20270601000019).
--
-- This is consistent with Phase 24's "RPC pattern lift only" — the new
-- `action_name` column is FREE TEXT, but the legacy `action` column is still
-- CHECK-constrained and the legacy `user_id_hash` is still NOT NULL.
--
-- The trigger does NOT set app.suppress_audit because affiliates is not in
-- the Phase 7 or Phase 24 PHI trigger set — the only audit row for this
-- event IS the one this trigger writes (no double-audit risk).

-- =============================================================================
-- 1. Extend audit_logs_action_check to include the new Phase 26 promotion action.
--    Preserves every prior value from migration 20270601000019 verbatim.
-- =============================================================================
alter table public.audit_logs
  drop constraint if exists audit_logs_action_check;

alter table public.audit_logs
  add constraint audit_logs_action_check check (
    action in (
      -- Phase 7 baseline (20260601000001_audit_logs.sql)
      'insert',
      'update',
      'delete',
      'account_deleted_initiated',
      'account_deleted_finalized',
      -- Phase 8 (20260701000001_audit_logs_share_columns.sql)
      'share_view',
      -- Phase 9 — org lifecycle
      'org_create',
      'org_update',
      'org_delete',
      -- Phase 9 — invite + membership lifecycle
      'membership_invite_sent',
      'membership_invite_accepted',
      'membership_invite_rejected',
      'membership_invite_canceled',
      'membership_revoked',
      'membership_scope_updated',
      'membership_role_changed',
      -- Phase 9 — clinic data access
      'clinic_photo_view',
      -- Phase 9 — authorization gate failures
      'permission_denied',
      -- Phase 9 — role CRUD
      'role_create',
      'role_update',
      'role_delete',
      -- Phase 10 — roster ranking + drill-in
      'rank_computed',
      'rank_threshold_crossed',
      'section_view',
      'bulk_pdf_export',
      'bulk_csv_export',
      'clinic_snapshot_loaded',
      -- Phase 22 baseline (20270601000002_audit_action_enum_phase22.sql)
      'impersonate_start',
      'impersonate_end',
      'impersonate_blocked_write',
      'refund_issued',
      'subscription_canceled_admin',
      'subscription_comped',
      'feature_flag_override_set',
      'dsar_requested',
      'dsar_completed',
      'consent_recorded',
      'account_deletion_cancelled',
      -- Phase 22 plan 07 ADMIN-06 — affiliate review queue operator events
      -- (20270601000019_admin_affiliate_review_rpcs.sql)
      'affiliate_conversion_approved',
      'affiliate_conversion_held',
      'affiliate_conversion_rejected',
      -- Phase 26 plan 01 — automatic Standard → Gold promotion (D-02)
      'affiliate_tier_auto_promoted'
    )
  );

-- =============================================================================
-- 2. Promotion trigger function — race-safe ratchet + FOUND-gated audit
-- =============================================================================
create or replace function public.promote_standard_to_gold_on_paid()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_count int;
  v_promoted int;
begin
  -- Only react when a row transitions INTO 'paid' or 'confirmed'.
  -- (Re-saves of the same status, or transitions OUT, are no-ops.)
  if (TG_OP = 'INSERT' and NEW.status not in ('paid','confirmed'))
     or (TG_OP = 'UPDATE' and (OLD.status = NEW.status or NEW.status not in ('paid','confirmed'))) then
    return NEW;
  end if;

  -- Count cumulative paid+confirmed conversions for this affiliate.
  select count(*) into v_count
    from public.affiliate_conversions
   where affiliate_id = NEW.affiliate_id
     and status in ('paid','confirmed');

  if v_count < 10 then
    return NEW;
  end if;

  -- Race-safe ratchet (Pitfall 3): WHERE tier='standard' makes second concurrent
  -- UPDATE a no-op (rows-affected = 0 → FOUND = false → no audit row).
  update public.affiliates
     set tier = 'gold',
         tier_promoted_at = now()
   where id = NEW.affiliate_id
     and tier = 'standard'
  returning 1 into v_promoted;

  if found then
    -- Audit emission — populates BOTH legacy Phase-7 columns (action, user_id_hash)
    -- and Phase-24 columns (action_name, source='trigger', before_data/after_data)
    -- per the Rule 1 deviation explained in the header comment.
    insert into public.audit_logs (
      -- Legacy Phase 7 columns (NOT NULL on user_id_hash + action+CHECK)
      user_id,
      user_id_hash,
      table_name,
      row_id,
      action,
      -- Phase 24 columns (additive)
      actor_user_id,
      target_user_id,
      action_name,
      row_pk,
      before_data,
      after_data,
      source
    ) values (
      null,                                                       -- no actor (system trigger)
      encode(digest('system'::text, 'sha256'), 'hex'),            -- stable user_id_hash for system events
      'public.affiliates',
      NEW.affiliate_id::text,
      'affiliate_tier_auto_promoted',
      null,                                                       -- no admin actor
      null,                                                       -- target represented by row_pk
      'affiliate_tier_auto_promoted',
      NEW.affiliate_id::text,
      jsonb_build_object('tier', 'standard'),
      jsonb_build_object('tier', 'gold', 'paid_conversion_count', v_count),
      'trigger'
    );
  end if;

  return NEW;
end
$$;

revoke all on function public.promote_standard_to_gold_on_paid() from public;

drop trigger if exists trg_affiliate_promote_gold
  on public.affiliate_conversions;

create trigger trg_affiliate_promote_gold
  after insert or update of status on public.affiliate_conversions
  for each row execute function public.promote_standard_to_gold_on_paid();
