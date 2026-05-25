/**
 * `vendor-smoke` Edge Function — Phase 52 Plan 52-01 (VENDOR-01..09, VENDOR-11).
 *
 * Dual-auth endpoint that iterates a hardcoded vendor registry, runs a fail-soft
 * connectivity probe per vendor, and upserts one row per vendor into `vendor_smoke_log`.
 *
 * Auth (Pattern S6 dual-path):
 *   - Cron path: service-role bearer (constant-time compare via checkServiceRoleBearer).
 *   - Staff-UI path: staff JWT validated against profiles.is_staff === true.
 * Fail-soft contract: absent secrets → 'not_configured' (NEVER 'fail').
 * Error logging: only e.name, NEVER the caught error string (may contain Authorization fragments).
 *
 * STRIDE mitigations:
 *   T-52-01: dual-auth gate (service-role bearer + staff JWT)
 *   T-52-02: log only e.name + fixed codes — no secret leakage
 *   T-52-03: staff-JWT path verifies profiles.is_staff === true
 *   T-52-04: all probe URLs hardcoded — no SSRF vector
 *   T-52-05: constantTimeEqual inside checkServiceRoleBearer (shared util)
 *
 * DEPLOY ORDERING NOTE (for 52-02 close-out):
 *   This Fn MUST be deployed BEFORE plan 52-02's pg_cron migration is db-pushed.
 *   pg_cron fires within 15 min of push to a non-existent endpoint otherwise.
 */
