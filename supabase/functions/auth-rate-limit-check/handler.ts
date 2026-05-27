/**
 * auth-rate-limit-check — handler.ts
 *
 * Phase 66 Plan 66-05 (AUTH-14 + AUTH-15).
 *
 * Pre-sign-in rate-limit + brute-force detector. Client-side
 * `signInWithLockout()` wrapper calls this Fn BEFORE invoking
 * `supabase.auth.signInWithPassword`. The Fn:
 *
 *   - `check`       → looks up `auth_attempts_log` for failure counts and
 *                     returns `{ allowed: false, reason, locked_until }`
 *                     once D-03 thresholds are crossed (≥5 failures within
 *                     15 min, locked for 30 min) or `{ allowed: true }`.
 *
 *   - `log_failure` → inserts a `failed` row tagged with the email + IP +
 *                     UA + failure_reason, THEN checks D-05 brute-force
 *                     thresholds (≥10 IP/h or ≥20 email/h) and emits
 *                     PostHog `auth_brute_force_detected` + Slack alert
 *                     once crossed.
 *
 *   - `log_success` → inserts a `success` row AND clears the prior 15-min
 *                     failure window for the email (D-03: a successful
 *                     sign-in unlocks the account).
 *
 * === Auth ===
 * UNAUTHENTICATED — pre-sign-in surface. There is no JWT to validate.
 * Per D-04 (66-CONTEXT) the Fn cannot proxy Supabase's managed
 * `/auth/v1/token` endpoint, so a determined attacker can bypass this
 * Fn by hitting Supabase directly. The protection is best-effort + is
 * backstopped by PostHog-side monitoring. Documented in CARRY-OVER.
 *
 * === DB writes ===
 * `auth_attempts_log` has `service_role` bypass only (RLS denies all
 * authenticated). Writes go through the service-role client.
 *
 * === Endpoints ===
 * GET /healthz → 200 { ok: true, fn: 'auth-rate-limit-check' }
 * POST /       → JSON { email?, action: 'check'|'log_failure'|'log_success', failure_reason? }
 *
 * === Deno.serve guard ===
 * Per [[reference_deno_test_top_level_serve_trap]] — Deno.serve lives in
 * index.ts behind `if (import.meta.main)` so tests can import handler.ts
 * without binding an HTTP socket.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { sendSlackGuardrailAlert } from '../_shared/slack-guardrail-alert.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

export type RateLimitAction = 'check' | 'log_failure' | 'log_success';
export type AttemptOutcome = 'success' | 'failed' | 'locked' | 'captcha';
export type AttemptSource = 'password' | 'magic_link' | 'oauth' | 'mfa';

export interface RateLimitRequestBody {
  email?: string;
  action: RateLimitAction;
  failure_reason?: string;
  source?: AttemptSource;
}

export interface CheckResponseAllowed {
  allowed: true;
}

export interface CheckResponseLocked {
  allowed: false;
  reason: 'email' | 'ip';
  locked_until: string; // ISO timestamp
}

export type CheckResponse = CheckResponseAllowed | CheckResponseLocked;

export interface LogResponse {
  ok: true;
  brute_force?: { kind: 'ip' | 'email'; count: number };
}

/**
 * Minimal interface for the PostHog seam — we don't pull the full
 * posthog-server.ts module here to keep this Fn's dep graph small and
 * to make the brute-force capture path easy to stub in tests.
 */
export interface PostHogSink {
  capture(event: {
    distinctId: string;
    event: string;
    properties: Record<string, unknown>;
  }): void;
}

export interface RateLimitDeps {
  /** Supabase service-role client (RLS bypass needed for auth_attempts_log). */
  supabaseServiceClient: ReturnType<typeof createClient>;
  /** Optional PostHog seam. When omitted, brute-force capture is a no-op. */
  posthog?: PostHogSink;
  /** Optional Slack alert seam. Defaults to the shared `_shared/slack-guardrail-alert.ts`. */
  sendSlack?: typeof sendSlackGuardrailAlert;
  /** Override `now()` for deterministic tests. */
  now?: () => Date;
}

// ─── D-03 + D-05 thresholds ──────────────────────────────────────────────────

/** D-03: 5 failed attempts in 15 min → 30 min lockout. */
export const LOCKOUT_WINDOW_MIN = 15;
export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_DURATION_MIN = 30;

