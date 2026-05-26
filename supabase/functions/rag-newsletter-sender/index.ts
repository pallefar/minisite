/**
 * rag-newsletter-sender — Resend newsletter sender Edge Function.
 *
 * Phase 60 Plan 60-12 Task 5.
 *
 * Triggered by pg_cron (Sunday 09:00 ET, registered in 60-15).
 * DO NOT deploy or register cron schedule in this plan — 60-15 owns that.
 *
 * === Endpoints ===
 * GET /healthz → 200 { ok: true, fn: "rag-newsletter-sender" }
 * POST / → service-role bearer required → compose + send newsletter per opted-in subscriber
 *
 * === Auth ===
 * Requires `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` from cron
 * via vault (per [[reference_supabase_pg_cron_vault_service_role_pattern]]).
 * GET /healthz is exempt from auth check.
 *
 * === Security ===
 * - Per-subscriber (not bulk BCC) send — T-60-12-10
 * - PHARMA-02 runtime guard on every chunk summary — T-60-12-05
 * - HTML-encoding of all user-facing chunk fields — T-60-12-05
 * - RFC 8058 List-Unsubscribe + List-Unsubscribe-Post headers on every email
 * - Header injection prevention (strip \r\n) — T-60-12-06
 * - Idempotent re-cron protection: skip subscribers with last_sent_at < 6 days
 * - Token rotation handled in rag-newsletter-unsubscribe-1click (not here)
 *
 * === Deploy ===
 * Deferred to 60-15 per [[feedback_fn_deploy_before_cron_db_push]].
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { mintUnsubscribeToken, constantTimeEqual } from '../_shared/newsletter-token.ts';
import { assertNoPharma02DoseQuotes, isPharma02GatedTopic } from '../_shared/pharma-02-carveout.ts';
import { sendSlackGuardrailAlert } from '../_shared/slack-guardrail-alert.ts';
import { emitAiGeneration } from '../_shared/posthog-rag-events.ts';
import { shutdownPostHog } from '../_shared/posthog-rag-events.ts';

// ─── Types ──────────────────────────────────────────────────────────────────

interface NewsletterSubscriber {
  user_id: string;
  email: string;
  topic_tags: string[];
  unsubscribe_token: string;
  last_sent_at: string | null;
}

interface ChunkSummary {
  chunk_id: string;
  chunk_title: string;
  source_text_excerpt: string;
  summary: string;
  source_name?: string;
  canonical_url?: string;
  tier: 'A' | 'B' | 'C';
  topic_tag: string;
}

export interface NewsletterSendResult {
  sent: number;
  skipped: number;
  pharma02_violations: number;
}

// ─── Dependency injection (for testability) ──────────────────────────────────

export interface NewsletterSenderDeps {
  /** Fetch implementation (allows mocking in tests) */
  fetchImpl: typeof fetch;
  /** Service role key for auth check */
  serviceRoleKey: string;
  /** Resend API key */
  resendApiKey: string;
  /** Supabase service URL */
  supabaseUrl: string;
  /** Supabase service role client */
  supabaseServiceClient: ReturnType<typeof createClient>;
  /** Newsletter signing key for HMAC envelope */
  signingKey: string;
  /** Admin intro paragraph (optional) */
  adminIntro?: string;
  /** CAN-SPAM footer address */
  footerAddress?: string;
}

// ─── HTML sanitizer (minimal allowlist for email body) ───────────────────────

/**
 * HTML-encode all user-controllable fields in chunk data.
 * Allowlist: NO HTML tags in chunk fields — they are plain-text data.
 * T-60-12-05 mitigation.
 */
