/**
 * auth-rate-limit-check — Deno.serve entry point.
 *
 * Phase 66 Plan 66-05 (AUTH-14 + AUTH-15).
 *
 * UNAUTHENTICATED pre-sign-in surface — see handler.ts header for the full
 * threat-model + DB-write contract. Deno.serve is guarded by `import.meta.main`
 * so tests can import handler.ts without binding a socket
 * ([[reference_deno_test_top_level_serve_trap]]).
 *
 * Required Function Secrets (set at deploy time per Phase 70):
 *   SUPABASE_URL                — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY   — service-role key (sb_secret_* format)
 *   POSTHOG_PROJECT_KEY         — optional; brute-force telemetry no-op when unset
 *   SLACK_GUARDRAIL_WEBHOOK_URL — optional env-var fast-path for the Slack helper
 *                                 (else falls back to vault.decrypted_secrets)
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { handle } from './handler.ts';
import type { PostHogSink, RateLimitDeps } from './handler.ts';
import { captureServer } from '../_shared/posthog-server.ts';

if (import.meta.main) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const supabaseServiceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Adapt captureServer (CaptureArgs shape) to PostHogSink.capture.
  const posthog: PostHogSink = {
    capture: ({ distinctId, event, properties }) => {
      try {
        captureServer({ userId: distinctId, event, properties });
      } catch (err) {
        console.warn('[auth-rate-limit-check] captureServer threw:', err);
      }
    },
  };

  const deps: RateLimitDeps = {
    supabaseServiceClient,
    posthog,
  };

  Deno.serve((req: Request) => handle(req, deps));
}
