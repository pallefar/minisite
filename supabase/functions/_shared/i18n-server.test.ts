/**
 * Tests for `_shared/i18n-server.ts` — Phase 32 plan 32-05 (I18N-04).
 *
 * Per reference_deno_test_discovery.md: filename must be `.test.ts` not `-test.ts`
 * (Deno directory-walk matches `{*_,*.,}test.*` only).
 *
 * Coverage matrix:
 *   T1 EN happy path                        — renderInLocale('en','welcome.subject', {name:'Ada'})
 *   T2 ES happy path                        — renderInLocale('es','welcome.subject', {name:'Ada'})
 *   T3 null lng → falls back to 'en'        — D-08 fallback contract
 *   T4 unsupported lng 'fr' → 'en'          — safelng coercion
 *   T5 missing key → returns the key        — i18next default fallback (proves path)
 *   T6 module-cache idempotence             — i18next.isInitialized=true BEFORE first call;
 *                                             100 tight-loop calls do not re-init
 *   T7 EN+ES key-parity sanity              — both catalogs share the same key set
 *   T8 getFixedT bound function returns ES  — confirms the second exported helper
 */
import { assert, assertEquals, assertNotEquals, assertStringIncludes } from 'jsr:@std/assert@^1';
import { __internal, getFixedT, renderInLocale } from './i18n-server.ts';
import en from './locales/en/emails.json' with { type: 'json' };
import es from './locales/es/emails.json' with { type: 'json' };

Deno.test('T1 EN: renderInLocale returns localized welcome subject with interpolated name', async () => {
  const out = await renderInLocale('en', 'welcome.subject', { name: 'Ada' });
  assertStringIncludes(out, 'Welcome');
  assertStringIncludes(out, 'Ada');
});

Deno.test('T2 ES: renderInLocale returns Spanish welcome subject with interpolated name', async () => {
  const out = await renderInLocale('es', 'welcome.subject', { name: 'Ada' });
  // Spanish copy says "Bienvenido a LeanShot, Ada" — must NOT start with "Welcome"
  assert(!out.startsWith('Welcome'), `expected Spanish output, got: ${out}`);
  assertStringIncludes(out, 'Bienvenido');
  assertStringIncludes(out, 'Ada');
});

Deno.test('T3 null lng → falls back to EN', async () => {
  const out = await renderInLocale(null, 'welcome.subject', { name: 'Ada' });
  assertStringIncludes(out, 'Welcome');
  assertStringIncludes(out, 'Ada');
});

Deno.test('T4 unsupported lng "fr" → falls back to EN', async () => {
  const out = await renderInLocale('fr', 'welcome.subject', { name: 'Ada' });
  assertStringIncludes(out, 'Welcome');
});

Deno.test('T5 missing key returns the key itself (i18next default fallback)', async () => {
  const out = await renderInLocale('en', 'nope.does_not_exist', { name: 'Ada' });
  assertEquals(out, 'nope.does_not_exist');
});

Deno.test('T6 module-cached: i18next.isInitialized=true before any renderInLocale call; 100x loop OK', async () => {
  // Importing i18n-server.ts at the top of this test module triggered the
  // module-top-level `i18next.init(...)`. By the time this Deno.test fn runs,
  // initialization should already be in flight or complete.
  await __internal.ready;
  assert(__internal.isInitialized(), 'i18next should be initialized after module load');

  // 100 tight-loop calls — none should re-init (init is module-top-level).
  // We assert by checking the flag never flips back to false.
  for (let i = 0; i < 100; i++) {
    const out = await renderInLocale(i % 2 === 0 ? 'en' : 'es', 'welcome.subject', { name: `User${i}` });
    assertStringIncludes(out, `User${i}`);
    assert(__internal.isInitialized(), 'i18next must stay initialized across calls');
  }
});

Deno.test('T7 EN+ES catalog key parity — every EN key has an ES counterpart', () => {
  const enKeys = Object.keys(en).sort();
  const esKeys = Object.keys(es).sort();
  assertEquals(enKeys, esKeys, 'EN and ES email catalogs must have identical key sets');
  // Sanity: must contain at least these 9 required surface keys
  for (const k of [
    'welcome.subject', 'password_reset.subject', 'payment_receipt.subject',
    'dunning.subject', 'clinic_invite.subject', 'clinic_org_invite.subject',
    'clinic_patient_invite.subject', 'dsar_confirmation.subject', 'lifecycle_behavior.subject',
  ]) {
    assert(enKeys.includes(k), `EN catalog missing required key: ${k}`);
  }
});

Deno.test('T8 getFixedT returns a bound function that produces ES strings', async () => {
  await __internal.ready;
  const t = getFixedT('es');
  const out = t('welcome.subject', { name: 'Ada' }) as string;
  assertStringIncludes(out, 'Bienvenido');
  assertNotEquals(out, 'welcome.subject', 'getFixedT must produce a translation, not echo the key');
});
