/**
 * Tests for `_shared/profiles-locale.ts` — Phase 32 plan 32-05 (I18N-04).
 *
 * Per reference_deno_test_discovery.md: filename `.test.ts` not `-test.ts`.
 *
 * Coverage matrix:
 *   T1 cache miss + ES profile        → returns 'es', DB called once
 *   T2 cache hit                      → returns cached value, DB NOT re-called
 *   T3 null userId                    → returns 'en' without DB call
 *   T4 undefined userId               → returns 'en' without DB call
 *   T5 DB error                       → returns 'en' (no cache)
 *   T6 profile.locale=null            → returns 'en' (cached)
 *   T7 profile.locale='fr' (unknown)  → returns 'en' (cached) — coerced
 *   T8 LRU eviction at capacity       → 101st insert evicts entry #1
 */
import { assert, assertEquals } from 'jsr:@std/assert@^1';
import { __internal, resolveLocale } from './profiles-locale.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno';

interface StubState {
  selectCalls: number;
  lastUserId: string | null;
  returnedLocale: string | null | undefined;
  returnError: { message?: string } | null;
  throwOnSingle: boolean;
}

function makeStub(state: StubState): SupabaseClient {
  // Minimal SupabaseClient shape: .from('profiles').select('locale').eq('id', x).single()
  // Each fluent step returns the next chainable object; `single()` is the awaitable.
  const builder = {
    select: () => builder,
    eq: (_col: string, value: string) => {
      state.lastUserId = value;
      return builder;
    },
    single: async () => {
      if (state.throwOnSingle) throw new Error('boom');
      state.selectCalls += 1;
      if (state.returnError) return { data: null, error: state.returnError };
      return { data: { locale: state.returnedLocale }, error: null };
    },
  };
  return {
    from: (_table: string) => builder,
  } as unknown as SupabaseClient;
}

function freshState(overrides: Partial<StubState> = {}): StubState {
  return {
    selectCalls: 0,
    lastUserId: null,
    returnedLocale: null,
    returnError: null,
    throwOnSingle: false,
    ...overrides,
  };
}

Deno.test('T1 cache miss + ES profile → returns es and DB called once', async () => {
  __internal.cacheClear();
  const state = freshState({ returnedLocale: 'es' });
  const stub = makeStub(state);
  const out = await resolveLocale('user-t1-aaaaaaaa', stub);
  assertEquals(out, 'es');
  assertEquals(state.selectCalls, 1);
  assertEquals(state.lastUserId, 'user-t1-aaaaaaaa');
});

Deno.test('T2 cache hit → DB NOT re-called', async () => {
  __internal.cacheClear();
  const state = freshState({ returnedLocale: 'es' });
  const stub = makeStub(state);
  await resolveLocale('user-t2-bbbbbbbb', stub);
  await resolveLocale('user-t2-bbbbbbbb', stub);
  await resolveLocale('user-t2-bbbbbbbb', stub);
  assertEquals(state.selectCalls, 1, 'second + third calls must hit cache');
});

Deno.test('T3 null userId → returns en, no DB call', async () => {
  __internal.cacheClear();
  const state = freshState({ returnedLocale: 'es' });
  const stub = makeStub(state);
  const out = await resolveLocale(null, stub);
  assertEquals(out, 'en');
  assertEquals(state.selectCalls, 0);
});

Deno.test('T4 undefined userId → returns en, no DB call', async () => {
  __internal.cacheClear();
  const state = freshState({ returnedLocale: 'es' });
  const stub = makeStub(state);
  const out = await resolveLocale(undefined, stub);
  assertEquals(out, 'en');
  assertEquals(state.selectCalls, 0);
});

Deno.test('T5 DB error → returns en, NOT cached (next call retries)', async () => {
  __internal.cacheClear();
  const state = freshState({ returnError: { message: 'simulated_db_error' } });
  const stub = makeStub(state);
  const out1 = await resolveLocale('user-t5-cccccccc', stub);
  assertEquals(out1, 'en');
  // Second call should ALSO query DB (no negative caching).
  const out2 = await resolveLocale('user-t5-cccccccc', stub);
  assertEquals(out2, 'en');
  assertEquals(state.selectCalls, 2);
});

Deno.test('T6 profile.locale=null → returns en (cached)', async () => {
  __internal.cacheClear();
  const state = freshState({ returnedLocale: null });
  const stub = makeStub(state);
  const out1 = await resolveLocale('user-t6-dddddddd', stub);
  assertEquals(out1, 'en');
  await resolveLocale('user-t6-dddddddd', stub);
  assertEquals(state.selectCalls, 1, 'en result IS cached');
});

Deno.test('T7 profile.locale=fr (unknown) → coerced to en (cached)', async () => {
  __internal.cacheClear();
  const state = freshState({ returnedLocale: 'fr' });
  const stub = makeStub(state);
  const out = await resolveLocale('user-t7-eeeeeeee', stub);
  assertEquals(out, 'en', 'unknown locale coerces to en');
});

Deno.test('T8 LRU eviction → 101st insert evicts entry #1', async () => {
  __internal.cacheClear();
  const state = freshState({ returnedLocale: 'es' });
  const stub = makeStub(state);

  // Fill cache to capacity (100 distinct user IDs)
  for (let i = 0; i < __internal.CACHE_CAPACITY; i++) {
    await resolveLocale(`user-evict-${i}`, stub);
  }
  assertEquals(__internal.cacheSize(), __internal.CACHE_CAPACITY);
  assertEquals(state.selectCalls, __internal.CACHE_CAPACITY);

  // Insert one more → triggers eviction of oldest (user-evict-0)
  await resolveLocale('user-evict-NEW', stub);
  assertEquals(__internal.cacheSize(), __internal.CACHE_CAPACITY, 'size must stay at cap');

  // Re-resolve user-evict-0 → must re-hit DB (was evicted)
  const callsBefore = state.selectCalls;
  await resolveLocale('user-evict-0', stub);
  assert(
    state.selectCalls === callsBefore + 1,
    `user-evict-0 should have been evicted and re-queried; calls ${callsBefore} -> ${state.selectCalls}`,
  );
});
