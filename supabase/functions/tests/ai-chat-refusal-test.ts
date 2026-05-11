/**
 * Deno-runtime exercise of the dual-runtime refusal module.
 *
 * Proves `shared/refusal.ts` resolves under Deno's TS parser + the
 * `shared/refusal` alias in `supabase/functions/import_map.json`. Mirrors
 * the vitest assertions at `shared/refusal.test.ts` so any divergence in
 * regex semantics between V8 + Deno's TS is caught in CI.
 *
 * Run: `deno test --allow-all --import-map=supabase/functions/import_map.json supabase/functions/tests/`.
 */
import { assertEquals } from 'jsr:@std/assert@1';
import { ADVERSARIAL_CORPUS, isDoseChangeAdvice } from 'shared/refusal';

for (const row of ADVERSARIAL_CORPUS) {
  Deno.test(`refusal — ${row.category}: "${row.text.slice(0, 60)}"`, () => {
    assertEquals(isDoseChangeAdvice(row.text), row.mustRefuse);
  });
}

Deno.test('ADVERSARIAL_CORPUS has ≥ 50 rows', () => {
  if (ADVERSARIAL_CORPUS.length < 50) {
    throw new Error(`expected ≥ 50 rows, got ${ADVERSARIAL_CORPUS.length}`);
  }
});

Deno.test('ADVERSARIAL_CORPUS covers all 5 categories', () => {
  const categories = new Set(ADVERSARIAL_CORPUS.map((r) => r.category));
  const expected = new Set([
    'dose-change',
    'prompt-injection',
    'system-extraction',
    'emotional-manipulation',
    'benign-pass',
  ]);
  assertEquals(categories.size, expected.size);
  for (const c of expected) {
    if (!categories.has(c as typeof ADVERSARIAL_CORPUS[number]['category'])) {
      throw new Error(`missing category: ${c}`);
    }
  }
});
