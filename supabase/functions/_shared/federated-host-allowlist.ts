/**
 * federated-host-allowlist.ts — SSRF host allowlist for Phase 60 federated adapter Fns.
 *
 * Phase 60 Plan 60-07. T-60-07-01 SSRF mitigation.
 *
 * Uses strict URL.hostname equality against an explicit 3-host allowlist.
 * Does NOT use `.includes()` or regex — defeats suffix-match attacks like
 * `api.ncbi.nlm.nih.gov.evil.com`.
 *
 * Explicitly denies:
 *   - Non-https protocols (http:, ftp:, etc.)
 *   - IP literals (127.0.0.1, 0.0.0.0, etc.)
 *   - Cloud metadata endpoint (169.254.169.254)
 *
 * Fail-closed: any URL parse error throws SSRFHostBlockedError.
 *
 * On rejection:
 *   1. Emits PostHog `federated_host_allowlist_blocked` event (best-effort)
 *   2. Fires Slack P1 alert to `pharma02` channel (best-effort)
 *   3. Throws SSRFHostBlockedError
 *
 * [[T-60-07-01]] [[reference_deno_test_top_level_serve_trap]]
 */

import { emitAi04FenceBreach } from './posthog-rag-events.ts';
import { sendSlackGuardrailAlert } from './slack-guardrail-alert.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Allowlist — exactly the 3 hosts per AI-SPEC §6
// ──────────────────────────────────────────────────────────────────────────────

export const FEDERATED_ALLOWED_HOSTS = [
  'api.ncbi.nlm.nih.gov',
  'api.fda.gov',
  'dailymed.nlm.nih.gov',
] as const;

// ──────────────────────────────────────────────────────────────────────────────
// Explicit IP deny-list (belt-and-braces — numeric IPs also fail allowlist)
// 127.0.0.1  — loopback
// 169.254.169.254 — IMDS metadata endpoint (AWS/GCP/Azure)
// ──────────────────────────────────────────────────────────────────────────────

const DENIED_IP_PREFIXES = ['127.', '0.', '169.254.', '::1', '10.', '172.'];
const DENIED_IP_EXACT = ['169.254.169.254', '127.0.0.1', '0.0.0.0', '::1'];

// ──────────────────────────────────────────────────────────────────────────────
// Error class
// ──────────────────────────────────────────────────────────────────────────────

export class SSRFHostBlockedError extends Error {
  constructor(
    public readonly blockedUrl: string,
    public readonly reason: string,
  ) {
    super(`[federated-host-allowlist] SSRF blocked: ${reason}. URL: ${blockedUrl}`);
    this.name = 'SSRFHostBlockedError';
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal helpers (exported for testability)
// ──────────────────────────────────────────────────────────────────────────────

/** Returns true when the string looks like a raw IP address (v4 or v6). */
export function isIpLiteral(hostname: string): boolean {
  if (DENIED_IP_EXACT.includes(hostname)) return true;
  // IPv4: 4 dot-separated numeric segments
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  // IPv6 bracket-stripped or bare
  if (hostname.startsWith('[') || hostname.includes(':')) return true;
  // IMDS prefix check
  if (DENIED_IP_PREFIXES.some((prefix) => hostname.startsWith(prefix))) return true;
  return false;
}

// ──────────────────────────────────────────────────────────────────────────────
// Primary export
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Assert that `urlString` targets an allowed host.
 *
 * Throws `SSRFHostBlockedError` + fires async PostHog + Slack alerts on any violation.
 * All violations are fail-closed (throws before any network call).
 *
 * @param urlString - The full URL to validate (e.g. 'https://api.ncbi.nlm.nih.gov/...')
 * @throws {SSRFHostBlockedError} When the host is not on the allowlist or the protocol is non-HTTPS
 */
export function assertAllowedHost(urlString: string): void {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    _fireBlockEvents(urlString, 'URL parse error');
    throw new SSRFHostBlockedError(urlString, 'URL parse error');
  }

  // Protocol check — https only
  if (parsed.protocol !== 'https:') {
    _fireBlockEvents(urlString, `non-HTTPS protocol: ${parsed.protocol}`);
    throw new SSRFHostBlockedError(urlString, `non-HTTPS protocol: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname;

  // IP literal check (explicit deny for 127.0.0.1, 169.254.169.254 etc.)
  if (isIpLiteral(hostname)) {
    _fireBlockEvents(urlString, `IP literal denied: ${hostname}`);
    throw new SSRFHostBlockedError(urlString, `IP literal denied: ${hostname}`);
  }

  // Strict-equality check against allowlist (NOT includes/startsWith — defeats suffix attack)
  const isAllowed = (FEDERATED_ALLOWED_HOSTS as readonly string[]).includes(hostname);
  if (!isAllowed) {
    _fireBlockEvents(urlString, `host not in allowlist: ${hostname}`);
    throw new SSRFHostBlockedError(urlString, `host not in allowlist: ${hostname}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Side-effect helpers (best-effort, never throw back to caller)
// ──────────────────────────────────────────────────────────────────────────────

function _fireBlockEvents(url: string, reason: string): void {
  const traceId = `ssrf-block-${Date.now()}`;
  // PostHog: federated_host_allowlist_blocked (maps to rag_ai04_fence_breach event)
  try {
    emitAi04FenceBreach({
      properties: {
        event_subtype: 'federated_host_allowlist_blocked',
        blocked_url: url,
        block_reason: reason,
        trace_id: traceId,
      },
    });
  } catch {
    // best-effort
  }
  // Slack: P1 to pharma02 — host-allowlist trip = potential SSRF attack path
  sendSlackGuardrailAlert('pharma02', {
    severity: 'P1',
    title: '[rag-federated] SSRF host allowlist blocked',
    text: `Blocked URL: ${url}\nReason: ${reason}`,
    trace_id: traceId,
  }).catch(() => {
    // best-effort
  });
}
