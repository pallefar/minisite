/**
 * rag-federated-dailymed — Phase 60 Plan 60-07 DailyMed SPL federated adapter.
 *
 * Entry point for Supabase Edge Function runtime.
 * Handler logic lives in handler.ts (Vitest-testable via DI).
 *
 * Deno.serve guarded by import.meta.main per [[reference_deno_test_top_level_serve_trap]].
 * DO NOT register cron here. 60-15 owns Fn deploy + cron registration.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { emitCostEnvelopeBreach, shutdownPostHog } from '../_shared/posthog-rag-events.ts';
import { sendSlackGuardrailAlert } from '../_shared/slack-guardrail-alert.ts';
import { handleRequest } from './handler.ts';
import type { HandlerDeps } from './handler.ts';

export type { HandlerDeps };

if (import.meta.main) {
  // deno-lint-ignore no-explicit-any
  const DenoGlobal = (globalThis as any).Deno;

  const supabase = createClient(
    DenoGlobal.env.get('SUPABASE_URL') ?? '',
    DenoGlobal.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  DenoGlobal.serve(async (req: Request) => {
    try {
      return await handleRequest(req, {
        supabase: supabase as never,
        emitCostEnvelopeBreach: (opts) => emitCostEnvelopeBreach({ properties: opts.properties as never }),
        sendSlackAlert: (channel, payload) =>
          sendSlackGuardrailAlert(channel as never, payload as never),
      } satisfies HandlerDeps);
    } finally {
      await shutdownPostHog().catch(() => {});
    }
  });
}
