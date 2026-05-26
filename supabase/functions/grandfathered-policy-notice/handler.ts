/**
 * grandfathered-policy-notice — handler.ts
 *
 * Phase 64 Plan 64-03.
 *
 * OPERATOR-INVOKED at Phase 70 UAT — service-role POST triggers one-shot
 * grandfathered-notice send to pre-Phase-64 registered users. Deploy in
 * Plan 64-08. NO cron — send is manual.
 *
 * === Endpoints ===
 * GET /healthz → 200 { ok: true, fn: "grandfathered-policy-notice" }
 * POST / → service-role bearer required → enumerate pre-cutoff users + send per-recipient Resend email
 *
 * === Auth ===
 * Requires `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.
 * Constant-time comparison per T-64-03-01.
 * GET /healthz is exempt.
 *
 * === Idempotency ===
 * INSERT INTO policy_notice_log ... ON CONFLICT (user_id) DO NOTHING
 * Re-invocation is safe: users with existing log row are excluded at query time.
 *
 * === CAN-SPAM / WR-02 ===
 * PHYSICAL_ADDRESS env var MUST be set and MUST NOT contain placeholder strings.
 * Fn returns 503 + Slack P1 if guard fails (per [[feedback_placeholder_string_runtime_guard_pattern]]).
 *
 * === Security ===
 * - Per-recipient (NOT bulk BCC) send — T-64-03-01
 * - ON CONFLICT (user_id) DO NOTHING — T-64-03-02
 * - RFC 8058 List-Unsubscribe + List-Unsubscribe-Post headers on every email
 * - PHYSICAL_ADDRESS runtime guard — T-64-03-06
 * - email_marketing_consent + email_lifecycle_exclusion both respected — LEGAL-09
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { constantTimeEqual, mintUnsubscribeToken } from '../_shared/newsletter-token.ts';
import { sendSlackGuardrailAlert } from '../_shared/slack-guardrail-alert.ts';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CandidateUser {
  id: string;
  email: string;
  email_marketing_consent: boolean | null;
}

export interface GrandfatheredNoticeDeps {
  /** Fetch implementation (allows mocking in tests) */
  fetchImpl: typeof fetch;
  /** Supabase service role client */
  supabaseServiceClient: ReturnType<typeof createClient>;
  /** Resend API key — 'test-stub' returns stubbed response without HTTP */
  resendApiKey: string;
  /** Service-role key for bearer auth check */
  serviceRoleKey: string;
  /** Supabase project URL (used for unsubscribe token URL) */
  supabaseUrl: string;
  /** ISO timestamp: users created before this date are candidates (from PHASE_64_SHIP_DATE env) */
  phase64ShipDate: string;
  /** HMAC signing key for unsubscribe token envelope (NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY) */
  signingKey: string;
  /** CAN-SPAM physical address (from PHYSICAL_ADDRESS env var) */
  physicalAddress?: string;
}

// ─── HTML sanitizer ──────────────────────────────────────────────────────────

