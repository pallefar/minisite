/**
 * stripe-dunning-orchestrator — Deno.serve entry point.
 *
 * Phase 65 Plan 65-05. **CRON-INVOKED** (every 15 minutes) — service-role
 * POST scans subscriptions in failing dunning states and fires the
 * next-stage Resend email. Deploy in close-out Plan 65-10.
 *
 * === Endpoints ===
 * GET /healthz → 200 { ok: true, fn: "stripe-dunning-orchestrator" }
 * POST / → service-role bearer required → enumerate dunning subs + send Resend emails
 *
 * === Deploy ===
 * Plan 65-10 runs `supabase functions deploy stripe-dunning-orchestrator`.
 * Cron registration via pg_cron is ALSO Plan 65-10 — Fn MUST deploy BEFORE
 * cron points at it (per [[feedback_fn_deploy_before_cron_db_push]]).
 *
 * Required Function Secrets (set at deploy time):
 *   SUPABASE_URL                       — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY          — service role key (sb_secret_* format)
 *   RESEND_API_KEY                     — Resend production API key
 *   NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY — HMAC signing key for unsubscribe tokens
 *   PHYSICAL_ADDRESS                   — CAN-SPAM compliant address (MUST NOT be placeholder)
 *   SLACK_GUARDRAIL_WEBHOOK_URL        — (optional) — Slack guardrail alerts; falls back to vault
 *
 * === Deno.serve guard ===
 * Per [[reference_deno_test_top_level_serve_trap]]: Deno.serve is inside
 * `if (import.meta.main)` so test imports do NOT bind a server socket.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { handle } from './handler.ts';
import type { DunningOrchestratorDeps } from './handler.ts';

if (import.meta.main) {
  // Build production deps from environment
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const signingKey = Deno.env.get('NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY') ?? '';
  const physicalAddress = Deno.env.get('PHYSICAL_ADDRESS') ?? undefined;

  const supabaseServiceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const prodDeps: DunningOrchestratorDeps = {
    fetchImpl: fetch,
    supabaseServiceClient,
    resendApiKey,
    serviceRoleKey,
    supabaseUrl,
    signingKey,
    physicalAddress,
  };

  Deno.serve((req: Request) => handle(req, prodDeps));
}
