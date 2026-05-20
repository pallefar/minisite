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

/**
 * Phase 38 Plan 38-02 — add a breadcrumb to the current Sentry scope.
 *
 * The Anthropic-summarize wrapper emits `baa.scope.resolved` BEFORE the
 * `/v1/messages` call so an audit replay can prove the BAA-scope decision
 * happened before the prompt was built (Phase 25 HIPAA-01 audit pattern).
 *
 * The breadcrumb buffer is *also* exposed via `__getBreadcrumbsForTest()`
 * below as a unit-test seam — Deno doesn't ship a Sentry recorder shim, so we
 * keep an in-memory mirror tagged when SENTRY_DSN is unset (test mode).
 *
 * Vendor-gated: when SENTRY_DSN is set, the breadcrumb is forwarded to the
 * real Sentry client; when unset, it lives only in the in-memory mirror.
 *
 * NEVER include PHI in breadcrumb.data — keep it to scope tags + timestamps.
 */
const _testBreadcrumbs: Array<{
  category: string;
  message?: string;
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug' | 'log';
  data?: Record<string, unknown>;
  timestamp: number;
}> = [];

export function addBreadcrumb(crumb: {
  category: string;
  message?: string;
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug' | 'log';
  data?: Record<string, unknown>;
}): void {
  ensureInit();
  const ts = Date.now() / 1000;
  // Always record in test mirror so unit tests can assert order without
  // needing a live Sentry DSN.
  _testBreadcrumbs.push({ ...crumb, timestamp: ts });
  const dsn = Deno.env.get('SENTRY_DSN');
  if (!dsn) return; // no-op forward when DSN unset
  SentryNode.addBreadcrumb({
    category: crumb.category,
    message: crumb.message,
    level: crumb.level,
    data: crumb.data,
    timestamp: ts,
  });
}

/** Test-only seam: read the in-memory breadcrumb mirror. */
export function __getBreadcrumbsForTest(): ReadonlyArray<{
  category: string;
  message?: string;
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug' | 'log';
  data?: Record<string, unknown>;
  timestamp: number;
}> {
  return _testBreadcrumbs;
}

/** Test-only seam: clear the in-memory breadcrumb mirror between tests. */
export function __resetBreadcrumbsForTest(): void {
  _testBreadcrumbs.length = 0;
}

/**
 * Convenience wrapper for Phase 50 Plan 50-04 rag-scrape-runner contract.
 * Equivalent to `captureException(err, { tags })` but matches the plan's
 * named-arg shape so call sites read naturally:
 *
 *   sentryCapture(err, { 'rag.scraper.failed': '1', source_id, topic_id })
 *
 * Vendor-gated: no-op when SENTRY_DSN missing (delegates to captureException).
 */
export function sentryCapture(
  err: unknown,
  tags: Record<string, string> = {},
): void {
  captureException(err, { tags });
}
