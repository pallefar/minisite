/**
 * Phase 22 plan 22-10 — CookieConsentBootstrap (GDPR-01).
 *
 * Behaviors covered:
 *   1. Component renders null (no DOM output — the banner library writes its
 *      own DOM directly to document.body once loaded).
 *   2. Mount calls scheduleConsentInit() exactly once.
 *   3. Re-render does NOT re-invoke scheduleConsentInit() (idempotent
 *      useEffect deps).
 */

import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CookieConsentBootstrap } from '@/components/consent/CookieConsentBootstrap';

const scheduleConsentInitSpy = vi.fn();

vi.mock('@/lib/consent/consent-defer', () => ({
  scheduleConsentInit: () => scheduleConsentInitSpy(),
}));

describe('CookieConsentBootstrap (Phase 22 GDPR-01)', () => {
  beforeEach(() => {
    scheduleConsentInitSpy.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders no DOM output (banner library mounts itself once loaded)', () => {
    const { container } = render(<CookieConsentBootstrap />);
    expect(container.firstChild).toBeNull();
  });

  it('mount calls scheduleConsentInit() exactly once', () => {
    render(<CookieConsentBootstrap />);
    expect(scheduleConsentInitSpy).toHaveBeenCalledTimes(1);
  });

  it('re-render does NOT re-invoke scheduleConsentInit() (idempotent useEffect deps)', () => {
    const { rerender } = render(<CookieConsentBootstrap />);
    rerender(<CookieConsentBootstrap />);
    rerender(<CookieConsentBootstrap />);
    expect(scheduleConsentInitSpy).toHaveBeenCalledTimes(1);
  });
});
