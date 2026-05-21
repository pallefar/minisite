/**
 * `helpdesk-agent-reply-send` Edge Function — Phase 37 Plan 37-07 (HELP-04).
 *
 * Dispatches an agent reply email for an existing `ticket_messages` row.
 *
 * Auth model (dual-path):
 *   1. service-role Bearer (server-internal — e.g. future pg_net call sites
 *      OR `helpdesk-inbound` re-routes). When the Authorization header equals
 *      `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, the caller is trusted; no
 *      additional org_members check is performed.
 *   2. session JWT (browser admin client — AgentReplyComposer.tsx send path).
 *      The Bearer is the user's access token. We:
 *        a. Decode the user via admin.auth.getUser(jwt).
 *        b. Verify the user is in `org_members` for the ticket's org_id.
 *        c. 403 on any failure.
 *
 * Pipeline:
 *   1. CORS preflight + method gate.
 *   2. Auth gate (service-role OR JWT-with-membership).
 *   3. Parse { ticket_id, message_id, subject }; 400 on missing.
 *   4. Load ticket (404 on miss) + message (404 on miss; must belong to ticket).
 *   5. Load recipient email from profiles.
 *   6. Generate reply token via generate_helpdesk_reply_token RPC.
 *   7. sendEmail(template='helpdesk_agent_reply', to=recipient, vars={ subject,
 *      body, reply_to: `reply+${token}@app.leanshot.app` }, phi: ticket.phi).
 *   8. UPDATE tickets SET last_agent_message_at = now().
 *   9. Return 200 { ok: true }.
 *
 * Threat model anchors (37-07):
 *   - T-37-07-03 (org-boundary) — JWT path re-verifies org_members.
 *   - T-37-07-05 (Reply-To tamper) — uses canonical RPC for token generation.
 *   - T-37-07-06 (PHI replay leak) — message.body is never logged.
 *
 * Forbidden:
 *   - Do NOT log message.body, recipient.email, ticket.subject (T-25-03-I1).
 *   - Do NOT bypass email-router (no direct SES / Resend calls).
 *   - Do NOT skip org_members check on the JWT path (T-37-07-03).
 */
import 'jsr:@std/dotenv/load';
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { sendEmail as defaultSendEmail } from '../_shared/email-router.ts';
import { corsHeaders } from './cors.ts';

// ─── Env ──────────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const REPLY_DOMAIN =
  Deno.env.get('HELPDESK_REPLY_DOMAIN') ?? 'app.leanshot.app';

// ─── Admin singleton ──────────────────────────────────────────────────────────
const _adminSingleton: { client: SupabaseClient | null } = { client: null };
function admin(): SupabaseClient {
  if (_adminSingleton.client) return _adminSingleton.client;
  _adminSingleton.client = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _adminSingleton.client;
}

// ─── sendEmail test seam ──────────────────────────────────────────────────────
type SendEmailFn = typeof defaultSendEmail;
let _sendEmailImpl: SendEmailFn = defaultSendEmail;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface ReplyInput {
  ticketId: string;
  messageId: string;
  subject: string;
}

function parseInput(body: unknown): ReplyInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const ticketId = typeof b.ticket_id === 'string' ? b.ticket_id.trim() : '';
  const messageId = typeof b.message_id === 'string' ? b.message_id.trim() : '';
  const subject = typeof b.subject === 'string' ? b.subject.trim() : '';
  if (!ticketId || !messageId) return null;
  return { ticketId, messageId, subject };
}

interface TicketRow {
  id: string;
  org_id: string;
  user_id: string;
  phi: boolean;
  subject: string;
}

interface MessageRow {
  id: string;
  ticket_id: string;
  author_kind: string;
  body: string;
}

interface ProfileRow {
  email: string | null;
}