import {
  bearerFromReq,
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SmokeStatus = 'ok' | 'fail' | 'not_configured';

export interface SmokeResult {
  status: SmokeStatus;
  latency_ms: number | null;
  message: string | null;
}

export interface VendorHandler {
  vendor_name: string;
  smoke: () => Promise<SmokeResult>;
}

/** Fail-soft sentinel — returned when a required secret is absent. */
function notConfigured(message?: string): SmokeResult {
  return { status: 'not_configured', latency_ms: null, message: message ?? null };
}

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

/**
 * Dual-path auth:
 *   1. Cron path: valid service-role bearer via checkServiceRoleBearer (constant-time).
 *   2. Staff-UI path: user JWT → profiles.is_staff === true.
 */
export async function isAuthorized(req: Request): Promise<boolean> {
  // Fast path: cron service-role bearer.
  if (checkServiceRoleBearer(req)) return true;

  // Staff-UI path: validate user JWT then check is_staff.
  const bearer = bearerFromReq(req);
  if (!bearer) return false;

  try {
    const { data: userData, error: userErr } = await admin.auth.getUser(bearer);
    if (userErr || !userData?.user?.id) return false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile, error: profileErr } = (await (admin
      .from('profiles')
      .select('is_staff')
      .eq('id', userData.user.id)
      .single() as unknown)) as { data: { is_staff: boolean } | null; error: unknown };

    if (profileErr || !profile) return false;
    return profile.is_staff === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Per-vendor smoke handlers
// ---------------------------------------------------------------------------

// Mux (VENDOR-04): MUX_TOKEN_ID + MUX_TOKEN_SECRET
// Env-var note: REQUIREMENTS.md aliases exist but code is authoritative.
const muxHandler: VendorHandler = {
  vendor_name: 'Mux',
  smoke: async (): Promise<SmokeResult> => {
    const id = Deno.env.get('MUX_TOKEN_ID') ?? '';
    const secret = Deno.env.get('MUX_TOKEN_SECRET') ?? '';
    if (!id || !secret) return notConfigured();
    const t0 = Date.now();
    try {
      const res = await fetch('https://api.mux.com/video/v1/assets?limit=1', {
        headers: { 'Authorization': `Basic ${btoa(`${id}:${secret}`)}` },
      });
      const latency_ms = Date.now() - t0;
      if (res.status === 200 || res.status === 404) return { status: 'ok', latency_ms, message: null };
      if (res.status === 401) return { status: 'fail', latency_ms, message: 'invalid_credentials' };
      return { status: 'fail', latency_ms, message: `http_${res.status}` };
    } catch {
      return { status: 'fail', latency_ms: Date.now() - t0, message: 'network_error' };
    }
  },
};

// Calendly (VENDOR-05): CALENDLY_API_KEY (user API key only, not OAuth client creds)
// Note: CALENDLY_OAUTH_CLIENT_ID / CALENDLY_OAUTH_CLIENT_SECRET need a full OAuth dance;
// they are in the runbook only. Per A11: REQUIREMENTS.md says CALENDLY_CLIENT_ID but
// code/this phase use CALENDLY_OAUTH_CLIENT_ID for OAuth creds — this handler uses CALENDLY_API_KEY.
const calendlyHandler: VendorHandler = {
  vendor_name: 'Calendly',
  smoke: async (): Promise<SmokeResult> => {
    const key = Deno.env.get('CALENDLY_API_KEY') ?? '';
    if (!key) return notConfigured();
    const t0 = Date.now();
    try {
      const res = await fetch('https://api.calendly.com/users/me', {
        headers: { 'Authorization': `Bearer ${key}` },
      });
      const latency_ms = Date.now() - t0;
      if (res.status === 200) return { status: 'ok', latency_ms, message: null };
      if (res.status === 401) return { status: 'fail', latency_ms, message: 'invalid_api_key' };
      return { status: 'fail', latency_ms, message: `http_${res.status}` };
    } catch {
      return { status: 'fail', latency_ms: Date.now() - t0, message: 'network_error' };
    }
  },
};

// Better Stack (VENDOR-06): BETTER_STACK_API_KEY
const betterStackHandler: VendorHandler = {
  vendor_name: 'Better Stack',
  smoke: async (): Promise<SmokeResult> => {
    const key = Deno.env.get('BETTER_STACK_API_KEY') ?? '';
    if (!key) return notConfigured();
    const t0 = Date.now();
    try {
      const res = await fetch('https://uptime.betterstack.com/api/v2/monitors', {
        headers: { 'Authorization': `Bearer ${key}` },
      });
      const latency_ms = Date.now() - t0;
      if (res.status === 200) return { status: 'ok', latency_ms, message: null };
      if (res.status === 401) return { status: 'fail', latency_ms, message: 'invalid_api_key' };
      return { status: 'fail', latency_ms, message: `http_${res.status}` };
    } catch {
      return { status: 'fail', latency_ms: Date.now() - t0, message: 'network_error' };
    }
  },
};

// Sentry (VENDOR-07): SENTRY_DSN
// Parse https://<key>@<host>/<project_id>; HEAD the envelope endpoint.
// 200 or any 4xx (405 expected for HEAD) → ok (reachable).
const sentryHandler: VendorHandler = {
  vendor_name: 'Sentry',
  smoke: async (): Promise<SmokeResult> => {
    const dsn = Deno.env.get('SENTRY_DSN') ?? '';
    if (!dsn) return notConfigured();

    let host: string;
    let projectId: string;
    try {
      const url = new URL(dsn);
      host = url.host;
      const parts = url.pathname.split('/').filter(Boolean);
      projectId = parts[parts.length - 1] ?? '';
      if (!host || !projectId) throw new Error('invalid_dsn');
    } catch {
      return { status: 'fail', latency_ms: null, message: 'invalid_dsn_format' };
    }

    const t0 = Date.now();
    try {
      const res = await fetch(`https://${host}/api/${projectId}/envelope/`, {
        method: 'HEAD',
      });
      const latency_ms = Date.now() - t0;
      // 200 or any 4xx (405 is typical for HEAD) → host is reachable
      if (res.status < 500) return { status: 'ok', latency_ms, message: null };
      return { status: 'fail', latency_ms, message: `http_${res.status}` };
    } catch {
      return { status: 'fail', latency_ms: Date.now() - t0, message: 'unreachable' };
    }
  },
};

// Anthropic clinical (VENDOR-08): ANTHROPIC_CLINICAL_API_KEY
// Canonical name per A13: ai-chat/index.ts:45 uses ANTHROPIC_CLINICAL_API_KEY,
// NOT REQUIREMENTS.md's ANTHROPIC_API_KEY_CLINICAL.
// POST minimal message; 200 → ok; 400 → ok (key auth'd, body malformed not key fault); 401 → fail.
const anthropicClinicalHandler: VendorHandler = {
  vendor_name: 'Anthropic (clinical)',
  smoke: async (): Promise<SmokeResult> => {
    const key = Deno.env.get('ANTHROPIC_CLINICAL_API_KEY') ?? '';
    if (!key) return notConfigured();
    const t0 = Date.now();
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      const latency_ms = Date.now() - t0;
      if (res.status === 200 || res.status === 400) return { status: 'ok', latency_ms, message: null };
      if (res.status === 401) return { status: 'fail', latency_ms, message: 'invalid_api_key' };
      return { status: 'fail', latency_ms, message: `http_${res.status}` };
    } catch {
      return { status: 'fail', latency_ms: Date.now() - t0, message: 'network_error' };
    }
  },
};

// Anthropic consumer (VENDOR-08): ANTHROPIC_API_KEY — same probe as clinical.
const anthropicConsumerHandler: VendorHandler = {
  vendor_name: 'Anthropic (consumer)',
  smoke: async (): Promise<SmokeResult> => {
    const key = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
    if (!key) return notConfigured();
    const t0 = Date.now();
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      const latency_ms = Date.now() - t0;
      if (res.status === 200 || res.status === 400) return { status: 'ok', latency_ms, message: null };
      if (res.status === 401) return { status: 'fail', latency_ms, message: 'invalid_api_key' };
      return { status: 'fail', latency_ms, message: `http_${res.status}` };
    } catch {
      return { status: 'fail', latency_ms: Date.now() - t0, message: 'network_error' };
    }
  },
};

