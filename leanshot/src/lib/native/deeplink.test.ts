// Phase 16 Plan 16-02 Task 2 — unit tests for installDeepLinkHandler().
//
// Runs under `vitest-mobile.config.ts` which aliases `@capacitor/app` to
// the mock at `src/lib/native/__mocks__/capacitor-app.ts`. The mock's
// `App.addListener` is a vi.fn(); we capture the registered handler from
// `App.addListener.mock.calls[0][1]` after installDeepLinkHandler() awaits
// to give the implementation's idempotency guard a chance to set its
// internal `_installed` flag.
//
// Each case drives the captured handler with a synthetic
// `{ url: '<absolute URL>' }` event and asserts the resulting pushState
// path OR window.location.hash mutation.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Helper to spy on window APIs cleanly per case
function setupWindowSpies() {
  const pushState = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
  const dispatchEvent = vi.spyOn(window, 'dispatchEvent').mockImplementation(() => true);
  // hash assignment goes via location property — replace with a writable shim
  const hashSetter = vi.fn();
  // We can't replace window.location directly in jsdom without throwing.
  // Use Object.defineProperty on a clone hung off window.location instead.
  // Approach: capture pre-test hash, replace with a thin proxy that records sets.
  const origLocation = window.location;
  const proxy = new Proxy(origLocation, {
    set(_target, prop, value) {
      if (prop === 'hash') {
        hashSetter(value);
        return true;
      }
      // @ts-expect-error proxy assign
      origLocation[prop] = value;
      return true;
    },
    get(_target, prop) {
      // @ts-expect-error proxy read
      return origLocation[prop];
    },
  });
  Object.defineProperty(window, 'location', { value: proxy, writable: true, configurable: true });
  return {
    pushState,
    dispatchEvent,
    hashSetter,
    restore: () => {
      Object.defineProperty(window, 'location', {
        value: origLocation,
        writable: true,
        configurable: true,
      });
      pushState.mockRestore();
      dispatchEvent.mockRestore();
    },
  };
}

async function loadFreshAndCapture(): Promise<{
  handler: (event: { url: string }) => void;
  addListener: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const { App, __mock } = await import('@capacitor/app');
  __mock.reset();
  // Cast vi.fn to typed Mock — we know the manual mock declares it as vi.fn().
  const addListener = App.addListener as unknown as ReturnType<typeof vi.fn>;
  addListener.mockClear();
  const { installDeepLinkHandler } = await import('./deeplink');
  installDeepLinkHandler();
  // Allow microtask for the async addListener to resolve + _installed flag set
  await Promise.resolve();
  await Promise.resolve();
  const call = addListener.mock.calls[0];
  if (!call) throw new Error('installDeepLinkHandler did not call App.addListener');
  return { handler: call[1] as (event: { url: string }) => void, addListener };
}

describe('installDeepLinkHandler()', () => {
  let spies: ReturnType<typeof setupWindowSpies>;

  beforeEach(() => {
    spies = setupWindowSpies();
  });

  afterEach(() => {
    spies.restore();
    vi.resetModules();
  });

  it('routes /clinic/<slug> via pushState + popstate (PATHNAME)', async () => {
    const { handler } = await loadFreshAndCapture();
    handler({ url: 'https://leanshot.app/clinic/acme-clinic' });
    expect(spies.pushState).toHaveBeenCalledWith({}, '', '/clinic/acme-clinic');
    expect(spies.dispatchEvent).toHaveBeenCalled();
    expect(spies.hashSetter).not.toHaveBeenCalled();
  });

  it('routes /share/<token> via pushState (PATHNAME, query preserved)', async () => {
    const { handler } = await loadFreshAndCapture();
    handler({ url: 'https://leanshot.app/share/abc123?ref=email' });
    expect(spies.pushState).toHaveBeenCalledWith({}, '', '/share/abc123?ref=email');
    expect(spies.dispatchEvent).toHaveBeenCalled();
    expect(spies.hashSetter).not.toHaveBeenCalled();
  });

  it('routes /auth/verify-email?token=… via hash (HASH)', async () => {
    const { handler } = await loadFreshAndCapture();
    handler({ url: 'https://leanshot.app/auth/verify-email?token=xyz' });
    expect(spies.hashSetter).toHaveBeenCalledWith('#/auth/verify-email?token=xyz');
    expect(spies.pushState).not.toHaveBeenCalled();
  });

  it('routes /legal/privacy via hash (HASH)', async () => {
    const { handler } = await loadFreshAndCapture();
    handler({ url: 'https://leanshot.app/legal/privacy' });
    expect(spies.hashSetter).toHaveBeenCalledWith('#/legal/privacy');
    expect(spies.pushState).not.toHaveBeenCalled();
  });

  it('routes /pricing via pushState (marketing PATHNAME)', async () => {
    const { handler } = await loadFreshAndCapture();
    handler({ url: 'https://leanshot.app/pricing' });
    expect(spies.pushState).toHaveBeenCalledWith({}, '', '/pricing');
    expect(spies.dispatchEvent).toHaveBeenCalled();
  });

  it('routes /faq via pushState (marketing PATHNAME)', async () => {
    const { handler } = await loadFreshAndCapture();
    handler({ url: 'https://leanshot.app/faq' });
    expect(spies.pushState).toHaveBeenCalledWith({}, '', '/faq');
  });

  it('routes /r/<code> via pushState (affiliate PATHNAME)', async () => {
    const { handler } = await loadFreshAndCapture();
    handler({ url: 'https://leanshot.app/r/PARTNER01' });
    expect(spies.pushState).toHaveBeenCalledWith({}, '', '/r/PARTNER01');
  });

  it('routes / via pushState fallback (marketing root)', async () => {
    const { handler } = await loadFreshAndCapture();
    handler({ url: 'https://leanshot.app/' });
    // Either matched by PATHNAME_PREFIXES (if '/' is listed) OR by the final
    // fallback pushState('/'). Either way pushState is called with '/'.
    expect(spies.pushState).toHaveBeenCalled();
    const args = spies.pushState.mock.calls[spies.pushState.mock.calls.length - 1];
    expect(args[2]).toBe('/');
  });

  it('idempotency guard: second install does not re-register', async () => {
    const { addListener } = await loadFreshAndCapture();
    // The helper already called installDeepLinkHandler once. Call again on
    // the same module instance (no resetModules) to exercise the guard.
    const { installDeepLinkHandler } = await import('./deeplink');
    installDeepLinkHandler();
    await Promise.resolve();
    expect(addListener).toHaveBeenCalledTimes(1);
  });

  it('malformed URL → no throw, no pushState, no hash change', async () => {
    const { handler } = await loadFreshAndCapture();
    expect(() => handler({ url: 'not-a-url' })).not.toThrow();
    expect(spies.pushState).not.toHaveBeenCalled();
    expect(spies.hashSetter).not.toHaveBeenCalled();
  });
});
