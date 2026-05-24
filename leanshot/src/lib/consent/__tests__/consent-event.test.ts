/**
 * Phase 41 plan 41-01 — Task 1: canonical consent-change event contract.
 *
 * Behaviors covered (per PLAN.md <behavior>):
 *   1. `subscribeToConsentChange(handler)` registers the handler so that a
 *      manually-dispatched `new CustomEvent(CONSENT_CHANGE_EVENT, {detail})`
 *      invokes it with the typed detail.
 *   2. The returned unsubscribe function removes the listener (subsequent
 *      dispatches do NOT call the handler).
 *   3. `CONSENT_CHANGE_EVENT` literal value is `'leanshot:consent-change'`
 *      (frozen string contract — downstream Deno renderer in Plan 41-03
 *      hardcodes this same literal in emitted inline JS).
 *
 * Threat coverage (per 41-01 PLAN.md <threat_model>):
 *   - T-41-01-02 — subscribers SHOULD also read CookieConsent.acceptedCategory()
 *     at mount, but the event contract itself MUST cleanly unsubscribe to
 *     avoid stale handlers leaking past unmount.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONSENT_CHANGE_EVENT,
  type ConsentChangeDetail,
  subscribeToConsentChange,
} from '@/lib/consent/consent-event';

function buildDetail(overrides: Partial<ConsentChangeDetail['categories']> = {}): ConsentChangeDetail {
  return {
    categories: {
      necessary: true,
      analytics: false,
      marketing: false,
      personalization: false,
      functional: true,
      ...overrides,
    },
  };
}

describe('consent-event (Phase 41 D-09 foundation)', () => {
  beforeEach(() => {
    // Defensive: clean any stray listeners attached by other tests.
  });

  afterEach(() => {
    // No global state to tear down — listeners attached in tests must be
    // removed via the unsubscribe closures returned in each test.
  });

  it('Test 3: CONSENT_CHANGE_EVENT literal value is "leanshot:consent-change" (frozen contract)', () => {
    expect(CONSENT_CHANGE_EVENT).toBe('leanshot:consent-change');
  });

  it('Test 1: subscribeToConsentChange registers handler that fires on dispatched event with typed detail', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToConsentChange(handler);

    const detail = buildDetail({ analytics: true });
    window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(detail);
    // detail is the typed ConsentChangeDetail; spot-check the five booleans
    const arg = handler.mock.calls[0]?.[0] as ConsentChangeDetail;
    expect(arg.categories.necessary).toBe(true);
    expect(arg.categories.analytics).toBe(true);
    expect(arg.categories.marketing).toBe(false);
    expect(arg.categories.personalization).toBe(false);
    expect(arg.categories.functional).toBe(true);

    unsubscribe();
  });

  it('Test 2: unsubscribe closure removes the listener — subsequent dispatches do NOT call handler', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToConsentChange(handler);

    // First dispatch — handler should fire.
    window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: buildDetail() }));
    expect(handler).toHaveBeenCalledTimes(1);

    // Unsubscribe + dispatch again — handler must NOT fire a second time.
    unsubscribe();
    window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: buildDetail({ analytics: true }) }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe is idempotent (calling it twice does not throw)', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToConsentChange(handler);
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });
});