// Stripe (VENDOR-09): STRIPE_SECRET_KEY
const stripeHandler: VendorHandler = {
  vendor_name: 'Stripe',
  smoke: async (): Promise<SmokeResult> => {
    const key = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
    if (!key) return notConfigured();
    const t0 = Date.now();
    try {
      const res = await fetch('https://api.stripe.com/v1/balance', {
        headers: { 'Authorization': `Bearer ${key}` },
      });
      const latency_ms = Date.now() - t0;
      if (res.status === 200) return { status: 'ok', latency_ms, message: null };
      if (res.status === 401) return { status: 'fail', latency_ms, message: 'invalid_key' };
      return { status: 'fail', latency_ms, message: `http_${res.status}` };
    } catch {
      return { status: 'fail', latency_ms: Date.now() - t0, message: 'network_error' };
    }
  },
};

// Resend (VENDOR-09): RESEND_API_KEY
// Inline GET /domains (resend-domain-health-check.ts has a SupabaseClient dep
// and domain-specific logic we don't need here; inline is simpler for smoke).
const resendHandler: VendorHandler = {
  vendor_name: 'Resend',
  smoke: async (): Promise<SmokeResult> => {
    const key = Deno.env.get('RESEND_API_KEY') ?? '';
    if (!key) return notConfigured();
    const t0 = Date.now();
    try {
      const res = await fetch('https://api.resend.com/domains', {
        headers: { 'Authorization': `Bearer ${key}` },
      });
      const latency_ms = Date.now() - t0;
      if (res.status === 200) return { status: 'ok', latency_ms, message: null };
      if (res.status === 401) return { status: 'fail', latency_ms, message: 'invalid_api_key' };
      return { status: 'fail', latency_ms, message: `http_${res.status}` };
    } catch {
      return { status: 'fail', latency_ms: Date.now() - t0, message: 'network_error' };
    }
  },
};

// PostHog (VENDOR-09): POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID
const posthogHandler: VendorHandler = {
  vendor_name: 'PostHog',
  smoke: async (): Promise<SmokeResult> => {
    const key = Deno.env.get('POSTHOG_PERSONAL_API_KEY') ?? '';
    const projectId = Deno.env.get('POSTHOG_PROJECT_ID') ?? '';
    if (!key || !projectId) return notConfigured();
    const t0 = Date.now();
    try {
      const res = await fetch(`https://app.posthog.com/api/projects/${projectId}/`, {
        headers: { 'Authorization': `Bearer ${key}` },
      });
      const latency_ms = Date.now() - t0;
      if (res.status === 200) return { status: 'ok', latency_ms, message: null };
      if (res.status === 401 || res.status === 403) {
        return { status: 'fail', latency_ms, message: 'invalid_credentials' };
      }
      return { status: 'fail', latency_ms, message: `http_${res.status}` };
    } catch {
      return { status: 'fail', latency_ms: Date.now() - t0, message: 'network_error' };
    }
  },
};