/** D-05: brute-force alert thresholds (1h window). */
export const BRUTE_FORCE_WINDOW_MIN = 60;
export const BRUTE_FORCE_IP_THRESHOLD = 10;
export const BRUTE_FORCE_EMAIL_THRESHOLD = 20;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isoMinusMinutes(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

function isoPlusMinutes(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

/**
 * Extract caller IP from common Edge proxy headers. Supabase Edge sets
 * `x-forwarded-for` (first hop wins). We fall back to `x-real-ip` and
 * finally `cf-connecting-ip` for completeness. Returns `null` when no
 * header is present (local invocation / test).
 */
export function extractClientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff && xff.length > 0) {
    // First entry is the original client.
    return xff.split(',')[0]?.trim() || null;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  return null;
}

function normalizeEmail(email: string | undefined | null): string | null {
  if (!email) return null;
  return email.trim().toLowerCase();
}

// ─── Main handler ────────────────────────────────────────────────────────────

export async function handle(
  req: Request,
  deps: RateLimitDeps,
): Promise<Response> {
  const url = new URL(req.url);

  // ── GET /healthz ───────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname.endsWith('/healthz')) {
    return jsonResponse({ ok: true, fn: 'auth-rate-limit-check' });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  let body: RateLimitRequestBody;
  try {
    body = await req.json() as RateLimitRequestBody;
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  if (!body || typeof body.action !== 'string') {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const now = (deps.now ?? (() => new Date()))();
  const email = normalizeEmail(body.email);
  const ip = extractClientIp(req);
  const userAgent = req.headers.get('user-agent') ?? null;

  switch (body.action) {
    case 'check':
      return handleCheck({ email, ip, now, deps });
    case 'log_failure':
      return handleLogFailure({
        email,
        ip,
        userAgent,
        failureReason: body.failure_reason ?? null,
        source: body.source ?? 'password',
        now,
        deps,
      });
    case 'log_success':
      return handleLogSuccess({
        email,
        ip,
        userAgent,
        source: body.source ?? 'password',
        now,
        deps,
      });
    default:
      return jsonResponse({ error: 'invalid_action' }, 400);
  }
}

// ─── Action: check ───────────────────────────────────────────────────────────

interface CheckArgs {
  email: string | null;
  ip: string | null;
  now: Date;
  deps: RateLimitDeps;
}

async function handleCheck(
  { email, ip, now, deps }: CheckArgs,
): Promise<Response> {
  const windowStart = isoMinusMinutes(now, LOCKOUT_WINDOW_MIN);

  // Email lockout check.
  if (email) {
    const emailFailures = await countFailures({
      client: deps.supabaseServiceClient,
      field: 'email',
      value: email,
      sinceIso: windowStart,
    });
    if (emailFailures >= LOCKOUT_THRESHOLD) {
      const lockedUntil = isoPlusMinutes(now, LOCKOUT_DURATION_MIN);
      const resp: CheckResponseLocked = {
        allowed: false,
        reason: 'email',
        locked_until: lockedUntil,
      };
      return jsonResponse(resp);
    }
  }

  // IP lockout check (independent of email per D-03).
  if (ip) {
    const ipFailures = await countFailures({
      client: deps.supabaseServiceClient,
      field: 'ip_address',
      value: ip,
      sinceIso: windowStart,
    });
    if (ipFailures >= LOCKOUT_THRESHOLD) {
      const lockedUntil = isoPlusMinutes(now, LOCKOUT_DURATION_MIN);
      const resp: CheckResponseLocked = {
        allowed: false,
        reason: 'ip',
        locked_until: lockedUntil,
      };
      return jsonResponse(resp);
    }
  }

  const resp: CheckResponseAllowed = { allowed: true };
  return jsonResponse(resp);
}

// ─── Action: log_failure ─────────────────────────────────────────────────────

interface LogFailureArgs {
  email: string | null;
  ip: string | null;
  userAgent: string | null;
  failureReason: string | null;
  source: AttemptSource;
  now: Date;
  deps: RateLimitDeps;
}

async function handleLogFailure(
  args: LogFailureArgs,
): Promise<Response> {
  const { email, ip, userAgent, failureReason, source, now, deps } = args;

  // Insert the failure row first (separately from the threshold check).
  // The IP / email columns are nullable so a request without either still
  // lands a row for forensic review.
  await insertAttempt({
    client: deps.supabaseServiceClient,
    row: {
      attempt_at: now.toISOString(),
      email,
      ip_address: ip,
      user_agent: userAgent,
      outcome: 'failed',
      failure_reason: failureReason,
      source,
    },
  });

  // D-05 brute-force thresholds use a 1h window separate from D-03.
  const windowStart = isoMinusMinutes(now, BRUTE_FORCE_WINDOW_MIN);
  let bruteForce: LogResponse['brute_force'] = undefined;

  if (ip) {
    const ipCount = await countFailures({
      client: deps.supabaseServiceClient,
      field: 'ip_address',
      value: ip,
      sinceIso: windowStart,
    });
    if (ipCount >= BRUTE_FORCE_IP_THRESHOLD) {
      bruteForce = { kind: 'ip', count: ipCount };
      void emitBruteForceAlert({
        deps,
        kind: 'ip',
        identifier: ip,
        count: ipCount,
        windowMinutes: BRUTE_FORCE_WINDOW_MIN,
      });
    }
  }

  if (email) {
    const emailCount = await countFailures({
      client: deps.supabaseServiceClient,
      field: 'email',
      value: email,
      sinceIso: windowStart,
    });
    if (emailCount >= BRUTE_FORCE_EMAIL_THRESHOLD) {
      // Email threshold takes precedence in the returned payload because
      // the operator escalation pages identify suspected account-takeover
      // attempts more concretely.
      bruteForce = { kind: 'email', count: emailCount };
      void emitBruteForceAlert({
        deps,
        kind: 'email',
        identifier: email,
        count: emailCount,
        windowMinutes: BRUTE_FORCE_WINDOW_MIN,
      });
    }
  }

  const resp: LogResponse = bruteForce
    ? { ok: true, brute_force: bruteForce }
    : { ok: true };
  return jsonResponse(resp);
}

// ─── Action: log_success ─────────────────────────────────────────────────────

interface LogSuccessArgs {
  email: string | null;
  ip: string | null;
  userAgent: string | null;
  source: AttemptSource;
  now: Date;
  deps: RateLimitDeps;
}

async function handleLogSuccess(
  args: LogSuccessArgs,
): Promise<Response> {
  const { email, ip, userAgent, source, now, deps } = args;

  await insertAttempt({
    client: deps.supabaseServiceClient,
    row: {
      attempt_at: now.toISOString(),
      email,
      ip_address: ip,
      user_agent: userAgent,
      outcome: 'success',
      failure_reason: null,
      source,
    },
  });

  // D-03: a successful sign-in clears the prior failure window for THIS
  // email. We delete failure rows in the lockout window only — keeping
  // older rows preserves the audit trail.
  if (email) {
    const windowStart = isoMinusMinutes(now, LOCKOUT_WINDOW_MIN);
    await deleteRecentFailures({
      client: deps.supabaseServiceClient,
      email,
      sinceIso: windowStart,
    });
  }

  const resp: LogResponse = { ok: true };
  return jsonResponse(resp);
}

// ─── DB helpers (thin wrappers, easy to stub in tests) ───────────────────────

interface CountArgs {
  client: ReturnType<typeof createClient>;
  field: 'email' | 'ip_address';
  value: string;
  sinceIso: string;
}

/**
 * Count `outcome='failed'` rows in `auth_attempts_log` for a given key
 * since `sinceIso`. Uses `.select('id', { count: 'exact', head: true })`
 * so the server returns only the count (no row payload).
 */
async function countFailures(args: CountArgs): Promise<number> {
  const { client, field, value, sinceIso } = args;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = client
    .from('auth_attempts_log')
    .select('id', { count: 'exact', head: true })
    .eq('outcome', 'failed')
    .gte('attempt_at', sinceIso);
  const result = field === 'email'
    ? await q.eq('email', value)
    : await q.eq('ip_address', value);
  if (result.error) {
    console.warn('[auth-rate-limit-check] countFailures error:', result.error);
    return 0;
  }
  return typeof result.count === 'number' ? result.count : 0;
}

interface InsertArgs {
  client: ReturnType<typeof createClient>;
  row: {
    attempt_at: string;
    email: string | null;
    ip_address: string | null;
    user_agent: string | null;
    outcome: AttemptOutcome;
    failure_reason: string | null;
    source: AttemptSource;
  };
}

async function insertAttempt(args: InsertArgs): Promise<void> {
  const { client, row } = args;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = (await (client.from('auth_attempts_log') as any).insert(row)) as {
    error: { message?: string } | null;
  };
  if (error) {
    console.warn('[auth-rate-limit-check] insertAttempt error:', error.message ?? error);
  }
}

interface DeleteArgs {
  client: ReturnType<typeof createClient>;
  email: string;
  sinceIso: string;
}

async function deleteRecentFailures(args: DeleteArgs): Promise<void> {
  const { client, email, sinceIso } = args;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = (await (client.from('auth_attempts_log') as any)
    .delete()
    .eq('outcome', 'failed')
    .eq('email', email)
    .gte('attempt_at', sinceIso)) as { error: { message?: string } | null };
  if (error) {
    console.warn('[auth-rate-limit-check] deleteRecentFailures error:', error.message ?? error);
  }
}

// ─── D-05 alert emission ─────────────────────────────────────────────────────

interface BruteForceArgs {
  deps: RateLimitDeps;
  kind: 'ip' | 'email';
  identifier: string;
  count: number;
  windowMinutes: number;
}

async function emitBruteForceAlert(args: BruteForceArgs): Promise<void> {
  const { deps, kind, identifier, count, windowMinutes } = args;

  // PostHog capture (best-effort, env-gated).
  try {
    deps.posthog?.capture({
      distinctId: kind === 'email' ? identifier : `ip:${identifier}`,
      event: 'auth_brute_force_detected',
      properties: {
        kind,
        identifier,
        count,
        window_minutes: windowMinutes,
        detected_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.warn('[auth-rate-limit-check] PostHog capture threw:', err);
  }

  // Slack alert (regulatory channel — P2 escalation).
  try {
    const sendSlack = deps.sendSlack ?? sendSlackGuardrailAlert;
    await sendSlack('regulatory', {
      severity: 'P2',
      title: `Auth brute-force detected (${kind})`,
      text: `${count} failed sign-in attempts against ${kind}=${identifier} within ${windowMinutes} min.`,
      fields: [
        { title: 'kind', value: kind, short: true },
        { title: 'count', value: String(count), short: true },
        { title: 'window_min', value: String(windowMinutes), short: true },
      ],
    });
  } catch (err) {
    console.warn('[auth-rate-limit-check] Slack alert threw:', err);
  }
}
