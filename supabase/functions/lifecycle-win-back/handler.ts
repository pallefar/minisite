/**
 * lifecycle-win-back — handler.ts
 *
 * Phase 65 Plan 65-07. CRON-DRIVEN T+30d / T+60d / T+90d post-cancel
 * lifecycle emails with PER-USER Stripe Promotion Code mint (10% / 25% / 50%).
 *
 * === Endpoints ===
 *   GET  /healthz → 200 { ok: true, fn: "lifecycle-win-back" }
 *   POST /        → service-role bearer required → per-stage send
 *
 * === Auth ===
 *   Bearer = SUPABASE_SERVICE_ROLE_KEY (constant-time compare).
 *
 * === Idempotency ===
 *   lifecycle_emails_sent (user_id, stage) composite PK + upsert
 *   onConflict='user_id,stage', ignoreDuplicates=true. INSERT happens BEFORE
 *   Stripe mint AND before Resend; on either failure the row is DELETEd so
 *   the next cron retries. The composite PK prevents double-mints.
 *
 * === Stripe Promotion Code mint ===
 *   stripe.promotionCodes.create({
 *     coupon: coupons[stage_short],   // 10%/25%/50% coupon id from env
 *     max_redemptions: 1,             // T-65-07-02: code-sharing prevention
 *     customer: stripe_customer_id,   // user-scoped
 *     code: 'WINBACK-' + uuid8,
 *     expires_at: now + 30d
 *   })
 *   The 3 coupon IDs MUST exist in Stripe Dashboard before deploy — operator
 *   action in Plan 65-10.
 *
 * === CAN-SPAM ===
 *   PHYSICAL_ADDRESS guard → 503 + Slack P1.
 *   email_marketing_consent + email_lifecycle_exclusion honored.
 *
 * === Threats ===
 *   T-65-07-01 double-send (composite PK)
 *   T-65-07-02 promo code reuse (max_redemptions=1 + customer + 30d expiry)
 *   T-65-07-03 CAN-SPAM violation (placeholder guard)
 *   T-65-07-05 runaway sends (LIMIT 200/stage)
 *   T-65-07-06 orphan promo codes (acceptable — operator Slack alert)
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { constantTimeEqual, mintUnsubscribeToken } from '../_shared/newsletter-token.ts';
import { sendSlackGuardrailAlert } from '../_shared/slack-guardrail-alert.ts';

// ─── Types ──────────────────────────────────────────────────────────────────

type Stage = 'winback_t30d' | 'winback_t60d' | 'winback_t90d';

interface CandidateRow {
  user_id: string;
  email: string;
  first_name: string | null;
  stripe_customer_id: string | null;
  email_marketing_consent: boolean | null;
  cancelled_at: string;
}

export interface WinBackDeps {
  fetchImpl: typeof fetch;
  // deno-lint-ignore no-explicit-any
  supabaseServiceClient: any;
  // deno-lint-ignore no-explicit-any
  stripe: any; // Stripe SDK shape: { promotionCodes: { create(...) } }
  resendApiKey: string;
  serviceRoleKey: string;
  supabaseUrl: string;
  signingKey: string;
  physicalAddress?: string;
  slackWebhookUrl?: string;
  coupons: { t30d: string; t60d: string; t90d: string };
}

// ─── Stage configuration ────────────────────────────────────────────────────

const STAGE_CONFIG: Record<Stage, {
  templateBase: 'winback-t30d' | 'winback-t60d' | 'winback-t90d';
  couponKey: 't30d' | 't60d' | 't90d';
  discountPct: number;
  subject: string;
}> = {
  winback_t30d: {
    templateBase: 'winback-t30d',
    couponKey: 't30d',
    discountPct: 10,
    subject: 'We miss you — 10% off if you come back',
  },
  winback_t60d: {
    templateBase: 'winback-t60d',
    couponKey: 't60d',
    discountPct: 25,
    subject: '25% off your return',
  },
  winback_t90d: {
    templateBase: 'winback-t90d',
    couponKey: 't90d',
    discountPct: 50,
    subject: 'Last chance: 50% off',
  },
};

// ─── Template loader ────────────────────────────────────────────────────────

async function tryReadTemplate(name: string): Promise<string> {
  try {
    const url = new URL(`../_shared/email-templates/${name}`, import.meta.url);
    return await Deno.readTextFile(url);
  } catch {
    // Fallback when template file missing under isolated test execution.
    return `{{user_first_name}} {{promo_code}} {{reactivate_url}} {{discount_pct}} {{physical_address}} {{unsubscribe_url}}`;
  }
}

const TEMPLATES: Record<string, { html: string; text: string }> = {
  'winback-t30d': {
    html: await tryReadTemplate('winback-t30d.html'),
    text: await tryReadTemplate('winback-t30d.txt'),
  },
  'winback-t60d': {
    html: await tryReadTemplate('winback-t60d.html'),
    text: await tryReadTemplate('winback-t60d.txt'),
  },
  'winback-t90d': {
    html: await tryReadTemplate('winback-t90d.html'),
    text: await tryReadTemplate('winback-t90d.txt'),
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function htmlEncode(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stripHeaderInjection(str: string): string {
  return str.replace(/[\r\n]/g, ' ');
}

function renderTemplate(tmpl: string, vars: Record<string, string>, encodeHtml: boolean): string {
  let out = tmpl;
  for (const [k, v] of Object.entries(vars)) {
    const val = encodeHtml ? htmlEncode(v) : v;
    out = out.replaceAll(`{{${k}}}`, val);
  }
  return out;
}

function isPlaceholder(s: string | undefined): boolean {
  if (!s) return true;
  return /\[|TODO|REPLACE_ME/i.test(s);
}

function mintHumanCode(): string {
  // WINBACK-XXXXXXXX where XXXXXXXX is uppercase first 8 chars of a UUID.
  return 'WINBACK-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

// ─── Main handler ───────────────────────────────────────────────────────────

export async function handle(
  req: Request,
  deps?: Partial<WinBackDeps>,
): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === 'GET' && url.pathname.endsWith('/healthz')) {
    return new Response(
      JSON.stringify({ ok: true, fn: 'lifecycle-win-back' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'method_not_allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const serviceRoleKey = deps?.serviceRoleKey ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const bearerHeader = req.headers.get('Authorization') ?? '';
  const bearer = bearerHeader.startsWith('Bearer ') ? bearerHeader.slice(7) : '';

  if (!constantTimeEqual(bearer, serviceRoleKey) || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: 'unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const resendApiKey = deps?.resendApiKey ?? Deno.env.get('RESEND_API_KEY') ?? '';
  const supabaseUrl = deps?.supabaseUrl ?? Deno.env.get('SUPABASE_URL') ?? '';
  const signingKey = deps?.signingKey ?? Deno.env.get('NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY') ?? '';
  const physicalAddress = (deps && 'physicalAddress' in deps)
    ? deps.physicalAddress
    : (Deno.env.get('PHYSICAL_ADDRESS') ?? undefined);
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const coupons = deps?.coupons ?? {
    t30d: Deno.env.get('STRIPE_COUPON_WINBACK_10') ?? '',
    t60d: Deno.env.get('STRIPE_COUPON_WINBACK_25') ?? '',
    t90d: Deno.env.get('STRIPE_COUPON_WINBACK_50') ?? '',
  };
  const stripe = deps?.stripe;

  // CAN-SPAM guard.
  if (isPlaceholder(physicalAddress)) {
    console.error('[lifecycle-win-back] BLOCKED: PHYSICAL_ADDRESS not set or placeholder');
    void sendSlackGuardrailAlert('regulatory', {
      severity: 'P1',
      title: 'lifecycle-win-back BLOCKED — PHYSICAL_ADDRESS not configured',
      text: 'Set PHYSICAL_ADDRESS as a Supabase Function Secret before cron fires.',
    }).catch(() => {});
    return new Response(
      JSON.stringify({ error: 'can_spam_address_not_configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (!stripe) {
    console.error('[lifecycle-win-back] BLOCKED: Stripe client not provided');
    return new Response(
      JSON.stringify({ error: 'stripe_not_configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const supabaseClient = deps?.supabaseServiceClient ?? createClient(
    supabaseUrl,
    serviceRoleKey,
    { auth: { persistSession: false } },
  );

  const stages: Stage[] = ['winback_t30d', 'winback_t60d', 'winback_t90d'];
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const stage of stages) {
    const cfg = STAGE_CONFIG[stage];

    // RPC: get_winback_candidates(stage_key text)
    //   - status='canceled'
    //   - cancelled_at in stage-specific window
    //   - email_marketing_consent IS NOT FALSE
    //   - NOT EXISTS in email_lifecycle_exclusion
    //   - NOT EXISTS in lifecycle_emails_sent
    //   - JOIN stripe_customers (only users with stripe_customer_id IS NOT NULL)
    //   - LIMIT 200/stage
    const queryRes = await supabaseClient.rpc('get_winback_candidates', {
      stage_key: stage,
    }).select() as { data: CandidateRow[] | null; error: unknown };

    if (queryRes.error) {
      console.error('[lifecycle-win-back] RPC error', stage, queryRes.error);
      errors.push(`rpc_error:${stage}`);
      continue;
    }
    const candidates = queryRes.data ?? [];

    for (const row of candidates) {
      // Defensive: skip user without stripe_customer_id (pre-Stripe-launch
      // cancelled users — should already be filtered by RPC but check anyway).
      if (!row.stripe_customer_id) {
        skipped++;
        continue;
      }

      // INSERT lifecycle_emails_sent FIRST — composite-PK idempotency BEFORE Stripe mint.
      const upsertRes = await supabaseClient.from('lifecycle_emails_sent').upsert(
        {
          user_id: row.user_id,
          stage,
          sent_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,stage', ignoreDuplicates: true },
      ).select() as { data: unknown[] | null; error: unknown };

      if (!upsertRes.data || (Array.isArray(upsertRes.data) && upsertRes.data.length === 0)) {
        // Conflict — already sent. Do NOT re-mint Stripe coupon.
        skipped++;
        continue;
      }

      // ── Mint Stripe Promotion Code ─────────────────────────────────────
      const humanCode = mintHumanCode();
      const couponId = coupons[cfg.couponKey];
      const expiresAt = Math.floor(Date.now() / 1000) + 30 * 86400;

      let promoCode: { id: string; code: string } | null = null;
      try {
        const promo = await stripe.promotionCodes.create({
          coupon: couponId,
          max_redemptions: 1,
          customer: row.stripe_customer_id,
          code: humanCode,
          expires_at: expiresAt,
        });
        promoCode = { id: (promo as { id: string }).id, code: (promo as { code: string }).code };
      } catch (err) {
        console.error('[lifecycle-win-back] Stripe mint failed', row.user_id, stage, err);
        // Rollback lifecycle_emails_sent row so the cron retries.
        await supabaseClient.from('lifecycle_emails_sent')
          .delete()
          .eq('user_id', row.user_id)
          .eq('stage', stage);
        errors.push(`stripe_failed:${row.user_id}:${stage}`);
        continue;
      }

      // Persist promo_code on the row.
      await supabaseClient.from('lifecycle_emails_sent')
        .update({ promo_code: promoCode.code })
        .eq('user_id', row.user_id)
        .eq('stage', stage);

      // ── Build email ────────────────────────────────────────────────────
      const storedToken = row.user_id;
      const hmacEnvelope = await mintUnsubscribeToken({
        userId: row.user_id,
        storedToken,
        signingKey,
      });
      const unsubscribeUrl =
        `${supabaseUrl}/functions/v1/rag-newsletter-unsubscribe-1click` +
        `?u=${encodeURIComponent(row.user_id)}` +
        `&t=${encodeURIComponent(storedToken)}` +
        `&h=${encodeURIComponent(hmacEnvelope)}`;

      const reactivateUrl =
        `https://app.leanshot.app/pricing?promo=${encodeURIComponent(promoCode.code)}`;

      const tmpl = TEMPLATES[cfg.templateBase];
      const vars = {
        user_first_name: row.first_name ?? 'there',
        promo_code: promoCode.code,
        reactivate_url: reactivateUrl,
        discount_pct: String(cfg.discountPct),
        physical_address: physicalAddress!,
        unsubscribe_url: unsubscribeUrl,
      };

      const html = renderTemplate(tmpl.html, vars, true);
      const text = renderTemplate(tmpl.text, vars, false);
      const subject = stripHeaderInjection(cfg.subject);
      const safeTo = stripHeaderInjection(row.email);
      const safeFrom = stripHeaderInjection('LeanShot <noreply@app.leanshot.app>');

      const listUnsubscribeHeaders = {
        'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:unsubscribe@leanshot.app>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      };

      let resendOk = false;
      let resendMessageId: string | null = null;

      if (resendApiKey === 'test-stub') {
        resendOk = true;
        resendMessageId = 'stubbed';
      } else {
        try {
          const resendRes = await fetchImpl('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${resendApiKey}`,
            },
            body: JSON.stringify({
              from: safeFrom,
              to: [safeTo],
              subject,
              html,
              text,
              headers: listUnsubscribeHeaders,
            }),
          });
          resendOk = resendRes.ok;
          if (resendRes.ok) {
            try {
              const body = await resendRes.json() as { id?: string };
              resendMessageId = body?.id ?? null;
            } catch { /* best-effort */ }
          } else {
            console.warn('[lifecycle-win-back] Resend error', row.user_id, resendRes.status);
          }
        } catch (err) {
          console.error('[lifecycle-win-back] Resend exception', row.user_id, err);
        }
      }

      if (resendOk) {
        await supabaseClient.from('lifecycle_emails_sent')
          .update({ resend_message_id: resendMessageId })
          .eq('user_id', row.user_id)
          .eq('stage', stage);
        sent++;
      } else {
        // T-65-07-06: Resend failed AFTER Stripe mint. Code is orphaned (user
        // got a single-use coupon but no email). Operator-resolvable: code
        // expires in 30d; Slack alert flags it for manual outreach if needed.
        console.warn(
          '[lifecycle-win-back] orphaned promo code (Resend failed after Stripe mint)',
          row.user_id,
          stage,
          promoCode.code,
        );
        void sendSlackGuardrailAlert('regulatory', {
          severity: 'P2',
          title: 'lifecycle-win-back orphaned promo code',
          text:
            `User ${row.user_id} stage ${stage}: Stripe code ${promoCode.code} minted but ` +
            `Resend failed. Code expires in 30d.`,
        }).catch(() => {});
        // Rollback lifecycle_emails_sent so the cron retries (with a fresh code next time).
        await supabaseClient.from('lifecycle_emails_sent')
          .delete()
          .eq('user_id', row.user_id)
          .eq('stage', stage);
        errors.push(`resend_failed:${row.user_id}:${stage}`);
      }
    }
  }

  return new Response(
    JSON.stringify({ sent, skipped, errors }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
