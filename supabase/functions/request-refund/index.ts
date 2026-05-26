/**
 * request-refund — Deno.serve entry point.
 *
 * Phase 65 Plan 65-06 (PAY-08).
 *
 * JWT-authed user-callable Edge Fn for self-service refund per FTC ROSCA.
 * Backend only — UI lives in Plan 65-09 (RefundRequestForm).
 *
 * === Endpoints ===
 *   GET  /healthz → 200 { ok: true, fn: "request-refund" }
 *   POST /        → JWT user bearer required → eligibility + refund + cancel + audit + email
 *
 * === Deploy ===
 * Plan 65-10 (close-out) runs `supabase functions deploy request-refund`.
 * Required Function Secrets:
 *   SUPABASE_URL                       — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY          — service-role key (used for admin.auth.getUser
 *                                        + RLS-bypass DB writes on refunds table)
 *   STRIPE_SECRET_KEY                  — Stripe secret key
 *   RESEND_API_KEY                     — Resend production API key
 *   PHYSICAL_ADDRESS                   — CAN-SPAM compliant address (MUST NOT be placeholder)
 *   NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY — HMAC signing key for unsubscribe envelope
 *   SLACK_GUARDRAIL_WEBHOOK_URL        — optional; Slack P1 alerts on guard failures
 *
 * === Deno.serve guard ===
 * Per [[reference_deno_test_top_level_serve_trap]]: Deno.serve is inside
 * `if (import.meta.main)` so test imports of handler.ts do NOT bind a server socket.
 */

import Stripe from 'https://esm.sh/stripe@19?target=denonext';
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { handle } from './handler.ts';
import type { RequestRefundDeps } from './handler.ts';

if (import.meta.main) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const signingKey = Deno.env.get('NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY') ?? '';
  const physicalAddress = Deno.env.get('PHYSICAL_ADDRESS') ?? undefined;
  const slackWebhookUrl = Deno.env.get('SLACK_GUARDRAIL_WEBHOOK_URL') ?? undefined;

  const supabaseServiceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Stripe SDK pin: stripe@19, API 2026-04-22.dahlia (matches stripe-checkout/Phase 14 lock).
  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2026-04-22.dahlia' as Parameters<typeof Stripe>[1]['apiVersion'],
    httpClient: Stripe.createFetchHttpClient(),
  });

  const prodDeps: RequestRefundDeps = {
    fetchImpl: fetch,
    supabaseServiceClient,
    stripe,
    resendApiKey,
    supabaseUrl,
    signingKey,
    physicalAddress,
    slackWebhookUrl,
    moneyBackDays: 14,
  };

  Deno.serve((req: Request) => handle(req, prodDeps));
}