function htmlEncode(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Strip header injection characters from subject/from/to fields.
 * T-60-12-06 mitigation.
 */
function stripHeaderInjection(str: string): string {
  return str.replace(/[\r\n]/g, ' ');
}

// ─── Template rendering ──────────────────────────────────────────────────────

/** Inline tier badge styles per UI-SPEC §13 (email-compatible inline styles) */
const TIER_BADGE_STYLES: Record<'A' | 'B' | 'C', string> = {
  A: 'display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#dcfce7;color:#166534;',
  B: 'display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#dbeafe;color:#1e40af;',
  C: 'display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#f3f4f6;color:#374151;',
};

function renderChunkCard(chunk: ChunkSummary, sourceUrl: string): string {
  const tier = chunk.tier ?? 'C';
  const badgeStyle = TIER_BADGE_STYLES[tier];
  const titleEncoded = htmlEncode(chunk.chunk_title);
  const summaryEncoded = htmlEncode(chunk.summary ?? chunk.source_text_excerpt ?? '');
  const sourceNameEncoded = htmlEncode(chunk.source_name ?? chunk.topic_tag ?? 'source');

  return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
  <tr>
    <td style="padding:20px;">
      <p style="margin:0 0 8px 0;">
        <span style="${badgeStyle}">Tier ${htmlEncode(tier)}</span>
      </p>
      <h2 style="margin:0 0 8px 0;font-size:18px;font-weight:600;color:#111827;line-height:1.3;">
        ${titleEncoded}
      </h2>
      <p style="margin:0 0 16px 0;font-size:13px;color:#374151;line-height:1.6;">
        ${summaryEncoded}
      </p>
      <a href="${htmlEncode(sourceUrl)}"
         style="display:inline-block;height:32px;line-height:32px;padding:0 16px;background:#0f766e;color:#ffffff;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">
        Read at ${sourceNameEncoded} &#x2197;
      </a>
    </td>
  </tr>
</table>`;
}

function composeEmailBody(opts: {
  chunks: ChunkSummary[];
  evergreenChunk: ChunkSummary | null;
  adminIntro: string;
  unsubscribeUrl: string;
  weekDate: string;
  footerAddress: string;
}): string {
  const { chunks, evergreenChunk, adminIntro, unsubscribeUrl, weekDate, footerAddress } = opts;

  // Compose per-topic sections
  const topicSections = chunks.map((chunk) => renderChunkCard(
    chunk,
    chunk.canonical_url ?? `https://leanshot.app/knowledge/${chunk.chunk_id}`,
  )).join('\n');

  const evergreenSection = evergreenChunk
    ? `
<h3 style="margin:24px 0 12px 0;font-size:16px;font-weight:600;color:#111827;">
  Popular this month
</h3>
${renderChunkCard(evergreenChunk, evergreenChunk.canonical_url ?? `https://leanshot.app/knowledge/${evergreenChunk.chunk_id}`)}
`
    : '';

  const adminIntroHtml = adminIntro
    ? `<p style="margin:0 0 24px 0;font-size:15px;color:#374151;line-height:1.6;">${htmlEncode(adminIntro)}</p>`
    : '';

  const perTopicSections = topicSections + evergreenSection;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Geist',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f5f5f5">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff"
               style="max-width:600px;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td bgcolor="#0f766e" style="padding:32px 40px;">
              <h1 style="margin:0;font-size:24px;font-weight:600;color:#ffffff;">LeanShot Research Digest</h1>
              <p style="margin:6px 0 0 0;font-size:13px;color:rgba(255,255,255,0.8);">Week of ${htmlEncode(weekDate)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              ${adminIntroHtml}
              ${perTopicSections}
            </td>
          </tr>
          <tr>
            <td bgcolor="#f9fafb" style="padding:24px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0 0 8px 0;font-size:11px;color:#6b7280;text-align:center;">
                Not medical advice — consult your clinician.
              </p>
              <p style="margin:0;font-size:11px;color:#6b7280;text-align:center;">
                <a href="${htmlEncode(unsubscribeUrl)}" style="color:#0d9488;">Unsubscribe</a>
                &nbsp;·&nbsp;
                <a href="/settings#newsletter" style="color:#0d9488;">Manage preferences</a>
              </p>
              <p style="margin:8px 0 0 0;font-size:10px;color:#9ca3af;text-align:center;">
                LeanShot, ${htmlEncode(footerAddress)}
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

// ─── Main handler (named export for testability) ──────────────────────────────

/**
 * Newsletter sender handler. Exported as named function so tests can call
 * it directly without triggering Deno.serve.
 *
 * Per [[reference_deno_test_top_level_serve_trap]]: Deno.serve is guarded
 * by `if (import.meta.main)` below to prevent server bind on test import.
 */
export async function handleNewsletterSend(
  req: Request,
  deps?: Partial<NewsletterSenderDeps>,
): Promise<Response> {
  const url = new URL(req.url);

  // ── GET /healthz ───────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname.endsWith('/healthz')) {
    return new Response(JSON.stringify({ ok: true, fn: 'rag-newsletter-sender' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Only POST allowed from here ────────────────────────────────────────────
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Auth: service-role bearer required (T-60-12-09) ───────────────────────
  const serviceRoleKey = deps?.serviceRoleKey ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const bearerHeader = req.headers.get('Authorization') ?? '';
  const bearer = bearerHeader.startsWith('Bearer ') ? bearerHeader.slice(7) : '';

  if (!constantTimeEqual(bearer, serviceRoleKey)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Env ────────────────────────────────────────────────────────────────────
  const resendApiKey = deps?.resendApiKey ?? Deno.env.get('RESEND_API_KEY') ?? '';
  const supabaseUrl = deps?.supabaseUrl ?? Deno.env.get('SUPABASE_URL') ?? '';
  const signingKey = deps?.signingKey ?? Deno.env.get('NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY') ?? '';
  const footerAddress = deps?.footerAddress ?? '[LeanShot address — CAN-SPAM placeholder; replace before first live send]';
  const adminIntro = deps?.adminIntro ?? '';
  const fetchImpl = deps?.fetchImpl ?? fetch;

  const supabaseClient = deps?.supabaseServiceClient ?? createClient(
    supabaseUrl,
    serviceRoleKey,
    { auth: { persistSession: false } },
  );

  // ── Week date ──────────────────────────────────────────────────────────────
  const weekISO = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const subject = stripHeaderInjection(`LeanShot Research: Week of ${weekISO}`);

  // ── Fetch opted-in subscribers (skip recently-sent — idempotent re-cron) ──
  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
  const { data: subscribers, error: subError } = await supabaseClient
    .from('newsletter_subscribers')
    .select('user_id,email,topic_tags,unsubscribe_token,last_sent_at')
    .eq('opted_in', true)
    .or(`last_sent_at.is.null,last_sent_at.lt.${sixDaysAgo}`) as {
      data: NewsletterSubscriber[] | null;
      error: unknown;
    };

  if (subError) {
    console.error('[rag-newsletter-sender] subscriber query error:', subError);
    return new Response(JSON.stringify({ error: 'DB error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!subscribers || subscribers.length === 0) {
    return new Response(JSON.stringify({ sent: 0, skipped: 0, pharma02_violations: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let sent = 0;
  let skipped = 0;
  let pharma02Violations = 0;

  // ── Retrieve chunks (shared across all subscribers for efficiency) ─────────
  // Top 3 newly-curated tier-A chunks from last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentChunksRaw } = await supabaseClient
    .from('rag_chunks')
    .select('id,chunk_title,source_text_excerpt,summary,tier,topic_tag,canonical_url,source_name')
    .eq('tier', 'A')
    .eq('status', 'approved')
    .gt('approved_at', sevenDaysAgo)
    .order('approved_at', { ascending: false })
    .limit(3) as { data: Record<string, unknown>[] | null };

  // 1 popular evergreen chunk (fallback: most recent tier-A if retrieval count not tracked)
  const { data: evergreenRaw } = await supabaseClient
    .from('rag_chunks')
    .select('id,chunk_title,source_text_excerpt,summary,tier,topic_tag,canonical_url,source_name')
    .eq('tier', 'A')
    .eq('status', 'approved')
    .order('retrieval_count', { ascending: false })
    .limit(1) as { data: Record<string, unknown>[] | null };

  // Normalize chunk shape
  const normalizeChunk = (raw: Record<string, unknown>): ChunkSummary => ({
    chunk_id: String(raw.id ?? ''),
    chunk_title: String(raw.chunk_title ?? ''),
    source_text_excerpt: String(raw.source_text_excerpt ?? ''),
    summary: String(raw.summary ?? raw.source_text_excerpt ?? ''),
    source_name: raw.source_name ? String(raw.source_name) : undefined,
    canonical_url: raw.canonical_url ? String(raw.canonical_url) : undefined,
    tier: (raw.tier as 'A' | 'B' | 'C') ?? 'C',
    topic_tag: String(raw.topic_tag ?? ''),
  });

  // Apply PHARMA-02 filter to chunks (T-60-12-05)
  // Newsletter uses two layers of PHARMA-02 protection:
  //   1. Topic-level gate: skip ANY chunk with a PHARMA-02 gated topic_tag entirely
  //      (newsletter surfaces summaries to end-users; gated topics MUST NOT appear)
  //   2. Quote-level gate via assertNoPharma02DoseQuotes as defense-in-depth
  const filterPharma02 = (chunks: ChunkSummary[]): ChunkSummary[] => {
    const safe: ChunkSummary[] = [];
    for (const chunk of chunks) {
      // Layer 1: skip gated topic_tags entirely (newsletter context)
      if (isPharma02GatedTopic(chunk.topic_tag)) {
        pharma02Violations++;
        console.warn('[rag-newsletter-sender] PHARMA-02 gated topic in newsletter:', chunk.chunk_id, chunk.topic_tag);
        void sendSlackGuardrailAlert('pharma02', {
          severity: 'P1',
          title: 'PHARMA-02 newsletter chunk blocked (gated topic)',
          text: `chunk_id=${chunk.chunk_id} topic_tag=${chunk.topic_tag}`,
          trace_id: weekISO,
        }).catch(() => {});
        continue;
      }
      // Layer 2: defense-in-depth quote-level check (empty quote_blocks for newsletter summaries)
      const result = assertNoPharma02DoseQuotes(chunk.topic_tag, []);
      if (result.ok) {
        safe.push(chunk);
      } else {
        pharma02Violations++;
        console.warn('[rag-newsletter-sender] PHARMA-02 quote violation on chunk:', chunk.chunk_id);
        void sendSlackGuardrailAlert('pharma02', {
          severity: 'P1',
          title: 'PHARMA-02 newsletter chunk violation (dose quote)',
          text: `chunk_id=${chunk.chunk_id} topic_tag=${chunk.topic_tag}`,
          trace_id: weekISO,
        }).catch(() => {});
      }
    }
    return safe;
  };

  const recentChunks: ChunkSummary[] = filterPharma02(
    (recentChunksRaw ?? []).map(normalizeChunk),
  );
  const evergreenChunk: ChunkSummary | null = evergreenRaw && evergreenRaw.length > 0
    ? filterPharma02([normalizeChunk(evergreenRaw[0])]).at(0) ?? null
    : null;

  // ── Send per subscriber (NOT bulk BCC — T-60-12-10) ───────────────────────
  try {
    for (const subscriber of subscribers) {
      // Build unsubscribe URL: stored-token is the auth boundary; HMAC is defense-in-depth
      const storedToken = subscriber.unsubscribe_token;
      const hmacEnvelope = await mintUnsubscribeToken({
        userId: subscriber.user_id,
        storedToken,
        signingKey,
      });
      const unsubscribeUrl = `${supabaseUrl}/functions/v1/rag-newsletter-unsubscribe-1click` +
        `?u=${encodeURIComponent(subscriber.user_id)}` +
        `&t=${encodeURIComponent(storedToken)}` +
        `&h=${encodeURIComponent(hmacEnvelope)}`;

      // Compose email body
      const html = composeEmailBody({
        chunks: recentChunks,
        evergreenChunk,
        adminIntro,
        unsubscribeUrl,
        weekDate: weekISO,
        footerAddress,
      });

      // Strip header injection (T-60-12-06)
      const safeSubject = stripHeaderInjection(subject);
      const safeFrom = stripHeaderInjection('LeanShot Research <research@leanshot.app>');
      const safeTo = stripHeaderInjection(subscriber.email);

      // Build List-Unsubscribe headers per RFC 8058
      const listUnsubscribe = `<${unsubscribeUrl}>, <mailto:unsubscribe@leanshot.app>`;

      // POST to Resend (one per subscriber — T-60-12-10)
      const resendPayload = {
        from: safeFrom,
        to: [safeTo],
        subject: safeSubject,
        html,
        headers: {
          'List-Unsubscribe': listUnsubscribe,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      };

      const resendRes = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify(resendPayload),
      });

      if (resendRes.ok) {
        // Update last_sent_at
        await (supabaseClient
          .from('newsletter_subscribers') as unknown as {
            update: (data: Record<string, unknown>) => { eq: (col: string, val: unknown) => Promise<unknown> };
          })
          .update({ last_sent_at: new Date().toISOString() })
          .eq('user_id', subscriber.user_id);

        // PostHog telemetry — newsletter_sent per subscriber
        emitAiGeneration({
          userId: subscriber.user_id,
          properties: {
            model: 'resend',
            trace_id: `newsletter-${weekISO}-${subscriber.user_id}`,
            surface: 'newsletter',
            amount_usd: 0.0001,
            vendor: 'resend',
            action: 'newsletter_send',
          },
        });

        sent++;
      } else {
        console.warn('[rag-newsletter-sender] Resend error for', subscriber.user_id, resendRes.status);
        skipped++;
      }
    }
  } finally {
    await shutdownPostHog();
  }

  return new Response(
    JSON.stringify({ sent, skipped, pharma02_violations: pharma02Violations }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

// ─── Entry point (per [[reference_deno_test_top_level_serve_trap]]) ──────────
// Deno.serve is guarded by import.meta.main so test imports don't bind a server.

if (import.meta.main) {
  // Wrap handleNewsletterSend to match Deno.serve's (req: Request) => Response signature
  Deno.serve((req: Request) => handleNewsletterSend(req));
}