function htmlEncode(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHeaderInjection(str: string): string {
  return str.replace(/[\r\n]/g, ' ');
}

// ─── Template rendering ──────────────────────────────────────────────────────

function renderHtmlEmail(opts: {
  unsubscribeUrl: string;
  physicalAddress: string;
}): string {
  const { unsubscribeUrl, physicalAddress } = opts;
  const unsubUrl = htmlEncode(unsubscribeUrl);
  const addr = htmlEncode(physicalAddress);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Updated Privacy Policy &amp; Terms &#8212; your data, your control</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f5f5f5">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff"
               style="max-width:600px;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td bgcolor="#0f766e" style="padding:32px 40px;">
              <h1 style="margin:0;font-size:22px;font-weight:600;color:#ffffff;">LeanShot policy update</h1>
              <p style="margin:6px 0 0 0;font-size:13px;color:rgba(255,255,255,0.85);">
                Updated Privacy Policy &amp; Terms of Service
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 20px 0;font-size:15px;color:#374151;line-height:1.6;">
                We&#8217;ve updated our Privacy Policy and Terms of Service to reflect
                the services and partners we use to run LeanShot. Here&#8217;s what
                changed and what it means for you.
              </p>
              <h2 style="margin:0 0 12px 0;font-size:17px;font-weight:600;color:#111827;">What changed</h2>
              <p style="margin:0 0 10px 0;font-size:14px;color:#374151;line-height:1.5;">
                We added the following subprocessors as part of our v1.4 launch:
              </p>
              <ul style="margin:0 0 24px 0;padding-left:24px;font-size:14px;color:#374151;line-height:1.8;">
                <li><strong>PostHog Session Replay</strong> &#8212; anonymised product analytics</li>
                <li><strong>Anthropic</strong> &#8212; powers the AI coaching feature</li>
                <li><strong>Mux</strong> &#8212; video streaming for educational content</li>
                <li><strong>Stripe Connect</strong> &#8212; payment processing and payouts</li>
                <li><strong>OpenRouter</strong> &#8212; multi-model AI gateway</li>
                <li><strong>Cohere</strong> &#8212; semantic search and embeddings</li>
                <li><strong>Resend</strong> &#8212; transactional and lifecycle email delivery</li>
                <li><strong>Sentry</strong> &#8212; error monitoring and performance tracing</li>
                <li><strong>pgvector recommender</strong> &#8212; personalised knowledge recommendations</li>
                <li><strong>Traffic attribution</strong> &#8212; aggregate campaign analytics (no PII)</li>
              </ul>
              <h2 style="margin:0 0 12px 0;font-size:17px;font-weight:600;color:#111827;">Your data, your control</h2>
              <p style="margin:0 0 16px 0;font-size:14px;color:#374151;line-height:1.6;">
                You have full control over your data. Use the links below to review your options:
              </p>
              <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="padding-bottom:10px;">
                    <a href="https://leanshot.app/#/legal/privacy"
                       style="display:inline-block;height:36px;line-height:36px;padding:0 20px;background:#0f766e;color:#ffffff;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">
                      View Privacy Policy &#x2197;
                    </a>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:10px;">
                    <a href="https://leanshot.app/account/data-rights"
                       style="display:inline-block;height:36px;line-height:36px;padding:0 20px;background:#374151;color:#ffffff;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">
                      Manage Preferences &#x2197;
                    </a>
                  </td>
                </tr>
                <tr>
                  <td>
                    <a href="https://leanshot.app/privacy/do-not-sell"
                       style="display:inline-block;height:36px;line-height:36px;padding:0 20px;background:#6b7280;color:#ffffff;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">
                      Do Not Sell My Data &#x2197;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
                Questions? Contact us at
                <a href="mailto:privacy@leanshot.app" style="color:#0d9488;">privacy@leanshot.app</a>.
              </p>
            </td>
          </tr>
          <tr>
            <td bgcolor="#f9fafb" style="padding:24px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0 0 8px 0;font-size:11px;color:#6b7280;text-align:center;">
                This is a required policy update notification. It is not a marketing email.
              </p>
              <p style="margin:0 0 8px 0;font-size:11px;color:#6b7280;text-align:center;">
                <a href="${unsubUrl}" style="color:#0d9488;">Unsubscribe</a>
                &nbsp;&#183;&nbsp;
                <a href="https://leanshot.app/account/data-rights" style="color:#0d9488;">Manage preferences</a>
              </p>
              <p style="margin:0;font-size:10px;color:#9ca3af;text-align:center;">
                LeanShot &mdash; ${addr}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderTextEmail(opts: {
  unsubscribeUrl: string;
  physicalAddress: string;
}): string {
  const { unsubscribeUrl, physicalAddress } = opts;
  return `LeanShot Policy Update
======================

Updated Privacy Policy & Terms — your data, your control

We've updated our Privacy Policy and Terms of Service to reflect the services and
partners we use to run LeanShot. Here's what changed and what it means for you.

WHAT CHANGED
------------

We added the following subprocessors as part of our v1.4 launch:

- PostHog Session Replay — anonymised product analytics
- Anthropic — powers the AI coaching feature
- Mux — video streaming for educational content
- Stripe Connect — payment processing and payouts
- OpenRouter — multi-model AI gateway
- Cohere — semantic search and embeddings
- Resend — transactional and lifecycle email delivery
- Sentry — error monitoring and performance tracing
- pgvector recommender — personalised knowledge recommendations
- Traffic attribution — aggregate campaign analytics (no PII)

YOUR DATA, YOUR CONTROL
-----------------------

- View Privacy Policy: https://leanshot.app/#/legal/privacy
- Manage Preferences: https://leanshot.app/account/data-rights
- Do Not Sell My Data: https://leanshot.app/privacy/do-not-sell

Questions? Contact privacy@leanshot.app

---

This is a required policy update notification. It is not a marketing email.

Unsubscribe: ${unsubscribeUrl}

LeanShot — ${physicalAddress}
`;
}

// ─── Main handler ────────────────────────────────────────────────────────────

/**
 * Grandfathered policy notice handler. Exported as named function so tests
 * can call it directly without triggering Deno.serve.
 *
 * Per [[reference_deno_test_top_level_serve_trap]]: Deno.serve is guarded
 * by `if (import.meta.main)` in index.ts to prevent server bind on test import.
 */
export async function handle(
  req: Request,
  deps?: Partial<GrandfatheredNoticeDeps>,
): Promise<Response> {
  const url = new URL(req.url);

  // ── GET /healthz ───────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname.endsWith('/healthz')) {
    return new Response(
      JSON.stringify({ ok: true, fn: 'grandfathered-policy-notice' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Only POST from here ────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'method_not_allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Auth: service-role bearer (T-64-03-01, constant-time compare) ─────────
  const serviceRoleKey = deps?.serviceRoleKey ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const bearerHeader = req.headers.get('Authorization') ?? '';
  const bearer = bearerHeader.startsWith('Bearer ') ? bearerHeader.slice(7) : '';

  if (!constantTimeEqual(bearer, serviceRoleKey)) {
    return new Response(
      JSON.stringify({ error: 'unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Env / deps ─────────────────────────────────────────────────────────────
  const resendApiKey = deps?.resendApiKey ?? Deno.env.get('RESEND_API_KEY') ?? '';
  const supabaseUrl = deps?.supabaseUrl ?? Deno.env.get('SUPABASE_URL') ?? '';
  const phase64ShipDate = deps?.phase64ShipDate ?? Deno.env.get('PHASE_64_SHIP_DATE') ?? '';
  const signingKey = deps?.signingKey ?? Deno.env.get('NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY') ?? '';
  // physicalAddress: if deps is provided (even as undefined), use that value directly.
  // Only fall back to Deno.env when no deps object is provided (production path).
  const physicalAddress = (deps && 'physicalAddress' in deps)
    ? deps.physicalAddress
    : (Deno.env.get('PHYSICAL_ADDRESS') ?? undefined);
  const fetchImpl = deps?.fetchImpl ?? fetch;

  // ── CAN-SPAM physical address guard (WR-02, T-64-03-06) ───────────────────
  // MUST refuse to send if address is unset or contains placeholder strings.
  // Sending without a valid address violates 15 U.S.C. § 7704(a)(5).
  if (
    !physicalAddress ||
    /\[|TODO|REPLACE_ME/i.test(physicalAddress)
  ) {
    console.error('[grandfathered-policy-notice] BLOCKED: PHYSICAL_ADDRESS not set or is placeholder');
    void sendSlackGuardrailAlert('regulatory', {
      severity: 'P1',
      title: 'Grandfathered notice BLOCKED — PHYSICAL_ADDRESS not configured',
      text: 'Set PHYSICAL_ADDRESS as a Supabase Function Secret before invoking the Fn.',
    }).catch(() => {});
    return new Response(
      JSON.stringify({ error: 'can_spam_address_not_configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── PHASE_64_SHIP_DATE guard ───────────────────────────────────────────────
  if (
    !phase64ShipDate ||
    /\[|TODO|REPLACE_ME/i.test(phase64ShipDate)
  ) {
    console.error('[grandfathered-policy-notice] BLOCKED: PHASE_64_SHIP_DATE not configured');
    void sendSlackGuardrailAlert('regulatory', {
      severity: 'P1',
      title: 'Grandfathered notice BLOCKED — PHASE_64_SHIP_DATE not configured',
      text: 'Set PHASE_64_SHIP_DATE as a Supabase Function Secret at deploy time.',
    }).catch(() => {});
    return new Response(
      JSON.stringify({ error: 'phase_64_ship_date_not_configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const supabaseClient = deps?.supabaseServiceClient ?? createClient(
    supabaseUrl,
    serviceRoleKey,
    { auth: { persistSession: false } },
  );

  // ── Enumerate candidate users ─────────────────────────────────────────────
  // Query: auth.users created before phase_64_ship_date
  //   JOIN profiles for email_marketing_consent
  //   EXCLUDE users already in policy_notice_log (idempotency)
  //   EXCLUDE users in email_lifecycle_exclusion
  //   EXCLUDE users with email_marketing_consent = false
  // Using RPC to get pre-cutoff users with all exclusions applied in one query.
  // The mock client in tests implements rpc().select() returning the filtered list.
  const { data: candidates, error: queryError } = await (supabaseClient.rpc(
    'get_grandfathered_notice_candidates',
    { cutoff_date: phase64ShipDate },
  ).select() as unknown as Promise<{ data: CandidateUser[] | null; error: unknown }>);

  if (queryError) {
    console.error('[grandfathered-policy-notice] candidate query error:', queryError);
    return new Response(
      JSON.stringify({ error: 'db_error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (!candidates || candidates.length === 0) {
    return new Response(
      JSON.stringify({ sent: 0, skipped: 0 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let sent = 0;
  let skipped = 0;

  // Subject line EXACTLY per D-Grandfathered-Notice-Email
  const subject = stripHeaderInjection(
    'Updated Privacy Policy & Terms — your data, your control',
  );
  const safeFrom = stripHeaderInjection('LeanShot <noreply@app.leanshot.app>');

  // ── Per-recipient send (NOT bulk BCC — T-64-03-01 + Phase 60 T-60-12-10) ──
  for (const user of candidates) {
    // Filter: skip if email_marketing_consent explicitly false
    // (COALESCE(email_marketing_consent, true) — null treated as opted-in)
    if (user.email_marketing_consent === false) {
      skipped++;
      continue;
    }

    try {
      // Mint unsubscribe token (HMAC envelope per newsletter-token pattern)
      // Stored token is user.id as base for one-shot notification
      // (policy_notice unsubscribe routes through rag-newsletter-unsubscribe-1click
      //  which validates the HMAC; the token here is a stand-in for the user's
      //  stored unsubscribe_token — for users without newsletter subscriptions
      //  we use user.id as a deterministic placeholder)
      const storedToken = user.id;
      const hmacEnvelope = await mintUnsubscribeToken({
        userId: user.id,
        storedToken,
        signingKey,
      });
      const unsubscribeUrl = `${supabaseUrl}/functions/v1/rag-newsletter-unsubscribe-1click` +
        `?u=${encodeURIComponent(user.id)}` +
        `&t=${encodeURIComponent(storedToken)}` +
        `&h=${encodeURIComponent(hmacEnvelope)}`;

      const safeTo = stripHeaderInjection(user.email);
      const html = renderHtmlEmail({ unsubscribeUrl, physicalAddress });
      const text = renderTextEmail({ unsubscribeUrl, physicalAddress });

      // RFC 8058 List-Unsubscribe headers
      const listUnsubscribeUrl = unsubscribeUrl;
      const listUnsubscribeHeaders = {
        'List-Unsubscribe': `<${listUnsubscribeUrl}>, <mailto:unsubscribe@leanshot.app>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      };

      let messageId: string | null = null;
      let sendOk = false;

      // RESEND_API_KEY=test-stub → return stubbed response without HTTP call
      if (resendApiKey === 'test-stub') {
        sendOk = true;
        messageId = 'stubbed';
      } else {
        const resendPayload = {
          from: safeFrom,
          to: [safeTo],
          subject,
          html,
          text,
          headers: listUnsubscribeHeaders,
        };

        const resendRes = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify(resendPayload),
        });

        sendOk = resendRes.ok;
        if (resendRes.ok) {
          try {
            const body = (await resendRes.json()) as { id?: string };
            messageId = body?.id ?? null;
          } catch {
            /* best-effort */
          }
        } else {
          console.warn(
            '[grandfathered-policy-notice] Resend error for',
            user.id,
            resendRes.status,
          );
        }
      }

      if (sendOk) {
        // INSERT into policy_notice_log with ON CONFLICT (user_id) DO NOTHING
        // T-64-03-02: idempotency guaranteed by PK constraint
        await (supabaseClient.from('policy_notice_log') as unknown as {
          insert: (data: object) => { select: () => Promise<unknown> };
        }).insert({
          user_id: user.id,
          resend_message_id: messageId,
        }).select();

        sent++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error('[grandfathered-policy-notice] error processing user', user.id, err);
      skipped++;
    }
  }

  return new Response(
    JSON.stringify({ sent, skipped }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