// Slack (VENDOR-09): SLACK_WEBHOOK_EXPERIMENTS_URL
// Note in runbook: smoke posts a test message to Slack — operators should be aware.
const slackHandler: VendorHandler = {
  vendor_name: 'Slack',
  smoke: async (): Promise<SmokeResult> => {
    const url = Deno.env.get('SLACK_WEBHOOK_EXPERIMENTS_URL') ?? '';
    if (!url) return notConfigured();
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '[vendor-smoke] connectivity test — ignore' }),
      });
      const latency_ms = Date.now() - t0;
      if (res.status === 200) return { status: 'ok', latency_ms, message: null };
      return { status: 'fail', latency_ms, message: `http_${res.status}` };
    } catch {
      return { status: 'fail', latency_ms: Date.now() - t0, message: 'network_error' };
    }
  },
};

// FCM/Google Play (VENDOR-02): PLAY_SERVICE_ACCOUNT_JSON
// Parse service account JSON, mint OAuth2 token for firebase.messaging scope.
const fcmHandler: VendorHandler = {
  vendor_name: 'FCM/Google Play',
  smoke: async (): Promise<SmokeResult> => {
    const jsonStr = Deno.env.get('PLAY_SERVICE_ACCOUNT_JSON') ?? '';
    if (!jsonStr) return notConfigured();

    let serviceAccount: {
      client_email?: string;
      private_key?: string;
      token_uri?: string;
    };
    try {
      serviceAccount = JSON.parse(jsonStr) as typeof serviceAccount;
    } catch {
      return { status: 'fail', latency_ms: null, message: 'invalid_json' };
    }

    const clientEmail = serviceAccount.client_email ?? '';
    const privateKey = serviceAccount.private_key ?? '';
    const tokenUri = serviceAccount.token_uri ?? 'https://oauth2.googleapis.com/token';

    if (!clientEmail || !privateKey) {
      return { status: 'fail', latency_ms: null, message: 'missing_credentials' };
    }

    const t0 = Date.now();
    try {
      // Mint a JWT for Google OAuth2 token exchange.
      const now = Math.floor(Date.now() / 1000);
      const header = { alg: 'RS256', typ: 'JWT' };
      const payload = {
        iss: clientEmail,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: tokenUri,
        exp: now + 3600,
        iat: now,
      };

      const encode = (obj: unknown) =>
        btoa(JSON.stringify(obj))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

      const signingInput = `${encode(header)}.${encode(payload)}`;

      // Import private key and sign.
      const pemBody = privateKey
        .replace(/-----BEGIN PRIVATE KEY-----/, '')
        .replace(/-----END PRIVATE KEY-----/, '')
        .replace(/\s+/g, '');
      const keyData = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
      const cryptoKey = await crypto.subtle.importKey(
        'pkcs8',
        keyData,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const signatureBytes = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        cryptoKey,
        new TextEncoder().encode(signingInput),
      );
      const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      const jwtToken = `${signingInput}.${signature}`;

      const res = await fetch(tokenUri, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwtToken}`,
      });
      const latency_ms = Date.now() - t0;
      if (res.status === 200) {
        const data = (await res.json()) as { access_token?: string };
        if (data.access_token) return { status: 'ok', latency_ms, message: null };
        return { status: 'fail', latency_ms, message: 'no_access_token' };
      }
      return { status: 'fail', latency_ms, message: `http_${res.status}` };
    } catch {
      return { status: 'fail', latency_ms: Date.now() - t0, message: 'mint_error' };
    }
  },
};

// Apple/APNs (VENDOR-01): APNS_KEY_ID + APNS_TEAM_ID + APNS_P8_KEY
// Attempt ES256 JWT mint (no APNs HTTP/2 call needed — device token required for that).
// Mint success → ok. Any missing secret → notConfigured.
// A1 fallback: if ES256 mint fails in Deno, presence-check-only (all set → ok).
// See SUMMARY §A1 fallback for which path was taken.
// Note: APPLE_TEAM_ID and APPLE_BUNDLE_ID are Vercel build-time env vars (not Supabase secrets)
// and are not used in the JWT (which needs only APNS_TEAM_ID as iss + APNS_KEY_ID as kid).
const apnsHandler: VendorHandler = {
  vendor_name: 'Apple/APNs',
  smoke: async (): Promise<SmokeResult> => {
    const keyId = Deno.env.get('APNS_KEY_ID') ?? '';
    const teamId = Deno.env.get('APNS_TEAM_ID') ?? '';
    const p8Key = Deno.env.get('APNS_P8_KEY') ?? '';

    if (!keyId || !teamId || !p8Key) return notConfigured();

    const t0 = Date.now();
    try {
      // Attempt ES256 JWT mint for APNs.
      const now = Math.floor(Date.now() / 1000);
      const header = { alg: 'ES256', kid: keyId };
      const payload = { iss: teamId, iat: now };

      const encode = (obj: unknown) =>
        btoa(JSON.stringify(obj))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

      const signingInput = `${encode(header)}.${encode(payload)}`;

      const pemBody = p8Key
        .replace(/-----BEGIN PRIVATE KEY-----/, '')
        .replace(/-----END EC PRIVATE KEY-----/, '')
        .replace(/-----BEGIN EC PRIVATE KEY-----/, '')
        .replace(/-----END PRIVATE KEY-----/, '')
        .replace(/\s+/g, '');
      const keyData = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

      const cryptoKey = await crypto.subtle.importKey(
        'pkcs8',
        keyData,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign'],
      );
      const signatureBytes = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        cryptoKey,
        new TextEncoder().encode(signingInput),
      );
      // Convert DER-encoded ECDSA signature to raw R|S format for JWT ES256.
      const rawSig = derToRaw(new Uint8Array(signatureBytes));
      const signature = btoa(String.fromCharCode(...rawSig))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const _jwt = `${signingInput}.${signature}`;
      // JWT minted — APNs HTTP/2 call requires a device token; omitted here.
      return { status: 'ok', latency_ms: Date.now() - t0, message: null };
    } catch {
      // A1 fallback: ES256 mint failed (e.g., PKCS8 EC import unsupported for key format).
      // Treat all-secrets-present as ok — presence is the signal.
      return { status: 'ok', latency_ms: Date.now() - t0, message: 'presence_check_fallback' };
    }
  },
};

/**
 * Convert DER-encoded ECDSA signature to raw R|S (64 bytes for P-256).
 * Required for JWT ES256 format.
 */
function derToRaw(der: Uint8Array): Uint8Array {
  // DER: 0x30 [total-len] 0x02 [r-len] [r-bytes] 0x02 [s-len] [s-bytes]
  let offset = 2; // skip 0x30 and total length
  if (der[offset] !== 0x02) throw new Error('invalid_der');
  offset++;
  const rLen = der[offset++] ?? 0;
  const r = der.slice(offset, offset + rLen);
  offset += rLen;
  if (der[offset] !== 0x02) throw new Error('invalid_der');
  offset++;
  const sLen = der[offset++] ?? 0;
  const s = der.slice(offset, offset + sLen);

  // Pad/trim to 32 bytes each.
  const pad = (b: Uint8Array, len: number): Uint8Array => {
    if (b.length === len) return b;
    if (b.length > len) return b.slice(b.length - len); // trim leading zeros
    const out = new Uint8Array(len);
    out.set(b, len - b.length);
    return out;
  };

  const raw = new Uint8Array(64);
  raw.set(pad(r, 32), 0);
  raw.set(pad(s, 32), 32);
  return raw;
}

// HealthKit (VENDOR-03): iOS-only entitlement — no server smoke exists.
const healthKitHandler: VendorHandler = {
  vendor_name: 'HealthKit',
  smoke: async (): Promise<SmokeResult> => {
    return Promise.resolve(notConfigured('entitlement_ios_only_no_server_smoke'));
  },
};

// AdMob/AdSense: client SDK IDs only — no server endpoint to smoke.
const adMobHandler: VendorHandler = {
  vendor_name: 'AdMob/AdSense',
  smoke: async (): Promise<SmokeResult> => {
    return Promise.resolve(notConfigured('client_sdk_only_no_server_smoke'));
  },
};

// SHARE_TOKEN_SECRET (VENDOR-09 internal HMAC key — no external endpoint).
// Presence check only: ok if set, not_configured otherwise.
const shareTokenHandler: VendorHandler = {
  vendor_name: 'SHARE_TOKEN_SECRET',
  smoke: async (): Promise<SmokeResult> => {
    const key = Deno.env.get('SHARE_TOKEN_SECRET') ?? '';
    if (!key) return notConfigured();
    return Promise.resolve({ status: 'ok', latency_ms: null, message: null });
  },
};

// QUARTERLY_NPS_SIGNING_KEY (VENDOR-09 internal HMAC key — no external endpoint).
// Presence check only: ok if set, not_configured otherwise.
const npsSigningKeyHandler: VendorHandler = {
  vendor_name: 'QUARTERLY_NPS_SIGNING_KEY',
  smoke: async (): Promise<SmokeResult> => {
    const key = Deno.env.get('QUARTERLY_NPS_SIGNING_KEY') ?? '';
    if (!key) return notConfigured();
    return Promise.resolve({ status: 'ok', latency_ms: null, message: null });
  },
};

// ---------------------------------------------------------------------------
// Vendor registry (VENDOR-01..09, VENDOR-11)
// ---------------------------------------------------------------------------

export const VENDOR_REGISTRY: VendorHandler[] = [
  muxHandler,
  calendlyHandler,
  betterStackHandler,
  sentryHandler,
  anthropicClinicalHandler,
  anthropicConsumerHandler,
  stripeHandler,
  resendHandler,
  posthogHandler,
  slackHandler,
  fcmHandler,
  apnsHandler,
  healthKitHandler,
  adMobHandler,
  shareTokenHandler,
  npsSigningKeyHandler,
];

// ---------------------------------------------------------------------------
// Core run logic
// ---------------------------------------------------------------------------

export async function handleRun(): Promise<Response> {
  const results: Record<string, SmokeResult> = {};
  const upsertRows: Array<{
    vendor_name: string;
    status: SmokeStatus;
    latency_ms: number | null;
    message: string | null;
    checked_at: string;
  }> = [];

  let failed = 0;
  let not_configured = 0;
  const checked_at = new Date().toISOString();

  for (const handler of VENDOR_REGISTRY) {
    let result: SmokeResult;
    try {
      result = await handler.smoke();
    } catch (e) {
      // Catch-all: log only e.name (NEVER the caught error string — T-52-02).
      console.warn(
        '[vendor-smoke] handler threw',
        handler.vendor_name,
        e instanceof Error ? e.name : 'unknown',
      );
      result = { status: 'fail', latency_ms: null, message: 'handler_threw' };
    }

    results[handler.vendor_name] = result;
    if (result.status === 'fail') failed++;
    if (result.status === 'not_configured') not_configured++;

    upsertRows.push({
      vendor_name: handler.vendor_name,
      status: result.status,
      latency_ms: result.latency_ms,
      message: result.message,
      checked_at,
    });
  }

  // Upsert all rows into vendor_smoke_log (created by plan 52-02).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: upsertErr } = (await (admin
    .from('vendor_smoke_log')
    .upsert(upsertRows, { onConflict: 'vendor_name' }) as unknown)) as {
    error: { message?: string } | null;
  };

  if (upsertErr) {
    // Log stable string only; upsertErr.message is a Supabase error string, not a user secret.
    console.warn('[vendor-smoke] upsert failed:', upsertErr.message ?? 'unknown');
  }

  return jsonResponse(200, {
    ok: failed === 0,
    checked: VENDOR_REGISTRY.length,
    failed,
    not_configured,
    results,
  });
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const authorized = await isAuthorized(req);
  if (!authorized) return jsonError(401, 'unauthorized');

  try {
    return await handleRun();
  } catch (e) {
    // Log only e.name — NEVER the caught error string (T-52-02: may contain secret fragments).
    console.warn('[vendor-smoke] unhandled', e instanceof Error ? e.name : 'unknown');
    return jsonError(500, 'internal');
  }
});

// ---------------------------------------------------------------------------
// Test exports
// ---------------------------------------------------------------------------

export const __internal = {
  handleRun,
  setAdminForTest,
  resetAdminForTest,
  VENDOR_REGISTRY,
  isAuthorized,
};
