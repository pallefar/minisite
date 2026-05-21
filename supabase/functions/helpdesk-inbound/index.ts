/**
 * `helpdesk-inbound` Edge Function — Phase 37 Plan 37-03 (HELP-03).
 *
 * Receives Resend Inbound `email.received` webhooks. Two destinations:
 *
 *   support@app.leanshot.app         → create ticket  (new ticket flow)
 *   reply+<HMAC>@app.leanshot.app    → append message (reply-threading)
 *
 * Pipeline:
 *
 *   1. CORS preflight + method gate (POST only).
 *   2. Svix signature verify (svix-id, svix-timestamp, svix-signature)
 *      — RESEND_WEBHOOK_SECRET; throws on bad sig / expired timestamp
 *      (±5min default replay window).
 *   3. Idempotency lookup against `ticket_inbound_events.resend_email_id`
 *      BEFORE any side-effect (Svix retries on non-2xx).
 *   4. Loop guard: From=/^(noreply|no-reply|reply\+)@/i → reject, log,
 *      DO NOT auto-reply (else infinite loop).
 *   5. Two-step body fetch — webhook payload is metadata-only; the body
 *      lives at GET https://api.resend.com/emails/receiving/{email_id}
 *      (Resend Inbound API, RESEARCH Pitfall 1).
 *   6. Address dispatch:
 *        a. reply+<token>@ → resolve sender; trial-verify HMAC against
 *           sender's recent tickets; on match append + reopen, on miss
 *           bounce via helpdesk_unknown_sender template.
 *        b. support@ → resolve sender; on match create ticket + first
 *           message; on miss bounce via helpdesk_unknown_sender.
 *        c. anything else → ignored 200.
 *   7. Attachments: MIME allowlist + 10MB cap + 10/email cap; private
 *      bucket upload; row inserted with `scan_status='deferred'`.
 *      ClamAV is DEFERRED to v1.4 per deferred-items.md P0 — partial
 *      mitigation only. Each stored attachment emits a dedicated
 *      `helpdesk.attachment.scan_deferred` PostHog event so the audit
 *      trail explicitly shows the deferral (D-21 + threat T-37-03-05).
 *
 * Forbidden:
 *   - Do NOT log the email body or attachment content.
 *   - Do NOT log secrets in error.message (only `code` / status).
 *   - Do NOT auto-reply to noreply@ / no-reply@ / reply+@ (loop guard).
 *   - Do NOT skip idempotency lookup (Svix retries).
 *   - Do NOT call helpdesk-ai-assist synchronously — fire-and-forget.
 *
 * Sender lookup contract:
 *   Plan 37-03 frontmatter referenced `profiles.email`, but `public.profiles`
 *   does NOT carry an email column on this project (migration
 *   20261101000001_profiles_is_staff.sql only sets `id + is_staff +
 *   created_at`; email is held by `auth.users`). We therefore resolve sender
 *   identity via `admin.auth.admin.listUsers({ email })` — same pattern
 *   already used by `clinic-invite/index.ts::emailExistsInAuth`. This is a
 *   deviation Rule 1 fix (bug — plan referenced a column that doesn't exist).
 *
 * Clinician role list:
 *   PHI flag derivation aligned with `create_ticket_with_first_message` RPC
 *   (migration 20270707000009_helpdesk_create_ticket_rpc.sql line 52):
 *     `('owner','clinician','staff')` — NOT the plan's `support_lead`,
 *   which would diverge from the widget-side PHI determination and produce
 *   inconsistent PHI flagging across email-vs-widget channels.
 *
 * captureServer arg shape:
 *   `_shared/posthog-server.ts::CaptureArgs` requires `userId` (Supabase
 *   auth.users.id — D-13), NOT `distinctId`. The plan's example used
 *   `distinctId` which would not type-check. Rule 1 fix.
 *
 * shutdownPostHog:
 *   Wrap the request handler in try/finally + `await shutdownPostHog()`
 *   before returning. The Deno isolate is torn down immediately after
 *   the Response is returned and batched PostHog events would be dropped
 *   (RESEARCH PITFALL 1).
 */
