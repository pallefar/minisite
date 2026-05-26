/**
 * nexus-monitor — Deno.serve entry (stub for RED gate).
 *
 * Phase 65 Plan 65-08 (PAY-04). Daily cron — registered in close-out Plan 65-10.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { handle } from './handler.ts';
import type { NexusMonitorDeps } from './handler.ts';

if (import.meta.main) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const slackWebhookUrl = Deno.env.get('SLACK_GUARDRAIL_WEBHOOK_URL') ?? '';

  const supabaseServiceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const prodDeps: NexusMonitorDeps = {
    fetchImpl: fetch,
    supabaseServiceClient,
    serviceRoleKey,
    supabaseUrl,
    slackWebhookUrl,
  };

  Deno.serve((req: Request) => handle(req, prodDeps));
}
