-- Phase 40 Plan 40-01 — POLISH-04
-- Marker migration: documents that the Stripe coupon seed Edge Fn must be invoked
-- after deploy. No schema mutation in this migration.
--
-- The 6 Stripe coupons (SAVE-{20,25,30}-{2,3}MO) are created by:
--   supabase functions deploy cancellation-seed-coupons --import-map supabase/functions/import_map.json
--   curl -X POST -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
--     "https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/cancellation-seed-coupons"
--
-- This invocation is owned by Plan 40-06 (close-out task).
-- Re-running is safe: resource_already_exists is silently skipped (A7 idempotency).
--
-- Named dollar-quote tag $migration_marker$ — NEVER bare $$ per project convention.

do $migration_marker$
begin
  raise notice 'p40_stripe_coupon_seed: Stripe coupon catalog seed marker.'
    ' To seed: deploy cancellation-seed-coupons Edge Fn and POST with service-role bearer.'
    ' Fn is idempotent — resource_already_exists silently skipped (A7).'
    ' Coupon catalog: SAVE-20-2MO, SAVE-20-3MO, SAVE-25-2MO, SAVE-25-3MO, SAVE-30-2MO, SAVE-30-3MO.'
    ' All: duration=repeating, metadata.source=phase_40_save_flow.'
    ' Owned by Plan 40-06 close-out task.';
end
$migration_marker$;
