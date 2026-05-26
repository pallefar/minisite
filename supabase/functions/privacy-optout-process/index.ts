/**
 * privacy-optout-process — Deno.serve entry point.
 *
 * Phase 64 Plan 64-02. Triggered by POST from `/privacy/do-not-sell` form
 * (no auth required — Do-Not-Sell is auth-optional per UI-SPEC §2).
 * GET /healthz returns 200 ok.
 * NO cron. Deploy in Plan 64-08.
 *
 * === Endpoints ===
 * GET /healthz → 200 { ok: true, fn: "privacy-optout-process" }
 * POST / → unauthenticated public form POST → fan-out opt-out to 4 targets
 *
 * === Synchronous fan-out (INSIGHTS-09 lesson from Phase 62) ===
 * The Fn writes DIRECTLY to:
 *   1. privacy_optout_requests (INSERT)
 *   2. ad_targeting_exclusion (UPSERT)
 *   3. email_lifecycle_exclusion (UPSERT)
 *   4. PostHog $opt_out event (best-effort capture)
 * Plus: Resend confirmation email.
 * NOT a queue — propagation is synchronous within the Fn invocation.
 *
 * === Deploy ===
 * Plan 64-08 close-out runs:
 *   npx supabase functions deploy privacy-optout-process --project-ref ytnsipxxmzgaebkqmokp
 *
 * Required Function Secrets (set at deploy time via supabase secrets set):
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (sb_secret_* format)
 *   RESEND_API_KEY            — Resend production API key
 *   POSTHOG_PROJECT_KEY       — PostHog project API key (nullable; no-op if missing)
 *
 * === Deno.serve guard ===
 * Per [[reference_deno_test_top_level_serve_trap]]: Deno.serve is inside
 * `if (import.meta.main)` so test imports do NOT bind a server socket.
 * Importing `handler.ts` from tests is safe.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './handler.ts';
import type { PrivacyOptoutDeps } from './handler.ts';

if (import.meta.main) {
  // Build production deps from environment
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? '';
  // POSTHOG_PROJECT_KEY is nullable — captureServer-style no-op when missing
  const posthogProjectKey = Deno.env.get('POSTHOG_PROJECT_KEY') ?? null;

  const supabaseServiceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const prodDeps: PrivacyOptoutDeps = {
    fetchImpl: fetch,
    supabaseServiceClient,
    resendApiKey,
    posthogProjectKey,
    supabaseUrl,
  };

  Deno.serve((req: Request) => handle(req, prodDeps));
}
