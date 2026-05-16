/**
 * `lifecycle-preference-update` Edge Function — Phase 22 plan 22-02 (ON-03).
 *
 * HTTP-invoked from `/settings/email-preferences` (plan 22-11 owner).
 * POST body: `{categories: {welcome, behavior_triggered, retention, weekly_digest, affiliate}}`
 *
 * Auth: user JWT (verify_jwt=true). The function resolves auth.uid() via
 * `admin.auth.getUser(jwt)` then UPSERTs the latest `consent_records` row
 * for that user with the new `email_preferences` JSONB.
 *
 * Optional: if `RESEND_AUDIENCE_ID` env var is set, sync the contact's
 * audience membership per category toggle (PUT
 * `/audiences/<id>/contacts`). Health check via the shared helper —
 * skipped audience sync if domain unverified (returns 200 with
 * `audience_sync_skipped: true`).
 */
import { resendDomainHealthCheck } from '../_shared/resend-domain-health-check.ts';
import {
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

const ALLOWED_CATEGORIES = [
  'welcome',
  'behavior_triggered',
  'retention',
  'weekly_digest',
  'affiliate',
] as const;
type Category = (typeof ALLOWED_CATEGORIES)[number];

interface UpdateBody {
  categories?: Partial<Record<Category, boolean>>;
}

function jwtFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

async function handleUpdate(req: Request): Promise<Response> {
  const jwt = jwtFromReq(req);
  if (!jwt) return jsonError(401, 'unauthenticated');

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: userData, error: userErr } = await (admin.auth as any).getUser(jwt);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (userErr || !userData?.user?.id) return jsonError(401, 'unauthenticated');
  const user = userData.user as { id: string; email?: string };

  let body: UpdateBody;
  try {
    body = (await req.json()) as UpdateBody;
  } catch {
    return jsonError(400, 'bad_json');
  }
  const incoming = body.categories ?? {};
  const sanitized: Record<string, boolean> = {};
  for (const key of ALLOWED_CATEGORIES) {
    if (key in incoming) sanitized[key] = Boolean(incoming[key]);
  }
  if (Object.keys(sanitized).length === 0) {
    return jsonError(400, 'no_categories');
  }

  // Fetch existing preferences to merge (partial updates allowed).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: existing } = (await (admin
    .from('consent_records')
    .select('id, email_preferences')
    .eq('user_id', user.id)
    .order('recorded_at', { ascending: false })
    .limit(1) as any)) as { data: Array<{ id: string; email_preferences?: Record<string, unknown> }> | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const prevPrefs = existing?.[0]?.email_preferences ?? {};
  const merged: Record<string, unknown> = { ...prevPrefs, ...sanitized };

  // INSERT a new consent_records row (append-only history for GDPR Art 7(1)).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { error: insErr } = await (admin.from('consent_records').insert({
    user_id: user.id,
    email_preferences: merged,
  }) as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (insErr) {
    console.warn('[lifecycle-pref] consent_records insert failed', insErr.message ?? 'unknown');
    return jsonError(500, 'persist_failed');
  }

  // Optional Resend audience sync.
  let audienceSync: { attempted: boolean; skipped?: boolean; ok?: boolean; error?: string } = {
    attempted: false,
  };
  const audienceId = Deno.env.get('RESEND_AUDIENCE_ID');
  if (audienceId && user.email) {
    audienceSync = { attempted: true };
    const health = await resendDomainHealthCheck(admin);
    if (!health.ok) {
      audienceSync.skipped = true;
    } else {
      audienceSync = { ...audienceSync, ...(await syncResendAudience(audienceId, user.email, merged)) };
    }
  }

  return jsonResponse(200, {
    ok: true,
    preferences: merged,
    audience_sync: audienceSync,
  });
}

async function syncResendAudience(
  audienceId: string,
  email: string,
  prefs: Record<string, unknown>,
): Promise<{ ok?: boolean; error?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey || apiKey === 'test-stub') return { ok: true };
  // If ANY non-transactional category is enabled → upsert contact (unsubscribed=false).
  // If ALL are off → upsert with unsubscribed=true.
  const anyOn = Object.values(prefs).some((v) => v === true || v === 'true');
  try {
    const res = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, unsubscribed: !anyOn }),
    });
    if (!res.ok) {
      console.warn(`[lifecycle-pref] audience sync non-2xx: ${res.status}`);
      try {
        await res.text();
      } catch {
        /* drain */
      }
      return { ok: false, error: `resend_${res.status}` };
    }
    try {
      await res.text();
    } catch {
      /* drain */
    }
    return { ok: true };
  } catch (e) {
    console.warn(
      '[lifecycle-pref] audience fetch threw',
      e instanceof Error ? e.name : 'unknown',
    );
    return { ok: false, error: 'audience_network' };
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  try {
    return await handleUpdate(req);
  } catch (e) {
    console.warn('[lifecycle-pref] unhandled', e instanceof Error ? e.message : 'unknown');
    return jsonError(500, 'internal');
  }
});

export const __internal = { handleUpdate, setAdminForTest, resetAdminForTest, ALLOWED_CATEGORIES };
