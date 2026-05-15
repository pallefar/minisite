/**
 * Referer-host allowlist check for affiliate click fraud filtering (D-28).
 *
 * Each affiliate row carries `allowed_referer_hosts text[]` — populated by
 * the admin during application review (e.g. ["instagram.com",
 * "www.tiktok.com"]). At click time, if the request's `Referer` header
 * doesn't match any allowed host, the click is FLAGGED (still INSERTed
 * into affiliate_clicks per D-27, but Set-Cookie is suppressed so
 * attribution does not stick).
 *
 * Edge cases:
 *   - Missing/empty `Referer` header → return false (caller decides
 *     mobile-app exemption via User-Agent inspection).
 *   - Empty `allowedHosts` array → return true (no per-affiliate
 *     restriction set; admin has not added any allowlist entries).
 *   - Malformed Referer URL → return false (defensive; URL parser
 *     throws on garbage).
 *   - Case-insensitive host compare (browsers normalize but be defensive).
 */

export function isRefererAllowed(
  refererHeader: string | null,
  allowedHosts: string[] | null | undefined,
): boolean {
  // No per-affiliate restriction means the affiliate accepts traffic from
  // anywhere (e.g. a newsletter affiliate whose Referer is hidden).
  if (!allowedHosts || allowedHosts.length === 0) {
    return true;
  }

  // Missing Referer with a configured allowlist = reject. Caller layers on
  // a mobile-app exemption (User-Agent: LeanShot/...) before this check.
  if (refererHeader === null || refererHeader === '') {
    return false;
  }

  let host: string;
  try {
    host = new URL(refererHeader).host.toLowerCase();
  } catch {
    return false;
  }

  // Strip leading "www." for normalized compare. e.g. allowlist
  // ["instagram.com"] should match Referer https://www.instagram.com/u.
  const normalizedHost = host.replace(/^www\./, '');

  for (const allowed of allowedHosts) {
    const normalizedAllowed = allowed.trim().toLowerCase().replace(/^www\./, '');
    if (normalizedHost === normalizedAllowed) {
      return true;
    }
  }
  return false;
}
