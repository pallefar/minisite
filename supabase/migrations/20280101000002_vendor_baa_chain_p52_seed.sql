-- =============================================================================
-- Phase 52 Plan 52-04 — vendor_baa_chain seed rows for new Phase 52 vendors
-- =============================================================================
--
-- Purpose: Insert 8 new vendor rows into the EXISTING public.vendor_baa_chain
--   table (created in Phase 25 Plan 25-01). Does NOT create a parallel table.
--   Closes VENDOR-10 (BAA chain re-verified for v1.4 additions).
--
-- Decision honored: Phase 25 A10 — INSERT via migration role is permitted;
--   service_role UPDATE/DELETE are revoked. Status transitions (pending → signed)
--   happen later via the vendor_baa_chain_update SECURITY DEFINER RPC from the
--   admin UI (Phase 25 Plan 25-08).
--
-- Existing seed rows already present: 'Supabase', 'Vercel', 'Sentry',
--   'Anthropic', 'AWS SES', 'PostHog'.
--
-- New rows added here (all status='pending'; baa_signed_at/baa_expiry_at null;
--   monthly_cost_usd=0 unless known; signing defers to Phase 70 HUMAN-UAT):
--   Mux, Apple Developer, Google Play, Calendly, Better Stack,
--   RevenueCat, AdMob/AdSense, Stripe
--
-- Idempotency: ON CONFLICT (vendor_name) DO NOTHING — safe to re-run.
-- Timestamp: 20280101000002 — forward-dated above latest local migration
--   (20271102000015) per RESEARCH Pitfall 7.
-- =============================================================================

insert into public.vendor_baa_chain
  (vendor_name, baa_signed_at, baa_expiry_at, monthly_cost_usd,
   scope_summary, subprocessor_list, subprocessor_last_diff_at,
   contact_email, status)
values
  ('Mux', null, null, 0.00,
   'Video hosting (community + KB). BAA decision needed — Mux standard plan has no HIPAA BAA; check enterprise.',
   '[]'::jsonb, null, null, 'pending'),
  ('Apple Developer', null, null, 0.00,
   'n/a: signing authority, no PHI processed.',
   '[]'::jsonb, null, null, 'pending'),
  ('Google Play', null, null, 0.00,
   'n/a: distribution, no PHI processed.',
   '[]'::jsonb, null, null, 'pending'),
  ('Calendly', null, null, 0.00,
   'Scheduling — PHI risk if patient data in events. BAA available.',
   '[]'::jsonb, null, null, 'pending'),
  ('Better Stack', null, null, 12.00,
   'Status page / uptime monitoring. Minimal PHI risk.',
   '[]'::jsonb, null, null, 'pending'),
  ('RevenueCat', null, null, 0.00,
   'Subscription/payment events. Minimal PHI; BAA check needed.',
   '[]'::jsonb, null, null, 'pending'),
  ('AdMob/AdSense', null, null, 0.00,
   'n/a: ad network MUST NOT touch PHI (HealthKit firewall).',
   '[]'::jsonb, null, null, 'pending'),
  ('Stripe', null, null, 0.00,
   'Payment processor. HIPAA data-processor BAA usually available.',
   '[]'::jsonb, null, null, 'pending')
on conflict (vendor_name) do nothing;
