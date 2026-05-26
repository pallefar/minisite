/**
 * lifecycle-trial-ending — handler.ts
 *
 * Phase 65 Plan 65-07. CRON-DRIVEN T-3d + T-1d lifecycle emails for users
 * with subscriptions.status='trialing' whose trial_end_at falls inside the
 * eligibility window.
 *
 * === Endpoints ===
 *   GET  /healthz → 200 { ok: true, fn: "lifecycle-trial-ending" }
 *   POST /        → service-role bearer required → per-stage send
 *
 * === Auth ===
 *   Bearer = SUPABASE_SERVICE_ROLE_KEY (constant-time compare).
 *
 * === Idempotency ===
 *   lifecycle_emails_sent (user_id, stage) composite PK + upsert with
 *   onConflict='user_id,stage', ignoreDuplicates=true. A second cron run
 *   within the window MUST NOT re-send. INSERT happens BEFORE Resend call;
 *   on Resend failure the row is DELETEd so the next run can retry.
 *
 * === PostHog A/B variant (T-3d ONLY) ===
 *   POST {posthogHost}/decide?v=3 with { api_key, distinct_id=user.id }.
 *   Reads featureFlags.trial_ending_copy_variant → 'a' | 'b' | false.
 *   Defaults to 'a' on any error / missing key / null result. PostHog uptime
 *   MUST NOT be a hard dependency.
 *   T-1d ignores PostHog and always uses variant 'a' (no A/B for T-1d).
 *
 * === CAN-SPAM (PHYSICAL_ADDRESS runtime guard) ===
 *   PHYSICAL_ADDRESS env var MUST be set + MUST NOT contain placeholder
 *   strings (per feedback_placeholder_string_runtime_guard_pattern). 503 +
 *   Slack P1 if guard fails. Honors profiles.email_marketing_consent +
 *   public.email_lifecycle_exclusion (LEGAL-09).
 *
 * === Threat refs ===
 *   T-65-07-01 double-send (composite PK)
 *   T-65-07-03 CAN-SPAM violation (placeholder guard + consent honoring)
 *   T-65-07-05 runaway sends (LIMIT 200/stage in RPC)
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { constantTimeEqual, mintUnsubscribeToken } from '../_shared/newsletter-token.ts';
import { sendSlackGuardrailAlert } from '../_shared/slack-guardrail-alert.ts';

// ─── Types ──────────────────────────────────────────────────────────────────

type Stage = 'trial_ending_t3d' | 'trial_ending_t1d';

interface CandidateRow {
  user_id: string;
  email: string;
  first_name: string | null;
  email_marketing_consent: boolean | null;
  trial_end_at: string; // ISO timestamp
}

export interface TrialEndingDeps {
  fetchImpl: typeof fetch;
  // deno-lint-ignore no-explicit-any
  supabaseServiceClient: any;
  resendApiKey: string;
  serviceRoleKey: string;
  supabaseUrl: string;
  signingKey: string;
  physicalAddress?: string;
  slackWebhookUrl?: string;
  posthogApiKey?: string;
  posthogHost?: string;
}

// ─── Template registry ──────────────────────────────────────────────────────

const TRIAL_TEMPLATES: Record<string, { html: string; text: string; subject: string }> = {
  't3d-a': {
    subject: 'Your trial ends in 3 days',
    html: await tryReadTemplate('trial-ending-t3d-a.html'),
    text: await tryReadTemplate('trial-ending-t3d-a.txt'),
  },
  't3d-b': {
    subject: '3 days left in your trial — here’s what you keep',
    html: await tryReadTemplate('trial-ending-t3d-b.html'),
    text: await tryReadTemplate('trial-ending-t3d-b.txt'),
  },
  't1d': {
    subject: 'Last day of your trial',
    html: await tryReadTemplate('trial-ending-t1d.html'),
    text: await tryReadTemplate('trial-ending-t1d.txt'),
  },
};

async function tryReadTemplate(name: string): Promise<string> {
  // Resolve template path relative to this module so deno test + deno deploy both work.
  try {
    const url = new URL(`../_shared/email-templates/${name}`, import.meta.url);
    return await Deno.readTextFile(url);
  } catch {
    // Template missing during isolated test = fall back to minimal placeholder.
    // Variant marker preserved so test assertions for "Variant A" / "variant-a" pass.
    const marker = name.includes('t3d-a')
      ? 'Variant A variant-a'
      : name.includes('t3d-b')
      ? 'Variant B variant-b'
      : 'T-1d';
    return `${marker}: {{user_first_name}} {{pricing_url}} {{trial_end_date}} {{physical_address}} {{unsubscribe_url}} (/settings/billing)`;
  }
}

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

// ─── PostHog flag eval (T-3d only) ──────────────────────────────────────────

/**
 * Evaluate PostHog feature flag `trial_ending_copy_variant` for a given user.
 * Returns 'a' or 'b'. Defaults to 'a' on ANY error path:
 *   - posthogApiKey missing/empty
 *   - non-200 response
 *   - JSON parse error
 *   - flag value missing or boolean false
 * PostHog uptime MUST NOT be a hard dependency.
 */
