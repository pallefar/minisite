/**
 * Minimal Sentry client for Supabase Edge Functions (Deno runtime).
 *
 * Phase 28 Plan 28-02 — ships here because no existing Edge Function Sentry
 * init existed at Phase 25 D-15 for this project's edge functions.
 *
 * @internal Edge Function / Deno runtime only. Do not import from src/ (browser bundle).
 *
 * Uses npm:@sentry/node@8 as the compatibility layer in Deno — the node
 * package runs correctly via Deno's npm specifier support. NOT @sentry/deno
 * (which is a separate SDK with limited adoption); @sentry/node via npm: is
 * the established approach for Supabase Edge Function Sentry capture.
 *
 * Per [[reference_supabase_edge_function_deploy]]: bundler ignores
 * import_map.json; use npm: specifiers directly.
 *
 * If SENTRY_DSN is not set, captureException is a graceful no-op with a
 * one-time warning (per [[reference_vendor_gated_send_health_check]] pattern).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as SentryNode from 'npm:@sentry/node@8';

let _initialized = false;
let _missingDsnWarned = false;

function ensureInit(): void {
  if (_initialized) return;
  const dsn = Deno.env.get('SENTRY_DSN');
  if (!dsn) {
    if (!_missingDsnWarned) {
      console.warn('[sentry] SENTRY_DSN missing — captureException is a no-op until set.');
      _missingDsnWarned = true;
    }
    _initialized = true;
    return;
  }
  SentryNode.init({ dsn });
  _initialized = true;
}

/**
 * Capture an exception with optional context.
 * Matches the @sentry/node / @sentry/react API subset used in with-org-scope.ts.
 */
export function captureException(
  exception: unknown,
  hint?: {
    level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug' | 'log';
    tags?: Record<string, string>;
  },
): void {
  ensureInit();
  const dsn = Deno.env.get('SENTRY_DSN');
  if (!dsn) return; // no-op if DSN not configured

  SentryNode.captureException(exception, {
    level: hint?.level,
    tags: hint?.tags,
  });
}

/**
 * Capture a message with optional context.
 * Added for P29 D-04 billing variance alerts (level='warning').
 * Also used by clinic-patient-invite for generateLink failure warnings.
 */
export function captureMessage(
  message: string,
  options?: {
    level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug' | 'log';
    extra?: Record<string, unknown>;
    tags?: Record<string, string>;
  },
): void {
  ensureInit();
  const dsn = Deno.env.get('SENTRY_DSN');
  if (!dsn) return; // no-op if DSN not configured

  SentryNode.captureMessage(message, {
    level: options?.level,
    extra: options?.extra,
    tags: options?.tags,
  });
}
