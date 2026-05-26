/**
 * lifecycle-trial-ending — Deno.serve entry point.
 *
 * Phase 65 Plan 65-07. Cron-driven daily Edge Fn. T-3d + T-1d trial-ending
 * lifecycle emails with PostHog A/B copy variant on T-3d.
 *
 * Deploy in Plan 65-10 (operator close-out). Cron registration also lives there.
 *
 * Required Function Secrets:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY
 *   PHYSICAL_ADDRESS
 *   NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY
 *   POSTHOG_PROJECT_KEY (optional — defaults to variant 'a' on failure)
 *   POSTHOG_HOST (optional — defaults to https://us.posthog.com)
 *
 * Per reference_deno_test_top_level_serve_trap: Deno.serve is guarded by
 * `if (import.meta.main)` so test imports do NOT bind a socket.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { handle } from './handler.ts';
import type { TrialEndingDeps } from './handler.ts';

if (import.meta.main) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const signingKey = Deno.env.get('NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY') ?? '';
  const physicalAddress = Deno.env.get('PHYSICAL_ADDRESS') ?? undefined;
  const posthogApiKey = Deno.env.get('POSTHOG_PROJECT_KEY') ?? undefined;
  const posthogHost = Deno.env.get('POSTHOG_HOST') ?? 'https://us.posthog.com';

  const supabaseServiceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const prodDeps: TrialEndingDeps = {
    fetchImpl: fetch,
    supabaseServiceClient,
    resendApiKey,
    serviceRoleKey,
    supabaseUrl,
    signingKey,
    physicalAddress,
    posthogApiKey,
    posthogHost,
  };

  Deno.serve((req: Request) => handle(req, prodDeps));
}
