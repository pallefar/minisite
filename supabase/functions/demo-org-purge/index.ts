/**
 * demo-org-purge — Deno.serve entry point.
 *
 * Phase 68 Plan 68-02 (LAND-06). Cron-driven (daily at 03:00 UTC; cron
 * registration deferred to Phase 68 close-out migration).
 *
 * Deploy:
 *   `supabase functions deploy demo-org-purge`
 *
 * Required Function Secrets (set at deploy time):
 *   SUPABASE_URL                 — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY    — service role key (sb_secret_* format)
 *
 * Per [[reference_deno_test_top_level_serve_trap]]: Deno.serve is guarded by
 * `if (import.meta.main)` so test imports of handler.ts do NOT bind a socket.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { handle } from './handler.ts';
import type { DemoOrgPurgeDeps } from './handler.ts';

if (import.meta.main) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const supabaseServiceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const prodDeps: DemoOrgPurgeDeps = {
    supabaseServiceClient,
    serviceRoleKey,
  };

  Deno.serve((req: Request) => handle(req, prodDeps));
}
