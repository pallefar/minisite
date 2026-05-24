// Phase 47-08 — event-reminders-fanout Edge Fn.
//
// Hourly cron tick (phase47-event-reminders-hourly, registered in
// 20270801000010_p47_event_reminder_cron.sql) calls this Fn with a service_role
// bearer. The Fn invokes `select_event_reminder_targets()` SECDEF RPC for the
// per-user-TZ windowing JOIN, then iterates targets to:
//   1. Try INSERT INTO event_reminder_sent ON CONFLICT DO NOTHING (idempotent dedup).
//      The UNIQUE constraint (event_id, user_id, kind) ensures at-most-once delivery
//      per memory feedback_state_counter_table_needs_upsert_on_event.
//   2. sendEmail with phi forwarded from the RPC's per-row projection (Pitfall 6).
//      Resend (phi=false) vs SES (phi=true) is the email-router's single switch.
//   3. For promotion-kind rows, UPDATE event_promotion_queue.drained_at = now()
//      to drain the queue (D-03 fan-out drain).
//
// Auth: service-role bearer per checkServiceRoleBearer; rejects non-cron callers.
// (Memory: reference_supabase_service_role_key_format_divergence — handles
// sb_secret_* and legacy JWT shapes via constant-time compare in the helper.)
//
// Top-level Deno.serve guarded by import.meta.main per memory
// reference_deno_test_top_level_serve_trap — otherwise sibling index.test.ts
// imports would spin up a real HTTP server on test load.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { checkServiceRoleBearer, jsonError, jsonResponse } from '../_shared/lifecycle-utils.ts';
import { sendEmail as defaultSendEmail } from '../_shared/email-router.ts';
import type { EmailTemplate, SendEmailArgs, SendEmailResult } from '../_shared/email-router.ts';

// ─── sendEmail test seam (mirrors community-admin-report-digest pattern) ─────

type SendEmailFn = (supabase: SupabaseClient, args: SendEmailArgs) => Promise<SendEmailResult>;
let _sendEmailImpl: SendEmailFn = defaultSendEmail;
export function setSendEmailForTest(fn: SendEmailFn): void {
  _sendEmailImpl = fn;
}
export function resetSendEmailForTest(): void {
  _sendEmailImpl = defaultSendEmail;
}

// ─── Target row shape (mirrors select_event_reminder_targets RETURNS) ────────

interface ReminderTarget {
  event_id: string;
  user_id: string;
  kind: '1d' | '1h' | 'promotion';
  phi: boolean;
  email: string;
  event_title: string;
  local_start_at: string;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: targets, error } = await admin.rpc('select_event_reminder_targets');
  if (error) {
    console.warn('[event-reminders-fanout] rpc_failed', error.code ?? error.message);
    return jsonError(500, 'rpc_failed');
  }

  let sent = 0;
  for (const t of (targets ?? []) as ReminderTarget[]) {
    // Idempotent dedup: try to insert; if the UNIQUE (event_id, user_id, kind)
    // constraint trips, .insert returns null data (no row) AND a 23505 error.
    // Either condition → skip send.
    const { error: dupErr, data: dupData } = await admin
      .from('event_reminder_sent')
      .insert({ event_id: t.event_id, user_id: t.user_id, kind: t.kind })
      .select('id')
      .maybeSingle();
    if (dupErr || !dupData) continue;

    // Template selection — kind → template-id. EmailTemplate union widening
    // for these three names is owned by the close-out (47-12) when the email
    // template modules land; until then the email-router's `default` arm
    // returns a generic body and PHI routing still works (phi flag drives
    // Resend vs SES, not the template).
    const template = (
      t.kind === '1d' ? 'event_reminder_1d' :
      t.kind === '1h' ? 'event_reminder_1h' :
                        'event_promotion'
    ) as EmailTemplate;

    try {
      await _sendEmailImpl(admin, {
        to: t.email,
        template,
        phi: t.phi, // derived from community_spaces.org_id IS NOT NULL in RPC
        vars: {
          event_title: t.event_title,
          local_start_at: t.local_start_at,
        },
      });
    } catch (e) {
      // Per-recipient try/catch — one failed send must NOT block others
      // (mirrors helpdesk-sla-breach-cron + community-admin-report-digest patterns).
      console.warn('[event-reminders-fanout] send_failed', (e as Error)?.message ?? 'unknown');
      continue;
    }

    if (t.kind === 'promotion') {
      await admin
        .from('event_promotion_queue')
        .update({ drained_at: new Date().toISOString() })
        .eq('event_id', t.event_id)
        .eq('user_id', t.user_id);
    }
    sent += 1;
  }

  return jsonResponse(200, { ok: true, sent });
}

// Top-level serve guard (memory: reference_deno_test_top_level_serve_trap).
const denoGlobal = (globalThis as unknown as { Deno?: { serve?: (h: typeof handler) => unknown } }).Deno;
if (import.meta.main && denoGlobal?.serve) denoGlobal.serve(handler);
