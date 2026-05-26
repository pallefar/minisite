/**
 * grandfathered-policy-notice — Deno.serve entry point.
 *
 * Phase 64 Plan 64-03. **OPERATOR-INVOKED at Phase 70 UAT** — service-role
 * POST triggers one-shot grandfathered-notice send. Deploy in Plan 64-08.
 * NO cron — send is manual.
 *
 * === Endpoints ===
 * GET /healthz → 200 { ok: true, fn: "grandfathered-policy-notice" }
 * POST / → service-role bearer required → enumerate pre-cutoff users + send Resend emails
 *
 * === Deploy ===
 * Plan 64-08 runs `supabase functions deploy grandfathered-policy-notice`.
 * Required Function Secrets (set at deploy time):
 *   SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (sb_secret_* format)
 *   RESEND_API_KEY        — Resend production API key
 *   PHASE_64_SHIP_DATE    — ISO timestamp cutoff (e.g. "2026-05-26T00:00:00.000Z")
 *   PHYSICAL_ADDRESS      — CAN-SPAM compliant physical address (MUST NOT be placeholder)
 *   NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY — HMAC signing key for unsubscribe tokens
 *
 * === Deno.serve guard ===
 * Per [[reference_deno_test_top_level_serve_trap]]: Deno.serve is inside
 * `if (import.meta.main)` so test imports do NOT bind a server socket.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { handle } from './handler.ts';
import type { GrandfatheredNoticeDeps } from './handler.ts';

if (import.meta.main) {
  // Build production deps from environment
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const phase64ShipDate = Deno.env.get('PHASE_64_SHIP_DATE') ?? '';
  const signingKey = Deno.env.get('NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY') ?? '';
  const physicalAddress = Deno.env.get('PHYSICAL_ADDRESS') ?? undefined;

  const supabaseServiceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const prodDeps: GrandfatheredNoticeDeps = {
    fetchImpl: fetch,
    supabaseServiceClient,
    resendApiKey,
    serviceRoleKey,
    supabaseUrl,
    phase64ShipDate,
    signingKey,
    physicalAddress,
  };

  Deno.serve((req: Request) => handle(req, prodDeps));
}
