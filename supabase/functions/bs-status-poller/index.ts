/**
 * bs-status-poller — Deno.serve entry point.
 *
 * Phase 67 Plan 67-04 (OPS-10) — Better Stack status-page polling.
 *
 * Cron: every 5min via pg_cron (deferred to Phase 67 close-out or Phase 70).
 *
 * Required Function Secrets (set at deploy time):
 *   SUPABASE_URL                    — Supabase project URL (for shared Slack helper)
 *   SUPABASE_SERVICE_ROLE_KEY       — service-role bearer + slack vault auth
 *   BETTER_STACK_API_KEY            — Better Stack uptime API token
 *   BETTER_STACK_REQUESTER_EMAIL    — sender email on incident records
 *   SLACK_GUARDRAIL_WEBHOOK_URL     — env-var fast-path for placeholder-guard alerts
 *
 * Per [[reference_deno_test_top_level_serve_trap]]: Deno.serve gated by
 * import.meta.main so test imports do NOT bind a server socket.
 */

import { handle } from './handler.ts';
import type { BsStatusPollerDeps } from './handler.ts';

if (import.meta.main) {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const betterStackApiKey = Deno.env.get('BETTER_STACK_API_KEY') ?? '';
  const requesterEmail = Deno.env.get('BETTER_STACK_REQUESTER_EMAIL') ?? '';

  const prodDeps: BsStatusPollerDeps = {
    fetchImpl: fetch,
    serviceRoleKey,
    betterStackApiKey,
    requesterEmail,
  };

  Deno.serve((req: Request) => handle(req, prodDeps));
}
