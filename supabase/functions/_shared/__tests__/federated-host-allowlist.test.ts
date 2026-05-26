/**
 * federated-host-allowlist.test.ts — Vitest unit tests for SSRF host allowlist.
 *
 * Phase 60 Plan 60-07. Task 1 (TDD RED → GREEN).
 *
 * 8 test cases per plan spec:
 *  T1: Known-good PubMed HTTPS URL → no throw
 *  T2: Known-good OpenFDA HTTPS URL → no throw
 *  T3: Known-good DailyMed HTTPS URL → no throw
 *  T4: HTTP (not HTTPS) PubMed URL → throws SSRFHostBlockedError
 *  T5: Unknown host → throws SSRFHostBlockedError + fires PostHog + Slack
 *  T6: Suffix-match attack (api.ncbi.nlm.nih.gov.evil.com) → throws
 *  T7: IP literal 127.0.0.1 → throws
 *  T8: Cloud metadata endpoint 169.254.169.254 → throws
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the PostHog and Slack helpers before importing the module under test
vi.mock('../posthog-rag-events.ts', () => ({
  emitAi04FenceBreach: vi.fn(),
}));

vi.mock('../slack-guardrail-alert.ts', () => ({
  sendSlackGuardrailAlert: vi.fn().mockResolvedValue(undefined),
}));

import {
  assertAllowedHost,
  FEDERATED_ALLOWED_HOSTS,
  SSRFHostBlockedError,
} from '../federated-host-allowlist.ts';
import { emitAi04FenceBreach } from '../posthog-rag-events.ts';
import { sendSlackGuardrailAlert } from '../slack-guardrail-alert.ts';

describe('FEDERATED_ALLOWED_HOSTS', () => {
  it('exports exactly 3 hosts', () => {
    expect(FEDERATED_ALLOWED_HOSTS).toHaveLength(3);
    expect(FEDERATED_ALLOWED_HOSTS).toContain('api.ncbi.nlm.nih.gov');
    expect(FEDERATED_ALLOWED_HOSTS).toContain('api.fda.gov');
    expect(FEDERATED_ALLOWED_HOSTS).toContain('dailymed.nlm.nih.gov');
  });
});

describe('assertAllowedHost', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('T1: allows valid PubMed HTTPS URL', () => {
    expect(() =>
      assertAllowedHost('https://api.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed'),
    ).not.toThrow();
  });

  it('T2: allows valid OpenFDA HTTPS URL', () => {
    expect(() =>
      assertAllowedHost('https://api.fda.gov/drug/label.json?search=tirzepatide'),
    ).not.toThrow();
  });

  it('T3: allows valid DailyMed HTTPS URL', () => {
    expect(() =>
      assertAllowedHost(
        'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name=tirzepatide',
      ),
    ).not.toThrow();
  });

  it('T4: blocks HTTP (non-HTTPS) even for allowed host', () => {
    expect(() =>
      assertAllowedHost('http://api.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi'),
    ).toThrow(SSRFHostBlockedError);
  });

  it('T5: blocks unknown host + fires PostHog + Slack alerts', () => {
    expect(() =>
      assertAllowedHost('https://evil.example.com/steal'),
    ).toThrow(SSRFHostBlockedError);

    expect(emitAi04FenceBreach).toHaveBeenCalledOnce();
    expect(sendSlackGuardrailAlert).toHaveBeenCalledOnce();
    // Verify Slack fires to pharma02 channel with P1 severity
    expect(sendSlackGuardrailAlert).toHaveBeenCalledWith(
      'pharma02',
      expect.objectContaining({ severity: 'P1' }),
    );
  });

  it('T6: blocks suffix-match attack (uses strict equality, not includes)', () => {
    // This would pass a naive `.includes('api.ncbi.nlm.nih.gov')` check
    expect(() =>
      assertAllowedHost('https://api.ncbi.nlm.nih.gov.evil.com/malicious'),
    ).toThrow(SSRFHostBlockedError);
  });

  it('T7: blocks IP literal 127.0.0.1', () => {
    expect(() =>
      assertAllowedHost('https://127.0.0.1/internal'),
    ).toThrow(SSRFHostBlockedError);
  });

  it('T8: blocks cloud metadata endpoint 169.254.169.254', () => {
    expect(() =>
      assertAllowedHost('https://169.254.169.254/latest/meta-data/'),
    ).toThrow(SSRFHostBlockedError);
  });
});