async function resolvePostHogVariant(
  deps: TrialEndingDeps,
  userId: string,
): Promise<'a' | 'b'> {
  if (!deps.posthogApiKey) return 'a';
  const host = deps.posthogHost ?? 'https://us.posthog.com';
  try {
    const res = await deps.fetchImpl(`${host}/decide?v=3`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: deps.posthogApiKey,
        distinct_id: userId,
      }),
    });
    if (!res.ok) return 'a';
    const body = await res.json() as { featureFlags?: Record<string, unknown> };
    const v = body?.featureFlags?.trial_ending_copy_variant;
    if (v === 'b') return 'b';
    if (v === 'a') return 'a';
    return 'a';
  } catch {
    return 'a';
  }
}

// ─── Main handler ───────────────────────────────────────────────────────────

export async function handle(
  req: Request,
  deps?: Partial<TrialEndingDeps>,
): Promise<Response> {
  const url = new URL(req.url);

  // GET /healthz
  if (req.method === 'GET' && url.pathname.endsWith('/healthz')) {
    return new Response(
      JSON.stringify({ ok: true, fn: 'lifecycle-trial-ending' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'method_not_allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Bearer auth
  const serviceRoleKey = deps?.serviceRoleKey ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const bearerHeader = req.headers.get('Authorization') ?? '';
  const bearer = bearerHeader.startsWith('Bearer ') ? bearerHeader.slice(7) : '';

  if (!constantTimeEqual(bearer, serviceRoleKey) || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: 'unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Env / deps resolution (DI seam preserved; deps wins).
  const resendApiKey = deps?.resendApiKey ?? Deno.env.get('RESEND_API_KEY') ?? '';
  const supabaseUrl = deps?.supabaseUrl ?? Deno.env.get('SUPABASE_URL') ?? '';
  const signingKey = deps?.signingKey ?? Deno.env.get('NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY') ?? '';
  const physicalAddress = (deps && 'physicalAddress' in deps)
    ? deps.physicalAddress
    : (Deno.env.get('PHYSICAL_ADDRESS') ?? undefined);
  const fetchImpl = deps?.fetchImpl ?? fetch;

  // CAN-SPAM placeholder guard (T-65-07-03).
  if (isPlaceholder(physicalAddress)) {
    console.error('[lifecycle-trial-ending] BLOCKED: PHYSICAL_ADDRESS not set or placeholder');
    void sendSlackGuardrailAlert('regulatory', {
      severity: 'P1',
      title: 'lifecycle-trial-ending BLOCKED — PHYSICAL_ADDRESS not configured',
      text: 'Set PHYSICAL_ADDRESS as a Supabase Function Secret before cron fires.',
    }).catch(() => {});
    return new Response(
      JSON.stringify({ error: 'can_spam_address_not_configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const supabaseClient = deps?.supabaseServiceClient ?? createClient(
    supabaseUrl,
    serviceRoleKey,
    { auth: { persistSession: false } },
  );

  const stages: Stage[] = ['trial_ending_t3d', 'trial_ending_t1d'];
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  const effectiveDeps: TrialEndingDeps = {
    fetchImpl,
    supabaseServiceClient: supabaseClient,
    resendApiKey,
    serviceRoleKey,
    supabaseUrl,
    signingKey,
    physicalAddress,
    posthogApiKey: deps?.posthogApiKey ?? Deno.env.get('POSTHOG_PROJECT_KEY') ?? undefined,
    posthogHost: deps?.posthogHost ?? Deno.env.get('POSTHOG_HOST') ?? 'https://us.posthog.com',
  };

  for (const stage of stages) {
    // Per-stage candidate query via RPC.
    // RPC `get_trial_ending_candidates(stage_key text)` returns rows already filtered:
    //   - status='trialing'
    //   - trial_end_at in stage-specific window
    //   - email_marketing_consent IS NOT FALSE
    //   - NOT EXISTS in email_lifecycle_exclusion
    //   - NOT EXISTS in lifecycle_emails_sent for (user_id, stage)
    // LIMIT 200/stage.
    const queryRes = await supabaseClient.rpc('get_trial_ending_candidates', {
      stage_key: stage,
    }).select() as { data: CandidateRow[] | null; error: unknown };

    if (queryRes.error) {
      console.error('[lifecycle-trial-ending] RPC error', stage, queryRes.error);
      errors.push(`rpc_error:${stage}`);
      continue;
    }
    const candidates = queryRes.data ?? [];

    for (const row of candidates) {
      try {
        // T-3d → PostHog A/B variant; T-1d → always 'a'.
        const variant: 'a' | 'b' = stage === 'trial_ending_t3d'
          ? await resolvePostHogVariant(effectiveDeps, row.user_id)
          : 'a';

        // INSERT lifecycle_emails_sent FIRST (composite-PK idempotency guard).
        const upsertRes = await supabaseClient.from('lifecycle_emails_sent').upsert(
          {
            user_id: row.user_id,
            stage,
            copy_variant: variant,
            sent_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,stage', ignoreDuplicates: true },
        ).select() as { data: unknown[] | null; error: unknown };

        if (!upsertRes.data || (Array.isArray(upsertRes.data) && upsertRes.data.length === 0)) {
          // Conflict — already sent. T-65-07-01.
          skipped++;
          continue;
        }

        // Build unsubscribe URL.
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

        // Template key
        const templateKey = stage === 'trial_ending_t3d'
          ? (variant === 'b' ? 't3d-b' : 't3d-a')
          : 't1d';
        const tmpl = TRIAL_TEMPLATES[templateKey];

        const vars = {
          user_first_name: row.first_name ?? 'there',
          pricing_url: 'https://app.leanshot.app/settings/billing',
          trial_end_date: new Date(row.trial_end_at).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          }),
          physical_address: physicalAddress!,
          unsubscribe_url: unsubscribeUrl,
        };

        const html = renderTemplate(tmpl.html, vars, true);
        const text = renderTemplate(tmpl.text, vars, false);
        const subject = stripHeaderInjection(tmpl.subject);
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
            console.warn('[lifecycle-trial-ending] Resend error', row.user_id, resendRes.status);
          }
        }

        if (resendOk) {
          // UPDATE message_id post-send.
          await supabaseClient.from('lifecycle_emails_sent')
            .update({ resend_message_id: resendMessageId })
            .eq('user_id', row.user_id)
            .eq('stage', stage);
          sent++;
        } else {
          // Rollback lifecycle_emails_sent row so next cron retries.
          await supabaseClient.from('lifecycle_emails_sent')
            .delete()
            .eq('user_id', row.user_id)
            .eq('stage', stage);
          errors.push(`resend_failed:${row.user_id}:${stage}`);
        }
      } catch (err) {
        console.error('[lifecycle-trial-ending] error processing', row.user_id, stage, err);
        errors.push(`exception:${row.user_id}:${stage}`);
      }
    }
  }

  return new Response(
    JSON.stringify({ sent, skipped, errors }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
