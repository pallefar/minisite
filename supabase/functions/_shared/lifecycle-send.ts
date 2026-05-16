/**
 * Shared Resend dispatch helper for lifecycle Edge Functions — Phase 22 plan 22-02.
 *
 * Direct-HTTPS POST to `https://api.resend.com/emails` (no SDK), cloned from
 * `clinic-invite/resend.ts` (Phase 9 D-16) with extensions:
 *   - `RESEND_API_KEY=test-stub` → returns `{ok:true, stubbed:true}` (Pitfall 6).
 *   - `RESEND_FROM` env override; default pinned to `LeanShot <noreply@app.leanshot.app>`
 *     per D-03 (no sandbox onboarding@resend.dev anywhere).
 *
 * Caller is the lifecycle Edge Function's per-recipient loop. The
 * domain-verify gate (`resend-domain-health-check.ts`) is checked separately
 * at function startup; this helper does NOT re-verify the domain.
 *
 * PII safety (T-22-13): NEVER echo `res.text()` or exception messages.
 */
export interface ResendSendInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface ResendSendResult {
  ok: boolean;
  stubbed?: boolean;
  error?: string;
  messageId?: string;
}

const DEFAULT_FROM = 'LeanShot <noreply@app.leanshot.app>';

export async function sendResendEmail(input: ResendSendInput): Promise<ResendSendResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) return { ok: false, error: 'no_api_key' };
  if (apiKey === 'test-stub') return { ok: true, stubbed: true };

  const from = Deno.env.get('RESEND_FROM') ?? DEFAULT_FROM;

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
  } catch (e) {
    console.warn(
      '[lifecycle/send] resend fetch threw',
      e instanceof Error ? e.name : 'unknown',
    );
    return { ok: false, error: 'resend_network' };
  }

  if (!res.ok) {
    console.warn(`[lifecycle/send] resend non-2xx: ${res.status}`);
    try {
      await res.text();
    } catch {
      /* best-effort drain */
    }
    if (res.status === 429) return { ok: false, error: 'resend_429' };
    return { ok: false, error: `resend_${res.status}` };
  }

  let messageId: string | undefined;
  try {
    const body = (await res.json()) as { id?: string };
    messageId = body?.id;
  } catch {
    /* best-effort */
  }
  return { ok: true, messageId };
}
