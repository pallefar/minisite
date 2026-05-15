/**
 * Resend HTTPS dispatch helper for the `affiliate-apply` Edge Function
 * (Phase 19 Plan 19-05, W-5 — direct-HTTPS clone of `clinic-invite/resend.ts`).
 *
 * Design constraints (mirror Phase 9 pattern):
 *   - NO SDK — direct HTTPS POST to `https://api.resend.com/emails`. Keeps
 *     the function bundle thin and the supply-chain surface minimal.
 *     W-5 verification: grep for the SDK package specifier across this
 *     directory's *.ts files MUST return 0 matches.
 *   - `RESEND_API_KEY` is sourced from `Deno.env.get('RESEND_API_KEY')` —
 *     server-only, NEVER reaches the browser.
 *   - `RESEND_FROM` defaults to `'LeanShot <noreply@app.leanshot.app>'`.
 *   - CI stub: when `RESEND_API_KEY === 'test-stub'`, return `{ ok: true }`
 *     without making an HTTPS call (mirrors `clinic-invite` Pitfall #7).
 *   - T-19-05-I (Resend response leak): non-2xx responses wrap as
 *     `{ ok: false, error: 'resend_<status>' }` — we NEVER echo `res.text()`.
 *
 * The caller is `index.ts handleApply`; failure here MUST NOT block the
 * 200 response to the applicant (DB row is the durable record; the email
 * is auxiliary).
 */
import {
  renderApplicationReceived,
  renderApplicationReceivedText,
  type ApplicationReceivedParams,
} from './templates.ts';

const FROM = Deno.env.get('RESEND_FROM') ?? 'LeanShot <noreply@app.leanshot.app>';

export interface SendApplicationReceivedResult {
  ok: boolean;
  error?: string;
  /** When the CI stub fires, set so tests can assert dispatch was skipped. */
  stubbed?: boolean;
}

export interface SendApplicationReceivedParams extends ApplicationReceivedParams {
  /** Applicant email. */
  to: string;
}

export async function sendApplicationReceivedEmail(
  params: SendApplicationReceivedParams,
): Promise<SendApplicationReceivedResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    // Missing key in production = misconfigured Supabase secret. Surface
    // it as a stable error code so the caller can log + still 200 the
    // applicant. Never echo the missing-key state.
    return { ok: false, error: 'no_api_key' };
  }
  // CI stub — bypass actual HTTPS dispatch.
  if (apiKey === 'test-stub') {
    return { ok: true, stubbed: true };
  }

  const subject = 'LeanShot affiliate application received';
  const html = renderApplicationReceived({ name: params.name });
  const text = renderApplicationReceivedText({ name: params.name });

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [params.to],
        subject,
        html,
        text,
      }),
    });
  } catch (e) {
    // T-19-05-I: never echo the exception message — it may contain the
    // Authorization header in network-layer errors. Log a stable string.
    console.error(
      '[affiliate-apply] resend fetch threw',
      e instanceof Error ? e.name : 'unknown',
    );
    return { ok: false, error: 'resend_network' };
  }

  if (!res.ok) {
    // T-19-05-I: never echo `res.text()` — wrap as a stable code only.
    console.error(`[affiliate-apply] resend non-2xx: ${res.status}`);
    if (res.status === 429) return { ok: false, error: 'resend_429' };
    return { ok: false, error: `resend_${res.status}` };
  }
  // Drain the body so the connection can be pooled. Don't parse or log it.
  try {
    await res.text();
  } catch {
    /* best-effort */
  }
  return { ok: true };
}
