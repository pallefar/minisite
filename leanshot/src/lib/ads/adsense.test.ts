/**
 * Phase 56 Plan 03 — AdSense injector tests (AD-02).
 *
 * Tests run in jsdom environment via Vitest.
 * Uses @vitest/globals through vite.config.ts test setup.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { injectAdSenseScript, subscribeAdSenseConsent } from './adsense';

const ADSENSE_SCRIPT_ID = 'adsense-script';
const PUBLISHER_ID = 'ca-pub-1234567890';

function getScript(): HTMLElement | null {
  return document.getElementById(ADSENSE_SCRIPT_ID);
}

function removeScript(): void {
  const el = getScript();
  if (el) el.remove();
}

beforeEach(() => {
  removeScript();
});

afterEach(() => {
  removeScript();
});

describe('injectAdSenseScript', () => {
  it('injects a script tag with correct src and data-ad-client', () => {
    injectAdSenseScript(PUBLISHER_ID);

    const script = getScript();
    expect(script).not.toBeNull();
    expect(script!.getAttribute('src')).toContain(PUBLISHER_ID);
    expect(script!.getAttribute('data-ad-client')).toBe(PUBLISHER_ID);
  });

  it('is idempotent — calling twice does not duplicate the script', () => {
    injectAdSenseScript(PUBLISHER_ID);
    injectAdSenseScript(PUBLISHER_ID);

    const scripts = document.querySelectorAll(`#${ADSENSE_SCRIPT_ID}`);
    expect(scripts.length).toBe(1);
  });

  it('does NOT inject when publisherId is empty string', () => {
    injectAdSenseScript('');
    expect(getScript()).toBeNull();
  });

  it('does NOT inject when publisherId is falsy (undefined cast to empty)', () => {
    injectAdSenseScript(undefined as unknown as string);
    expect(getScript()).toBeNull();
  });
});

describe('subscribeAdSenseConsent', () => {
  it('injects script when marketing consent is granted via event', () => {
    const cleanup = subscribeAdSenseConsent(PUBLISHER_ID);

    const event = new CustomEvent('leanshot:consent-change', {
      detail: { categories: { marketing: true } },
    });
    window.dispatchEvent(event);

    expect(getScript()).not.toBeNull();
    cleanup();
  });

  it('does NOT inject when marketing consent is false', () => {
    const cleanup = subscribeAdSenseConsent(PUBLISHER_ID);

    const event = new CustomEvent('leanshot:consent-change', {
      detail: { categories: { marketing: false } },
    });
    window.dispatchEvent(event);

    expect(getScript()).toBeNull();
    cleanup();
  });

  it('does NOT inject when publisherId is empty even if marketing consent is true', () => {
    const cleanup = subscribeAdSenseConsent('');

    const event = new CustomEvent('leanshot:consent-change', {
      detail: { categories: { marketing: true } },
    });
    window.dispatchEvent(event);

    expect(getScript()).toBeNull();
    cleanup();
  });

  it('cleanup removes the event listener', () => {
    const cleanup = subscribeAdSenseConsent(PUBLISHER_ID);
    cleanup();

    // Fire event after cleanup — should not inject.
    removeScript(); // clear any prior state
    const event = new CustomEvent('leanshot:consent-change', {
      detail: { categories: { marketing: true } },
    });
    window.dispatchEvent(event);

    expect(getScript()).toBeNull();
  });
});