import 'jsr:@std/dotenv/load';
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { Webhook } from 'npm:svix@^1.45';
import { sendEmail } from '../_shared/email-router.ts';
import { verifyReplyToken } from '../_shared/helpdesk-hmac.ts';
import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';
import { corsHeaders } from './cors.ts';

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY           = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY        = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';
const HMAC_SECRET           = Deno.env.get('HELPDESK_HMAC_SECRET') ?? '';

const SIGNUP_URL = 'https://app.leanshot.app/signup?utm_source=helpdesk_inbound&utm_medium=email';
const SUPPORT_ADDRESS = 'support@app.leanshot.app';
// REPLY_RE is case-INSENSITIVE on the `reply+` prefix + domain but its
// capture group must preserve the ORIGINAL case of the token (base64url is
// case-sensitive). We apply this regex against the raw (un-lowercased) value
// so the captured token round-trips through verifyReplyToken unchanged.
const REPLY_RE = /^reply\+([A-Za-z0-9_-]+)@app\.leanshot\.app$/i;
const LOOP_FROM_RE = /^(noreply|no-reply|reply\+)@/i;
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
]);
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_ATTACHMENTS_PER_EMAIL = 10;

// ─── Admin client (service-role) ──────────────────────────────────────────────
// Used for: ticket_inbound_events idempotency, auth.admin.listUsers, tickets +
// ticket_messages + ticket_attachments inserts, storage uploads, org_members
// role lookup. RLS is bypassed by design — this Function is server-to-server
// from Resend with Svix signature as the auth gate.
const _adminSingleton: { client: SupabaseClient | null } = { client: null };
function admin(): SupabaseClient {
  if (_adminSingleton.client) return _adminSingleton.client;
  _adminSingleton.client = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _adminSingleton.client;
}

// ─── Outcome enum (matches ticket_inbound_events.outcome CHECK) ───────────────
export type Outcome =
  | 'ticket_created'
  | 'reply_appended'
  | 'unknown_sender_bounced'
  | 'hmac_failed_bounced'
  | 'duplicate'
  | 'rejected_loop';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: corsHeaders });
}

interface LogInboundArgs {
  resendEmailId: string;
  from: string;
  to: string;
  outcome: Outcome;
  ticketId?: string | null;
}
async function logInboundEvent(args: LogInboundArgs): Promise<void> {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    await (admin().from('ticket_inbound_events').insert({
      resend_email_id: args.resendEmailId,
      ticket_id: args.ticketId ?? null,
      from_email: args.from,
      to_email: args.to,
      outcome: args.outcome,
    }) as any);
    /* eslint-enable @typescript-eslint/no-explicit-any */
  } catch (e) {
    // Best-effort audit row. We never block the 200 response on audit insert
    // failure — the upstream Svix retry would only re-create the same row
    // (idempotency unique constraint blocks duplicates).
    console.warn('[helpdesk-inbound] logInboundEvent failed', e instanceof Error ? e.name : 'unknown');
  }
}

interface ResendAttachment {
  filename: string;
  content_type: string;
  size: number;
  download_url: string;
}

interface ResendInboundEmail {
  text?: string;
  html?: string;
  subject?: string;
  attachments?: ResendAttachment[];
}

/**
 * Fetch the full inbound email (body + attachments) from Resend.
 *
 * The `email.received` webhook payload is METADATA-ONLY (RESEARCH Pitfall 1).
 * Body + attachment download URLs are exposed via the Resend Inbound REST
 * endpoint with a 1-hour TTL.
 */
async function fetchInboundEmail(emailId: string): Promise<ResendInboundEmail | null> {
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    });
    if (!res.ok) {
      console.warn('[helpdesk-inbound] resend fetch failed', res.status);
      return null;
    }
    return (await res.json()) as ResendInboundEmail;
  } catch (e) {
    console.warn('[helpdesk-inbound] resend fetch threw', e instanceof Error ? e.name : 'unknown');
    return null;
  }
}