async function fetchTicket(ticketId: string): Promise<TicketRow | null> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = (await (admin()
    .from('tickets')
    .select('id, org_id, user_id, phi, subject')
    .eq('id', ticketId)
    .maybeSingle() as any)) as {
    data: TicketRow | null;
    error: { code?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (error) {
    console.warn('[helpdesk-agent-reply-send] ticket-lookup-failed', error.code ?? 'unknown');
    return null;
  }
  return data;
}

async function fetchMessage(messageId: string): Promise<MessageRow | null> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = (await (admin()
    .from('ticket_messages')
    .select('id, ticket_id, author_kind, body')
    .eq('id', messageId)
    .maybeSingle() as any)) as {
    data: MessageRow | null;
    error: { code?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (error) {
    console.warn('[helpdesk-agent-reply-send] message-lookup-failed', error.code ?? 'unknown');
    return null;
  }
  return data;
}

async function fetchProfileEmail(userId: string): Promise<string | null> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = (await (admin()
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle() as any)) as {
    data: ProfileRow | null;
    error: { code?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (error) {
    console.warn('[helpdesk-agent-reply-send] profile-lookup-failed', error.code ?? 'unknown');
    return null;
  }
  return data?.email ?? null;
}

async function isOrgMember(userId: string, orgId: string): Promise<boolean> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = (await (admin()
    .from('org_members')
    .select('user_id')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle() as any)) as {
    data: { user_id: string } | null;
    error: { code?: string } | null;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (error) {
    console.warn('[helpdesk-agent-reply-send] org-member-lookup-failed', error.code ?? 'unknown');
    return false;
  }
  return !!data;
}

async function generateReplyToken(ticketId: string, userId: string): Promise<string | null> {
  const { data, error } = await admin().rpc('generate_helpdesk_reply_token', {
    p_ticket_id: ticketId,
    p_user_id: userId,
  });
  if (error) {
    console.warn('[helpdesk-agent-reply-send] token-rpc-failed', error.code ?? 'unknown');
    return null;
  }
  return typeof data === 'string' ? data : null;
}

interface AuthResult {
  ok: boolean;
  // 401 when no bearer; 403 when bearer is valid but caller doesn't have
  // access to this ticket's org.
  status: 200 | 401 | 403;
  isServiceRole: boolean;
  userId: string | null;
}

async function authorize(req: Request, ticket: TicketRow | null): Promise<AuthResult> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return { ok: false, status: 401, isServiceRole: false, userId: null };
  }
  const token = auth.slice('bearer '.length).trim();
  if (!token) {
    return { ok: false, status: 401, isServiceRole: false, userId: null };
  }
  // Service-role short-circuit. Constant-time equality is overkill here
  // because the secret is service-controlled, but use !== to keep predictable
  // semantics.
  if (SERVICE_KEY && token === SERVICE_KEY) {
    return { ok: true, status: 200, isServiceRole: true, userId: null };
  }
  // JWT path — decode the bearer into a user.
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, status: 401, isServiceRole: false, userId: null };
  }
  // 403 path requires the ticket — if we don't have one (no ticket lookup
  // yet), bubble out without committing to a decision; caller re-checks
  // after the ticket lookup.
  if (!ticket) {
    return { ok: true, status: 200, isServiceRole: false, userId: data.user.id };
  }
  const member = await isOrgMember(data.user.id, ticket.org_id);
  if (!member) {
    return { ok: false, status: 403, isServiceRole: false, userId: data.user.id };
  }
  return { ok: true, status: 200, isServiceRole: false, userId: data.user.id };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handler(req: Request): Promise<Response> {
  // 1. CORS preflight + method gate.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  // 2. First-pass auth — service-role OR JWT (without org check yet).
  const preAuth = await authorize(req, null);
  if (!preAuth.ok) {
    return jsonResponse(preAuth.status, { error: 'unauthorized' });
  }

  // 3. Parse input.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }
  const input = parseInput(rawBody);
  if (!input) {
    return jsonResponse(400, { error: 'missing_ticket_or_message_id' });
  }

  // 4a. Lookup ticket.
  const ticket = await fetchTicket(input.ticketId);
  if (!ticket) {
    return jsonResponse(404, { error: 'ticket_not_found' });
  }

  // 4b. Second-pass auth — org-membership for JWT callers.
  if (!preAuth.isServiceRole) {
    if (!preAuth.userId) {
      return jsonResponse(401, { error: 'unauthorized' });
    }
    const member = await isOrgMember(preAuth.userId, ticket.org_id);
    if (!member) {
      return jsonResponse(403, { error: 'forbidden' });
    }
  }

  // 4c. Lookup message and verify it belongs to this ticket.
  const message = await fetchMessage(input.messageId);
  if (!message || message.ticket_id !== ticket.id) {
    return jsonResponse(404, { error: 'message_not_found' });
  }

  // 5. Lookup recipient.
  const email = await fetchProfileEmail(ticket.user_id);
  if (!email) {
    // 200 with skipped — same pattern as csat-send (no_recipient).
    return jsonResponse(200, { ok: true, skipped: 'no_recipient' });
  }

  // 6. Generate Reply-To token via canonical RPC (T-37-07-05).
  const token = await generateReplyToken(ticket.id, ticket.user_id);
  if (!token) {
    return jsonResponse(500, { error: 'token_generation_failed' });
  }
  const replyTo = `reply+${token}@${REPLY_DOMAIN}`;

  // 7. Send via phi-aware email-router.
  const subject = input.subject || `Re: ${ticket.subject ?? 'your ticket'}`;
  try {
    await _sendEmailImpl(admin(), {
      template: 'helpdesk_agent_reply',
      to: email,
      vars: {
        subject,
        body: message.body,
        reply_to: replyTo,
      },
      phi: ticket.phi,
    });
  } catch (err) {
    // PHI path failures MUST NOT silently fall back to Resend (T-25-03-S4).
    // email-router surfaces a typed error; we log error.name (NOT .message,
    // which can contain credentials/PII).
    const errName = err instanceof Error ? err.name : 'unknown';
    console.warn('[helpdesk-agent-reply-send] sendEmail-failed', errName);
    return jsonResponse(500, { error: 'send_failed' });
  }

  // 8. Stamp last_agent_message_at.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { error: updErr } = (await (admin()
    .from('tickets')
    .update({ last_agent_message_at: new Date().toISOString() })
    .eq('id', ticket.id) as any)) as { error: { code?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (updErr) {
    // Email already sent — log and continue. Idempotent UPDATE; future
    // retries can re-stamp without effect.
    console.warn(
      '[helpdesk-agent-reply-send] last-agent-message-at-update-failed',
      updErr.code ?? 'unknown',
    );
  }

  return jsonResponse(200, { ok: true });
}

// ─── Deno.serve entrypoint ────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  try {
    return await handler(req);
  } catch (e) {
    console.error(
      '[helpdesk-agent-reply-send] unhandled',
      e instanceof Error ? e.name : 'unknown',
    );
    return jsonResponse(500, { error: 'internal_error' });
  }
});

// ─── Internal test seams ──────────────────────────────────────────────────────
export const __internal = {
  REPLY_DOMAIN,
  setAdminForTest(client: SupabaseClient): void {
    _adminSingleton.client = client;
  },
  resetAdminForTest(): void {
    _adminSingleton.client = null;
  },
  setSendEmailForTest(fn: SendEmailFn): void {
    _sendEmailImpl = fn;
  },
  resetSendEmailForTest(): void {
    _sendEmailImpl = defaultSendEmail;
  },
};
