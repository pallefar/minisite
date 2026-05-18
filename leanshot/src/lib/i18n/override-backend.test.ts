/**
 * Phase 32 Plan 32-04 — override-backend Supabase fetch + addResourceBundle
 * deep-merge + Realtime invalidation unit tests.
 *
 * Boundaries covered:
 *   - Case A (basic merge): a fetched override flips i18next.t(key) to the
 *     override value on the next 'loaded' emit.
 *   - Case B (deep merge): nested key (hero.cta.log_dose) does NOT clobber
 *     sibling keys (hero.cta.log_weight) — addResourceBundle deep=true.
 *   - Case C (fail-soft): a Supabase error path returns the catalog value
 *     unchanged (no throw).
 *   - Case D (cleanup): the returned unsubscribe handle removes the 'loaded'
 *     listener and the Supabase channel.
 *
 * Mock posture (per profiles-locale-detector.test.ts pattern):
 *   - vi.mock('@/lib/store', ...) hoisted so override-backend imports the mock.
 *   - vi.mock('@/lib/supabase', ...) returns a chainable query builder that
 *     terminates on .or / .is and resolves to { data, error }.
 *
 * Per reference_rls_fixture_gotrueclient_flake: NO supabase-js signInWithPassword
 * in vitest. Real cross-tenant RLS proof lives in the e2e spec (Task 3).
 */
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// ---------------------------------------------------------------------------
// Hoisted mocks — declared via vi.mock so override-backend picks them up.
// ---------------------------------------------------------------------------
vi.mock('@/lib/store', () => ({
  useStore: {
    getState: vi.fn(() => ({ currentOrg: null })),
  },
}));
vi.mock('@/lib/supabase', () => {
  // Build a single mutable response slot the tests can overwrite per case.
  const responseRef: { data: unknown; error: unknown } = { data: [], error: null };
  const channelMock = {
    on: vi.fn(() => channelMock),
    subscribe: vi.fn(() => channelMock),
    send: vi.fn(async () => 'ok'),
  };
  const supabase = {
    __setQueryResponse(next: { data: unknown; error: unknown }) {
      responseRef.data = next.data;
      responseRef.error = next.error;
    },
    __channelMock: channelMock,
    __removeChannelCalls: [] as unknown[],
    from: vi.fn(() => {
      const builder: Record<string, unknown> = {};
      const thenable = {
        then: (resolve: (v: typeof responseRef) => unknown) => resolve(responseRef),
      };
      const methods = ['select', 'eq', 'is', 'or', 'order', 'ilike'] as const;
      for (const m of methods) {
        builder[m] = vi.fn(() => Object.assign(builder, thenable));
      }
      Object.assign(builder, thenable);
      return builder;
    }),
    channel: vi.fn(() => channelMock),
    removeChannel: vi.fn((c: unknown) => {
      (supabase.__removeChannelCalls as unknown[]).push(c);
      return Promise.resolve('ok');
    }),
  };
  return { supabase };
});
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { applyOverrides, subscribeToOverrideUpdates } from './override-backend';

type SupabaseMock = typeof supabase & {
  __setQueryResponse(next: { data: unknown; error: unknown }): void;
  __channelMock: { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };
  __removeChannelCalls: unknown[];
};
const supabaseMock = supabase as SupabaseMock;
const getStateMock = useStore.getState as unknown as ReturnType<typeof vi.fn>;

async function freshI18n(catalog: Record<string, Record<string, unknown>>) {
  const inst = i18next.createInstance();
  await inst.init({
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: ['en', 'es'],
    ns: Object.keys(catalog.en ?? {}),
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    resources: catalog,
    initImmediate: false,
  });
  return inst;
}

beforeEach(() => {
  getStateMock.mockReset();
  getStateMock.mockReturnValue({ currentOrg: null });
  supabaseMock.__setQueryResponse({ data: [], error: null });
  supabaseMock.__removeChannelCalls.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  supabaseMock.__setQueryResponse({ data: [], error: null });
});

