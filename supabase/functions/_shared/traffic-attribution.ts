/**
 * Phase 51 Plan 51-02 — recordTouch() shared helper.
 *
 * Called from `supabase/functions/traffic-attribution-recorder/index.ts` to:
 *   1. Resolve channel_group via `classify_channel_group_with_referrer` RPC
 *      (Plan 51-01) — server-side classification means admin taxonomy edits
 *      take effect at next refresh without a code deploy (D-01 + D-03).
 *   2. UPSERT into `user_traffic_attribution` via `upsert_traffic_attribution`
 *      SECDEF RPC (Plan 51-01) — preserves first-touch immutability via
 *      ON CONFLICT exclusion of `first_touch_*` columns (D-02).
 *   3. Mirror to PostHog person properties via `captureServer()` from
 *      `_shared/posthog-server.ts` — adblock-resistant (Phase 24 D-11/D-13).
 *
 * Lazy-admin singleton mirrors the makeLazyAdmin shape from
 * `_shared/lifecycle-utils.ts` so a missing env var degrades gracefully
 * (returns `{ ok: false, error: 'admin_unavailable' }`) instead of crashing
 * the Deno isolate at module-load time.
 *
 * CRITICAL: Caller MUST wrap the handler in `try { ... } finally {
 *   await shutdownPostHog(); }` per the captureServer() invariant (PITFALL 1).
 *
 * Threat refs (51-02-PLAN.md):
 *   - T-51-09: utm field length clamp + landing_path PHI redaction happen in
 *     the recorder Fn BEFORE this helper is called.
 *   - T-51-14: helper uses service_role admin client; the SECDEF RPCs do
 *     NOT reference auth.uid() per memory feedback_rpc_auth_uid_vs_service_role_mismatch.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { captureServer } from './posthog-server.ts';

// ============================================================================
// Lazy admin singleton + test seam
// ============================================================================

let _admin: SupabaseClient | null = null;
let _missingEnvWarned = false;

function getAdmin(): SupabaseClient | null {
  if (_admin) return _admin;
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !key) {
    if (!_missingEnvWarned) {
      console.warn(
        '[traffic-attribution] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — recordTouch is a no-op',
      );
      _missingEnvWarned = true;
    }
    return null;
  }
  _admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _admin;
}

/** Test seam — inject a mock admin client (mirrors makeLazyAdmin shape). */
export function setAdminForTest(client: unknown): void {
  _admin = client as SupabaseClient;
}

/** Test seam — reset the singleton between tests. */
export function resetAdminForTest(): void {
  _admin = null;
  _missingEnvWarned = false;
}

// ============================================================================
// Public API
// ============================================================================

export interface RecordTouchArgs {
  /** lt_anon_id cookie value (server-readable; HttpOnly minted by middleware). */
  anonId: string;
  /** Resolved from lt_clinic_slug_seen cookie via resolve_clinic_slug_rpc (D-12). */
  orgId?: string | null;
  /** Supabase auth.users.id when caller has been identified; defaults to anonId
   *  for PostHog distinct_id when null (pre-signup touches). */
  userId?: string | null;
  /** Verbatim UTM params from the landing URL. Each clamped to <=2048 bytes
   *  by the recorder Fn before this call. */
  utm: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  };
  /** document.referrer or null. Clamped to <=4096 bytes by caller. */
  referrer: string | null;
  /** window.location.pathname AFTER PHI redaction by the recorder Fn. */
  landingPath: string;
  /** PAGEAB variant id (Phase 15) when present; null for non-PAGEAB pages. */
  pageVariantId?: string | null;
  /** Audience taxonomy bucket — drives downstream funnel routing. */
  audience: 'consumer' | 'clinic-org' | 'affiliate';
  /** Caller-provided timestamp (injected so tests can pin the clock). */
  now: Date;
}

export type RecordTouchResult =
  | { ok: true; channelGroup: string }
  | { ok: false; error: string };