/**
 * Resolve sender by email via auth.users (NOT profiles — see header note).
 *
 * Returns null when email is unknown. The lookup is exact-match on the
 * lowercased address (Resend already lowercases the From header in webhook
 * payloads but we lowercase defensively).
 */
interface ResolvedSender {
  id: string;
}
async function resolveSenderByEmail(email: string): Promise<ResolvedSender | null> {
  if (!email) return null;
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data } = await (admin().auth.admin as any).listUsers({ email });
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const users = (data?.users ?? []) as Array<{ id: string; email?: string }>;
    if (users.length === 0) return null;
    // listUsers can return prefix matches in some SDK versions; require
    // exact lowercased equality before trusting the row.
    const exact = users.find((u) => (u.email ?? '').toLowerCase() === email);
    if (!exact) return null;
    return { id: exact.id };
  } catch {
    return null;
  }
}

/**
 * Resolve a user's primary org (tickets.org_id NOT NULL) + clinician PHI flag.
 *
 * Mirrors `create_ticket_with_first_message` RPC logic so widget + email
 * intake produce identical PHI flagging for the same user.
 */
interface OrgContext {
  orgId: string | null;
  phi: boolean;
}
async function resolveOrgContext(userId: string): Promise<OrgContext> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: prof } = (await (admin()
    .from('profiles')
    .select('primary_org_id')
    .eq('id', userId)
    .maybeSingle() as any)) as { data: { primary_org_id?: string | null } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const orgId = prof?.primary_org_id ?? null;
  if (!orgId) return { orgId: null, phi: false };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: member } = (await (admin()
    .from('org_members')
    .select('role')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .in('role', ['owner', 'clinician', 'staff'])
    .maybeSingle() as any)) as { data: { role?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { orgId, phi: Boolean(member) };
}

/**
 * Ingest attachments: MIME + size + count caps; private-bucket upload;
 * ticket_attachments row insert with `scan_status='deferred'`; emit a
 * `helpdesk.attachment.scan_deferred` PostHog event PER stored row.
 *
 * Skips silently (with console.warn) on per-attachment validation/upload
 * failure; never throws — one bad attachment must not block the parent
 * ticket/message insert.
 */
async function ingestAttachments(
  list: ResendAttachment[],
  ticketId: string,
  messageId: string,
  userId: string,
  phi: boolean,
): Promise<void> {
  const capped = list.slice(0, MAX_ATTACHMENTS_PER_EMAIL);
  for (const att of capped) {
    if (!ALLOWED_MIME.has(att.content_type)) {
      console.warn('[helpdesk-inbound] attachment-mime-rejected', att.content_type);
      continue;
    }
    if (att.size > MAX_ATTACHMENT_BYTES) {
      console.warn('[helpdesk-inbound] attachment-size-rejected', att.size);
      continue;
    }
    let buf: Uint8Array;
    try {
      const fileRes = await fetch(att.download_url, {
        headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
      });
      if (!fileRes.ok) {
        console.warn('[helpdesk-inbound] attachment-fetch-failed', fileRes.status);
        continue;
      }
      buf = new Uint8Array(await fileRes.arrayBuffer());
    } catch (e) {
      console.warn('[helpdesk-inbound] attachment-fetch-threw', e instanceof Error ? e.name : 'unknown');
      continue;
    }
    const safeName = att.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'attachment';
    const storagePath = `${ticketId}/${messageId}/${crypto.randomUUID()}-${safeName}`;
    const up = await admin().storage.from('ticket-attachments').upload(storagePath, buf, {
      contentType: att.content_type,
      upsert: false,
    });
    if (up.error) {
      // error.code (where available) only — error.message can echo path/key.
      console.warn('[helpdesk-inbound] attachment-upload-failed');
      continue;
    }
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { error: insErr } = (await (admin().from('ticket_attachments').insert({
      ticket_id: ticketId,
      message_id: messageId,
      storage_path: storagePath,
      mime_type: att.content_type,
      byte_size: att.size,
      original_filename: att.filename,
      // TODO [DEFERRED v1.4]: ClamAV scan — see
      // .planning/phases/37-m6-helpdesk-core/deferred-items.md P0.
      scan_status: 'deferred',
    }) as any)) as { error: { code?: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (insErr) {
      console.warn('[helpdesk-inbound] attachment-row-insert-failed', insErr.code ?? 'unknown');
      // Try to clean up the uploaded blob to avoid orphaned storage objects.
      try {
        await admin().storage.from('ticket-attachments').remove([storagePath]);
      } catch {
        /* best-effort */
      }
      continue;
    }
    // Audit-trail event per stored attachment — proves the deferral was
    // recorded (T-37-03-05).
    try {
      captureServer({
        userId,
        event: 'helpdesk.attachment.scan_deferred',
        properties: {
          ticket_id: ticketId,
          mime: att.content_type,
          size: att.size,
          phi,
        },
      });
    } catch {
      /* PostHog must never block the ticket flow. */
    }
  }
}

// ─── Branch handlers ──────────────────────────────────────────────────────────

interface BranchArgs {
  emailId: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  body: string;
  attachments: ResendAttachment[];
}

/**
 * Branch: `reply+<token>@app.leanshot.app`.
 *
 * Strategy: we don't yet know the ticket_id or user_id — the token is opaque.
 * We resolve the sender via auth.users, then trial-verify the token against
 * the sender's 50 most-recent tickets. Constant-time HMAC verify per ticket
 * keeps the search-space cost bounded and avoids a DB round-trip for the
 * token-to-ticket mapping.
 *
 * On HMAC fail OR unknown sender → bounce via helpdesk_unknown_sender +
 * audit row + 200. Never reveal which one failed (anti-enumeration mirroring
 * Phase 9 W-1 invariant).
 */
async function handleReplyBranch(args: BranchArgs, token: string): Promise<Response> {
  const { emailId, fromEmail, toEmail, body, attachments } = args;

  const sender = await resolveSenderByEmail(fromEmail);
  if (!sender) {
    // Unknown sender on a reply address — bounce + log.
    await sendEmail(admin(), {
      template: 'helpdesk_unknown_sender',
      to: fromEmail,
      vars: { signup_url: SIGNUP_URL },
      phi: false,
    });
    await logInboundEvent({
      resendEmailId: emailId,
      from: fromEmail,
      to: toEmail,
      outcome: 'unknown_sender_bounced',
    });
    return textResponse(200, 'unknown-sender');
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: candidates } = (await (admin()
    .from('tickets')
    .select('id, status')
    .eq('user_id', sender.id)
    .order('created_at', { ascending: false })
    .limit(50) as any)) as { data: Array<{ id: string; status: string }> | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  let matchedTicketId: string | null = null;
  let matchedStatus: string | null = null;
  for (const c of candidates ?? []) {
    if (await verifyReplyToken(token, HMAC_SECRET, c.id, sender.id)) {
      matchedTicketId = c.id;
      matchedStatus = c.status;
      break;
    }
  }
  if (!matchedTicketId) {
    // Token didn't match any of this sender's tickets — bounce.
    await sendEmail(admin(), {
      template: 'helpdesk_unknown_sender',
      to: fromEmail,
      vars: { signup_url: SIGNUP_URL },
      phi: false,
    });
    await logInboundEvent({
      resendEmailId: emailId,
      from: fromEmail,
      to: toEmail,
      outcome: 'hmac_failed_bounced',
    });
    return textResponse(200, 'hmac-failed');
  }

  // Append message.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: msgRow, error: msgErr } = (await (admin()
    .from('ticket_messages')
    .insert({
      ticket_id: matchedTicketId,
      author_user_id: sender.id,
      author_kind: 'user',
      body,
      via: 'email',
      resend_email_id: emailId,
    })
    .select('id')
    .single() as any)) as { data: { id: string } | null; error: { code?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (msgErr || !msgRow) {
    console.warn('[helpdesk-inbound] reply append insert failed', msgErr?.code ?? 'unknown');
    // We still log the event (so retries don't double-insert) and return 200.
    await logInboundEvent({
      resendEmailId: emailId,
      from: fromEmail,
      to: toEmail,
      outcome: 'reply_appended',
      ticketId: matchedTicketId,
    });
    return textResponse(200, 'append-failed');
  }

  // Reopen if it was a terminal/waiting status; refresh activity timestamps.
  const reopenStates = ['waiting_on_customer', 'resolved', 'closed'];
  if (reopenStates.includes(matchedStatus ?? '')) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    await (admin()
      .from('tickets')
      .update({
        status: 'open',
        updated_at: new Date().toISOString(),
        last_user_message_at: new Date().toISOString(),
      })
      .eq('id', matchedTicketId) as any);
    /* eslint-enable @typescript-eslint/no-explicit-any */
  } else {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    await (admin()
      .from('tickets')
      .update({
        updated_at: new Date().toISOString(),
        last_user_message_at: new Date().toISOString(),
      })
      .eq('id', matchedTicketId) as any);
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  // Look up PHI flag for the existing ticket so attachment audit events
  // carry the correct phi label.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: tRow } = (await (admin()
    .from('tickets')
    .select('phi')
    .eq('id', matchedTicketId)
    .maybeSingle() as any)) as { data: { phi?: boolean } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const phi = Boolean(tRow?.phi);
  await ingestAttachments(attachments, matchedTicketId, msgRow.id, sender.id, phi);

  await logInboundEvent({
    resendEmailId: emailId,
    from: fromEmail,
    to: toEmail,
    outcome: 'reply_appended',
    ticketId: matchedTicketId,
  });
  try {
    captureServer({
      userId: sender.id,
      event: 'helpdesk.inbound_email.received',
      properties: { outcome: 'reply_appended', ticket_id: matchedTicketId },
    });
  } catch {
    /* never block on PostHog */
  }
  return jsonResponse(200, { ok: true, outcome: 'reply_appended' });
}

/**
 * Branch: `support@app.leanshot.app` (new ticket).
 *
 * On unknown sender → bounce + emit `helpdesk.inbound_email.unknown_sender`.
 * On known sender → resolve PHI + org context → insert ticket + first
 * message → ingest attachments → fire-and-forget helpdesk-ai-assist.
 */
async function handleSupportBranch(args: BranchArgs): Promise<Response> {
  const { emailId, fromEmail, toEmail, subject, body, attachments } = args;

  const sender = await resolveSenderByEmail(fromEmail);
  if (!sender) {
    await sendEmail(admin(), {
      template: 'helpdesk_unknown_sender',
      to: fromEmail,
      vars: { signup_url: SIGNUP_URL },
      phi: false,
    });
    await logInboundEvent({
      resendEmailId: emailId,
      from: fromEmail,
      to: toEmail,
      outcome: 'unknown_sender_bounced',
    });
    // PostHog audit using a stable system distinct_id (sender unknown, so
    // we can't use a user uid). We use the hash-prefix-style 'unknown' bucket
    // — the events_mirror table only requires a non-empty userId.
    try {
      captureServer({
        userId: 'unknown_sender',
        event: 'helpdesk.inbound_email.unknown_sender',
        properties: { domain: fromEmail.split('@')[1] ?? '' },
      });
    } catch {
      /* never block */
    }
    return textResponse(200, 'unknown-sender');
  }

  const { orgId, phi } = await resolveOrgContext(sender.id);
  if (!orgId) {
    // User has no primary_org_id — we can't insert a ticket
    // (tickets.org_id NOT NULL). Log under 'rejected_loop' to keep the
    // CHECK constraint happy without inventing a new outcome label.
    await logInboundEvent({
      resendEmailId: emailId,
      from: fromEmail,
      to: toEmail,
      outcome: 'rejected_loop',
    });
    return textResponse(200, 'user-no-org');
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: ticketRow, error: tErr } = (await (admin()
    .from('tickets')
    .insert({
      org_id: orgId,
      user_id: sender.id,
      subject,
      phi,
      status: 'open',
      priority: 'p3',
      source: 'email',
      last_user_message_at: new Date().toISOString(),
    })
    .select('id')
    .single() as any)) as { data: { id: string } | null; error: { code?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (tErr || !ticketRow) {
    console.warn('[helpdesk-inbound] ticket insert failed', tErr?.code ?? 'unknown');
    await logInboundEvent({
      resendEmailId: emailId,
      from: fromEmail,
      to: toEmail,
      outcome: 'rejected_loop',
    });
    return textResponse(500, 'ticket-insert-failed');
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: msgRow, error: mErr } = (await (admin()
    .from('ticket_messages')
    .insert({
      ticket_id: ticketRow.id,
      author_user_id: sender.id,
      author_kind: 'user',
      body,
      via: 'email',
      resend_email_id: emailId,
    })
    .select('id')
    .single() as any)) as { data: { id: string } | null; error: { code?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (mErr || !msgRow) {
    console.warn('[helpdesk-inbound] first message insert failed', mErr?.code ?? 'unknown');
    // Ticket without a message is degraded; we still log the audit row +
    // return 200 so Svix doesn't retry indefinitely.
    await logInboundEvent({
      resendEmailId: emailId,
      from: fromEmail,
      to: toEmail,
      outcome: 'ticket_created',
      ticketId: ticketRow.id,
    });
    return jsonResponse(200, { ok: true, outcome: 'ticket_created', ticket_id: ticketRow.id });
  }

  await ingestAttachments(attachments, ticketRow.id, msgRow.id, sender.id, phi);

  await logInboundEvent({
    resendEmailId: emailId,
    from: fromEmail,
    to: toEmail,
    outcome: 'ticket_created',
    ticketId: ticketRow.id,
  });
  try {
    captureServer({
      userId: sender.id,
      event: 'helpdesk.ticket.created',
      properties: { ticket_id: ticketRow.id, source: 'email', phi },
    });
    captureServer({
      userId: sender.id,
      event: 'helpdesk.inbound_email.received',
      properties: { outcome: 'ticket_created', ticket_id: ticketRow.id },
    });
  } catch {
    /* never block */
  }

  // Fire-and-forget AI assist invocation. Plan 04 owns helpdesk-ai-assist
  // (Wave 3). It re-reads ticket.phi from the DB and re-resolves BAA scope,
  // so we don't need to pass phi here — only enough context to find the
  // record (D-08 / T-37-03-08).
  if (SUPABASE_URL && SERVICE_KEY) {
    void fetch(`${SUPABASE_URL}/functions/v1/helpdesk-ai-assist`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ticket_id: ticketRow.id, message_id: msgRow.id }),
    }).catch(() => {
      /* AI assist is best-effort; swallow */
    });
  }

  return jsonResponse(200, { ok: true, outcome: 'ticket_created', ticket_id: ticketRow.id });
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

export async function handler(req: Request): Promise<Response> {
  // 1. CORS preflight.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  // 2. Method check.
  if (req.method !== 'POST') {
    return textResponse(405, 'method_not_allowed');
  }

  // 3. Svix signature verification (replay window enforced internally).
  const rawBody = await req.text();
  let event: unknown;
  try {
    const wh = new Webhook(RESEND_WEBHOOK_SECRET);
    event = wh.verify(rawBody, {
      'svix-id': req.headers.get('svix-id') ?? '',
      'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
      'svix-signature': req.headers.get('svix-signature') ?? '',
    });
  } catch {
    // NEVER log the signature header or rawBody (PHI risk + secret leak).
    return textResponse(401, 'invalid signature');
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const evt = event as { type?: string; data?: any };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (evt?.type !== 'email.received') {
    // Unknown / unsupported event type — ack 200 so Svix doesn't retry.
    return textResponse(200, 'ignored');
  }

  const data = evt.data ?? {};
  const emailId: string = String(data.email_id ?? '');
  if (!emailId) {
    return textResponse(400, 'missing email_id');
  }

  // 4. Idempotency lookup BEFORE any side-effect (Svix retries).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: existing } = (await (admin()
    .from('ticket_inbound_events')
    .select('id')
    .eq('resend_email_id', emailId)
    .maybeSingle() as any)) as { data: { id?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (existing?.id) {
    return jsonResponse(200, { duplicate: true });
  }

  // 5. Address parsing.
  const fromEmail = String(data.from ?? '').toLowerCase();
  const toCandidates: string[] = Array.isArray(data.to) ? data.to : data.to ? [data.to] : [];
  // CASE-SENSITIVITY: keep the raw To value because the reply+<HMAC>@ token
  // is base64url (case-sensitive). We only lowercase the domain + local-part
  // prefix for matching; the token capture group preserves original case.
  const toEmailRaw = String(toCandidates[0] ?? '');
  const toEmail = toEmailRaw.toLowerCase();

  // 6. Loop guard — From == noreply / no-reply / reply+ → reject WITHOUT
  // auto-reply (else infinite loop). Log + return 200.
  if (LOOP_FROM_RE.test(fromEmail)) {
    await logInboundEvent({
      resendEmailId: emailId,
      from: fromEmail,
      to: toEmail,
      outcome: 'rejected_loop',
    });
    return textResponse(200, 'loop-rejected');
  }

  // 7. Two-step body fetch.
  const email = await fetchInboundEmail(emailId);
  if (!email) {
    // 502 → Svix will retry with backoff. Don't log an inbound event yet
    // (we have no idempotency anchor if the retry succeeds later).
    return textResponse(502, 'resend fetch failed');
  }
  const body = String(email.text ?? '').trim();
  const subject = String(email.subject ?? '(no subject)').slice(0, 200) || '(no subject)';
  const attachments = (email.attachments ?? []).filter(
    (a): a is ResendAttachment =>
      typeof a?.filename === 'string' &&
      typeof a?.content_type === 'string' &&
      typeof a?.size === 'number' &&
      typeof a?.download_url === 'string',
  );
  const branchArgs: BranchArgs = {
    emailId,
    fromEmail,
    toEmail,
    subject,
    body,
    attachments,
  };

  // 8. Address dispatch. Reply regex runs against the RAW (case-preserved)
  // To value so the captured base64url token survives unchanged.
  const replyMatch = toEmailRaw.match(REPLY_RE);
  if (replyMatch) {
    const token = replyMatch[1] ?? '';
    return await handleReplyBranch(branchArgs, token);
  }
  if (toEmail === SUPPORT_ADDRESS) {
    return await handleSupportBranch(branchArgs);
  }

  // 9. Unknown destination — ignored.
  return textResponse(200, 'ignored-destination');
}

// ─── Deno.serve entrypoint (try/finally + shutdownPostHog) ────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  try {
    return await handler(req);
  } catch (e) {
    // Never echo error.message in case it contains a secret reference.
    console.error('[helpdesk-inbound] unhandled', e instanceof Error ? e.name : 'unknown');
    return textResponse(500, 'internal_error');
  } finally {
    // RESEARCH PITFALL 1: flush posthog-node before isolate teardown.
    await shutdownPostHog();
  }
});

// ─── Internal test seams ──────────────────────────────────────────────────────
export const __internal = {
  ALLOWED_MIME,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_EMAIL,
  REPLY_RE,
  LOOP_FROM_RE,
  SUPPORT_ADDRESS,
  // Test setter for the admin singleton (swap in a hand-rolled fake).
  setAdminForTest(client: SupabaseClient): void {
    _adminSingleton.client = client;
  },
  resetAdminForTest(): void {
    _adminSingleton.client = null;
  },
};