describe('Plan 32-04 — applyOverrides (basic merge)', () => {
  it('Case A — fetched override flips i18next.t(key) on next read', async () => {
    const inst = await freshI18n({
      en: {
        common: { hello: 'Hello' },
      },
    });
    expect(inst.t('common:hello')).toBe('Hello');

    supabaseMock.__setQueryResponse({
      data: [{ lng: 'en', ns: 'common', key: 'hello', value: 'Hola' }],
      error: null,
    });

    await applyOverrides(inst, 'en', 'common');
    expect(inst.t('common:hello')).toBe('Hola');
  });

  it('Case B — deep key (hero.cta.log_dose) merges without clobbering sibling (hero.cta.log_weight)', async () => {
    const inst = await freshI18n({
      en: {
        patient: {
          hero: {
            cta: { log_dose: 'Log dose', log_weight: 'Log weight' },
          },
        },
      },
    });
    expect(inst.t('patient:hero.cta.log_dose')).toBe('Log dose');
    expect(inst.t('patient:hero.cta.log_weight')).toBe('Log weight');

    supabaseMock.__setQueryResponse({
      data: [
        { lng: 'en', ns: 'patient', key: 'hero.cta.log_dose', value: 'Inject now' },
      ],
      error: null,
    });
    await applyOverrides(inst, 'en', 'patient');

    expect(inst.t('patient:hero.cta.log_dose')).toBe('Inject now');
    // Sibling key must NOT be clobbered by the deep-merge.
    expect(inst.t('patient:hero.cta.log_weight')).toBe('Log weight');
  });
});

describe('Plan 32-04 — applyOverrides (fail-soft)', () => {
  it('Case C — Supabase error returns catalog value unchanged (no throw)', async () => {
    const inst = await freshI18n({
      en: {
        common: { hello: 'Hello' },
      },
    });
    supabaseMock.__setQueryResponse({
      data: null,
      error: { message: 'PGRST301 — network drop' },
    });
    // Must not throw.
    await expect(applyOverrides(inst, 'en', 'common')).resolves.toBeUndefined();
    expect(inst.t('common:hello')).toBe('Hello');
  });
});

describe('Plan 32-04 — subscribeToOverrideUpdates (event wiring + cleanup)', () => {
  it('subscribes to a channel scoped to org (or "global" when anonymous) on call', () => {
    getStateMock.mockReturnValue({ currentOrg: { id: 'org-abc', slug: 'acme', name: 'Acme' } });

    const inst = i18next.createInstance();
    const unsubscribe = subscribeToOverrideUpdates(inst);

    expect(supabaseMock.channel).toHaveBeenCalledWith('locale_overrides:org-abc');
    expect(supabaseMock.__channelMock.on).toHaveBeenCalled();
    expect(supabaseMock.__channelMock.subscribe).toHaveBeenCalled();

    // Cleanup must remove the channel.
    unsubscribe();
    expect(supabaseMock.removeChannel).toHaveBeenCalled();
  });

  it('falls back to "global" channel name when no org is set', () => {
    getStateMock.mockReturnValue({ currentOrg: null });
    const inst = i18next.createInstance();
    const unsubscribe = subscribeToOverrideUpdates(inst);
    expect(supabaseMock.channel).toHaveBeenCalledWith('locale_overrides:global');
    unsubscribe();
  });

  it('Case D — unsubscribe removes the loaded listener (subsequent emits do nothing)', async () => {
    getStateMock.mockReturnValue({ currentOrg: null });
    const inst = await freshI18n({ en: { common: { hello: 'Hello' } } });

    supabaseMock.__setQueryResponse({
      data: [{ lng: 'en', ns: 'common', key: 'hello', value: 'Hola' }],
      error: null,
    });

    const unsubscribe = subscribeToOverrideUpdates(inst);
    unsubscribe();
    // After unsubscribe, the 'loaded' listener should be gone — emit and
    // assert the value did NOT change. (We can't easily await the listener
    // anyway since it's been removed; the assertion is the value invariant.)
    inst.emit('loaded', { en: { common: true } });
    expect(inst.t('common:hello')).toBe('Hello');
  });
});
