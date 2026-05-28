/**
 * Phase 56 Plan 04 — CSP allowlist generator (AD-09)
 *
 * Pure functions for generating ad-network CSP directives, with block-list
 * enforcement to ensure GLP-1 competitor hosts NEVER appear in the CSP.
 *
 * No imports from native/health modules — file is under src/lib/ads/.
 */

export interface CspAllowRow {
  hostname: string;
  directive: 'script-src' | 'connect-src';
}

/**
 * Filter out any allow-list rows whose hostname appears in the block list.
 * Comparison is case-insensitive to prevent bypass via mixed case.
 *
 * T-56-11 (Repudiation): block-listed GLP-1 hosts are structurally excluded
 * BEFORE any CSP append — they cannot survive into the final header.
 */
export function filterBlocklisted(allow: CspAllowRow[], block: string[]): CspAllowRow[] {
  const blockSet = new Set(block.map((h) => h.toLowerCase()));
  return allow.filter((row) => !blockSet.has(row.hostname.toLowerCase()));
}

/**
 * Append approved ad-network hosts to the `script-src` and `connect-src`
 * directives of an existing CSP string.
 *
 * Mirrors the `appendFrameSrcHosts` pattern in middleware.ts:
 *   - Anchored on the `;` terminator so only the target directive is modified.
 *   - When a host list is empty, that directive is left unchanged (no orphan
 *     whitespace).
 *   - `https://` is prepended to every host (exact, no wildcard — D-15).
 *   - Other directives (frame-src, img-src, default-src, etc.) are untouched.
 */
export function appendAdNetworkHosts(
  csp: string,
  scriptHosts: string[],
  connectHosts: string[],
): string {
  let result = csp;

  if (scriptHosts.length > 0) {
    const formatted = scriptHosts.map((h) => `https://${h}`).join(' ');
    result = result.replace(/script-src ([^;]+);/, (_match, dirs: string) => {
      return `script-src ${dirs.trim()} ${formatted};`;
    });
  }

  if (connectHosts.length > 0) {
    const formatted = connectHosts.map((h) => `https://${h}`).join(' ');
    result = result.replace(/connect-src ([^;]+);/, (_match, dirs: string) => {
      return `connect-src ${dirs.trim()} ${formatted};`;
    });
  }

  return result;
}
