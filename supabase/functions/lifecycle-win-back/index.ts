/**
 * lifecycle-win-back — Deno.serve entry point.
 *
 * Phase 65 Plan 65-07. Cron-driven (weekly) post-cancel win-back lifecycle
 * emails with per-user Stripe Promotion Code mint.
 *
 * Deploy in Plan 65-10 (operator close-out). Cron registration also lives there.
 *
 * Required Function Secrets:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY
 *   STRIPE_SECRET_KEY
 *   STRIPE_COUPON_WINBACK_10  (10% off coupon id — created in Stripe Dashboard)
 *   STRIPE_COUPON_WINBACK_25  (25% off coupon id)
 *   STRIPE_COUPON_WINBACK_50  (50% off coupon id)
 *   PHYSICAL_ADDRESS
 *   NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY
 *
 * Operator action (Plan 65-10): create the 3 coupons in Stripe Dashboard
 * BEFORE deploying this Fn.
 *
 * Per reference_deno_test_top_level_serve_trap: Deno.serve is guarded by
 * `if (import.meta.main)` so test imports do NOT bind a socket.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import Stripe from 'npm:stripe@19?target=denonext';
import { handle } from './handler.ts';
import type { WinBackDeps } from './handler.ts';

if (import.meta.main) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const signingKey = Deno.env.get('NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY') ?? '';
  const physicalAddress = Deno.env.get('PHYSICAL_ADDRESS') ?? undefined;
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';

  const supabaseServiceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2026-04-22.dahlia',
    httpClient: Stripe.createFetchHttpClient(),
  });

  const prodDeps: WinBackDeps = {
    fetchImpl: fetch,
    supabaseServiceClient,
    stripe,
    resendApiKey,
    serviceRoleKey,
    supabaseUrl,
    signingKey,
    physicalAddress,
    coupons: {
      t30d: Deno.env.get('STRIPE_COUPON_WINBACK_10') ?? '',
      t60d: Deno.env.get('STRIPE_COUPON_WINBACK_25') ?? '',
      t90d: Deno.env.get('STRIPE_COUPON_WINBACK_50') ?? '',
    },
  };

  Deno.serve((req: Request) => handle(req, prodDeps));
}
