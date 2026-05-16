/**
 * `lifecycle-transactional` Edge Function — Phase 22 plan 22-02 (ON-02).
 *
 * HTTP-invoked (NO cron). Accepts POSTs from internal callers:
 *   - DSAR export Edge Fn (plan 22-04) → template=`dsar_ready`
 *   - DEL-01 modal (plan 22-05)        → template=`deletion_scheduled`
 *   - Stripe webhook (existing P14)    → template=`receipt`
 *   - Auth flow (re-skin of P5)        → template=`password_reset`
 *
 * Auth: service-role bearer (constant-time compare). Function ships with
 * verify_jwt=true so the platform JWT verification ALSO runs — but the
 * actual identity for these callers is the service-role key.
 *
 * Plan 22-02 must_have: `deletion_scheduled` mints the HMAC cancel token
 * matching the `cancel_account_deletion(p_token)` RPC contract from plan
 * 22-01 File 14 — token shape `<uid>.<epoch_seconds>.<hex_hmac_sha256>`
 * (NOT a JWT — the RPC verifies the 3-part HMAC).
 *
 * Vault secret `CANCEL_DELETION_HMAC_KEY` is loaded via the Supabase
 * `vault.decrypted_secrets` view (RPC `get_cancel_deletion_hmac_key`
 * does not exist; we read via service-role select). Per 22-01 SUMMARY.md,
 * the Vault key is OUTSTANDING (vendor pass) — when missing we emit the
 * email with a placeholder cancel URL and log a warning. End user gets a
 * non-functional cancel link until Vault is loaded; the email itself
 * still sends correctly.
 *
 * NB: The mint is delegated to `_shared/cancel-token.ts` so the unit test
 * can mock the Vault lookup independently of the rest of the dispatcher.
 */
import { resendDomainHealthCheck } from '../_shared/resend-domain-health-check.ts';
import { sendResendEmail } from '../_shared/lifecycle-send.ts';
import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';
import { mintCancelDeletionToken } from '../_shared/cancel-token.ts';
import { renderTemplate, type TransactionalTemplateName } from './templates.ts';

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

const SITE_URL = () => Deno.env.get('SITE_URL') ?? 'https://app.leanshot.app';

const ALLOWED_TEMPLATES: TransactionalTemplateName[] = [
  'receipt',
  'password_reset',
  'dsar_ready',
  'deletion_scheduled',
];

interface SendBody {
  template?: string;
  user_id?: string;
  data?: Record<string, unknown>;
}

async function getUserEmail(userId: string): Promise<{ email: string; first_name?: string } | null> {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data } = await (admin.auth.admin as any).getUserById(userId);
    const u = data?.user;
    if (!u || !u.email) return null;
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    return {
      email: u.email as string,
      first_name: typeof meta.first_name === 'string' ? meta.first_name : undefined,
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  } catch {
    return null;
  }
}

async function handleSend(req: Request): Promise<Response> {
  let body: SendBody;
  try {
    body = (await req.json()) as SendBody;
  } catch {
    return jsonError(400, 'bad_json');
  }

  const template = (body.template ?? '').trim();
  const userId = (body.user_id ?? '').trim();
  const data = body.data ?? {};
  if (!template || !userId) return jsonError(400, 'missing_fields');
  if (!ALLOWED_TEMPLATES.includes(template as TransactionalTemplateName)) {
    return jsonError(400, 'unknown_template');
  }

  const health = await resendDomainHealthCheck(admin);
  if (!health.ok) return jsonResponse(200, { skipped: true, status: health.status });

  const recipient = await getUserEmail(userId);
  if (!recipient) return jsonError(404, 'user_not_found');

  const unsub = `${SITE_URL()}/settings/email-preferences`;

  // Build template-specific data, mint cancel-token for deletion_scheduled.
  const renderInput: Record<string, unknown> = {
    first_name: recipient.first_name,
    unsubscribe_url: unsub,
    ...data,
  };

  if (template === 'deletion_scheduled') {
    const mint = await mintCancelDeletionToken(admin, userId);
    let cancelUrl: string;
    if (mint.ok) {
      cancelUrl = `${SITE_URL()}/cancel-deletion?token=${mint.token}`;
    } else {
      // Vault key not loaded — emit a placeholder URL and log. Email still
      // sends so the user gets the 7-day warning; the cancel link won't
      // verify until plan 22-05 owner sets `CANCEL_DELETION_HMAC_KEY` in
      // Vault (deferred vendor pass per 22-01 SUMMARY.md).
      cancelUrl = `${SITE_URL()}/cancel-deletion?token=pending`;
      console.warn(
        `[lifecycle-transactional] cancel-token mint failed reason=${mint.reason} — placeholder cancel URL sent`,
      );
    }
    renderInput.cancel_url = cancelUrl;
    if (!renderInput.scheduled_deletion_date) {
      const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      renderInput.scheduled_deletion_date = d.toISOString().slice(0, 10);
    }
  }

  let rendered;
  try {
    rendered = renderTemplate(template, renderInput);
  } catch (e) {
    console.warn(
      `[lifecycle-transactional] render failed template=${template} err=${e instanceof Error ? e.name : 'unknown'}`,
    );
    return jsonError(500, 'render_failed');
  }

  const dispatch = await sendResendEmail({
    to: recipient.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  if (!dispatch.ok) {
    return jsonResponse(502, { ok: false, error: dispatch.error ?? 'send_failed' });
  }
  return jsonResponse(200, { ok: true, message_id: dispatch.messageId ?? null });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');
  try {
    return await handleSend(req);
  } catch (e) {
    console.warn('[lifecycle-transactional] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal');
  }
});

export const __internal = { handleSend, setAdminForTest, resetAdminForTest };