/**
 * Resolve channel group + UPSERT attribution + mirror to PostHog.
 *
 * Errors are surfaced as `{ ok: false, error }` rather than thrown — the
 * recorder Fn calls this fire-and-forget and reports 200 to the caller
 * regardless (the middleware's job ends when the response leaves the edge;
 * downstream failures are operator-visible via console.warn + alerts).
 */
export async function recordTouch(args: RecordTouchArgs): Promise<RecordTouchResult> {
  const admin = getAdmin();
  if (!admin) return { ok: false, error: 'admin_unavailable' };

  // Derive referrer host (null-safe).
  let refHost: string | null = null;
  if (args.referrer) {
    try {
      refHost = new URL(args.referrer).host.toLowerCase();
    } catch {
      // Malformed referrer — leave host null; classifier falls back to UTM-only.
    }
  }

  // Step 1: server-side channel classification.
  // Falls back to 'Direct' when the classifier returns null AND when the RPC
  // itself errors — we'd rather record an attribution with a coarse bucket
  // than drop the touch entirely.
  let channelGroup = 'Direct';
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data: cg, error: cgErr } = (await (admin as any).rpc(
      'classify_channel_group_with_referrer',
      {
        p_utm_source: args.utm.source ?? null,
        p_utm_medium: args.utm.medium ?? null,
        p_utm_campaign: args.utm.campaign ?? null,
        p_referrer_host: refHost,
      },
    )) as { data: string | null; error: { message?: string } | null };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (cgErr) {
      console.warn('[traffic-attribution] classify_channel_group_with_referrer failed:', cgErr.message);
    } else if (typeof cg === 'string' && cg.length > 0) {
      channelGroup = cg;
    }
  } catch (err) {
    console.warn(
      '[traffic-attribution] classify_channel_group_with_referrer threw:',
      err instanceof Error ? err.message : String(err),
    );
  }

  // Step 2: authoritative SQL UPSERT (Plan 51-01 RPC).
  // RPC param order MUST match the migration signature exactly:
  //   (text, uuid, text, text, text, text, text, text, text, text, timestamptz).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { error: rpcErr } = (await (admin as any).rpc('upsert_traffic_attribution', {
    p_anon_id: args.anonId,
    p_org_id: args.orgId ?? null,
    p_utm_source: args.utm.source ?? null,
    p_utm_medium: args.utm.medium ?? null,
    p_utm_campaign: args.utm.campaign ?? null,
    p_utm_term: args.utm.term ?? null,
    p_utm_content: args.utm.content ?? null,
    p_referrer: args.referrer,
    p_landing_path: args.landingPath,
    p_channel_group: channelGroup,
    p_now: args.now.toISOString(),
  })) as { error: { message?: string } | null };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (rpcErr) {
    return { ok: false, error: `upsert_failed:${rpcErr.message ?? 'unknown'}` };
  }

  // Step 3: PostHog mirror + events_mirror dual-write.
  // captureServer() requires a userId; before identification we use anonId
  // as the PostHog distinct_id (gets alias'd to auth.users.id at signup
  // via merge-anon-session → aliasServerSide).
  try {
    captureServer({
      userId: args.userId ?? args.anonId,
      event: 'traffic_visit',
      properties: {
        channel_group: channelGroup,
        audience: args.audience,
        landing_path: args.landingPath,
        page_variant_id: args.pageVariantId ?? null,
        $set: {
          last_touch_channel_group: channelGroup,
          last_touch_source: args.utm.source ?? null,
          last_touch_medium: args.utm.medium ?? null,
          last_touch_at: args.now.toISOString(),
        },
        $set_once: {
          first_touch_channel_group: channelGroup,
          first_touch_source: args.utm.source ?? null,
          first_touch_medium: args.utm.medium ?? null,
          first_touch_at: args.now.toISOString(),
        },
      },
    });
  } catch (err) {
    // captureServer throws on empty userId — we already defaulted to anonId
    // so this should be unreachable. Log but don't fail the whole helper.
    console.warn(
      '[traffic-attribution] captureServer mirror failed:',
      err instanceof Error ? err.message : String(err),
    );
  }

  return { ok: true, channelGroup };
}
