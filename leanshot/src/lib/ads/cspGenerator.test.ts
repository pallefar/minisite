/**
 * Phase 56 Plan 04 — cspGenerator unit tests (AD-09)
 *
 * Verifies:
 *  1. filterBlocklisted removes GLP-1 competitor hosts (case-insensitive)
 *  2. appendAdNetworkHosts appends only to script-src and connect-src
 *  3. Empty host lists leave the CSP unchanged
 *  4. A block-listed host NEVER survives into the final CSP
 */
import { describe, it, expect } from 'vitest';
import { filterBlocklisted, appendAdNetworkHosts } from './cspGenerator';

const BASE_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://api.example.com; frame-src 'self'; img-src 'self' data:;";

describe('filterBlocklisted', () => {
  it('removes hosts present in the blocklist (exact match)', () => {
    const allow = [
      { hostname: 'googlesyndication.com', directive: 'script-src' as const },
      { hostname: 'wegovy.com', directive: 'script-src' as const },
      { hostname: 'doubleclick.net', directive: 'connect-src' as const },
    ];
    const block = ['wegovy.com'];
    const result = filterBlocklisted(allow, block);
    expect(result.map((r) => r.hostname)).toEqual([
      'googlesyndication.com',
      'doubleclick.net',
    ]);
  });

  it('applies case-insensitive hostname matching', () => {
    const allow = [
      { hostname: 'Ozempic.com', directive: 'connect-src' as const },
      { hostname: 'safe-ads.net', directive: 'connect-src' as const },
    ];
    const block = ['ozempic.com'];
    const result = filterBlocklisted(allow, block);
    expect(result.map((r) => r.hostname)).toEqual(['safe-ads.net']);
  });

  it('returns the full list when blocklist is empty', () => {
    const allow = [
      { hostname: 'googlesyndication.com', directive: 'script-src' as const },
    ];
    const result = filterBlocklisted(allow, []);
    expect(result).toHaveLength(1);
  });

  it('returns empty array when all hosts are blocked', () => {
    const allow = [
      { hostname: 'wegovy.com', directive: 'script-src' as const },
      { hostname: 'ozempic.com', directive: 'connect-src' as const },
    ];
    const block = ['wegovy.com', 'ozempic.com'];
    expect(filterBlocklisted(allow, block)).toHaveLength(0);
  });
});

describe('appendAdNetworkHosts', () => {
  it('appends https://<host> to script-src directive', () => {
    const result = appendAdNetworkHosts(
      BASE_CSP,
      ['googlesyndication.com'],
      [],
    );
    expect(result).toContain(
      "script-src 'self' 'unsafe-inline' https://googlesyndication.com;",
    );
  });

  it('appends https://<host> to connect-src directive', () => {
    const result = appendAdNetworkHosts(BASE_CSP, [], ['doubleclick.net']);
    expect(result).toContain(
      "connect-src 'self' https://api.example.com https://doubleclick.net;",
    );
  });

  it('appends to both script-src and connect-src simultaneously', () => {
    const result = appendAdNetworkHosts(
      BASE_CSP,
      ['googlesyndication.com'],
      ['doubleclick.net'],
    );
    expect(result).toContain(
      "script-src 'self' 'unsafe-inline' https://googlesyndication.com;",
    );
    expect(result).toContain(
      "connect-src 'self' https://api.example.com https://doubleclick.net;",
    );
  });

  it('does NOT modify frame-src or other directives', () => {
    const result = appendAdNetworkHosts(
      BASE_CSP,
      ['googlesyndication.com'],
      ['doubleclick.net'],
    );
    expect(result).toContain("frame-src 'self';");
    expect(result).toContain("img-src 'self' data:;");
  });

  it('returns CSP unchanged when both host lists are empty', () => {
    const result = appendAdNetworkHosts(BASE_CSP, [], []);
    expect(result).toBe(BASE_CSP);
  });

  it('returns CSP unchanged when script list is empty (only connect list provided)', () => {
    const result = appendAdNetworkHosts(BASE_CSP, [], ['doubleclick.net']);
    // script-src must be unchanged
    expect(result).toContain("script-src 'self' 'unsafe-inline';");
  });

  it('SECURITY: block-listed GLP-1 host NEVER survives into the CSP', () => {
    // Simulate: wegovy.com accidentally slipped into the allow rows
    const allowRows = [
      { hostname: 'googlesyndication.com', directive: 'script-src' as const },
      { hostname: 'wegovy.com', directive: 'script-src' as const }, // must be filtered
    ];
    const blockHosts = ['wegovy.com'];
    const filtered = filterBlocklisted(allowRows, blockHosts);
    const scriptHosts = filtered
      .filter((r) => r.directive === 'script-src')
      .map((r) => r.hostname);
    const connectHosts = filtered
      .filter((r) => r.directive === 'connect-src')
      .map((r) => r.hostname);
    const finalCsp = appendAdNetworkHosts(BASE_CSP, scriptHosts, connectHosts);
    expect(finalCsp).not.toContain('wegovy.com');
    expect(finalCsp).toContain('https://googlesyndication.com');
  });
});
