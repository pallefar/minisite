/**
 * Vitest exercise of the dual-runtime refusal module.
 *
 * Mirrored by `supabase/functions/tests/ai-chat-refusal-test.ts` under Deno
 * (single source of truth via this file's ADVERSARIAL_CORPUS export). Phase 4
 * SC#3 + T-04-01 + T-04-03 evidence — see `04-03-PLAN.md` Task 1 behavior
 * specs (Tests 1-7).
 */
import { describe, expect, it } from 'vitest';
import { ADVERSARIAL_CORPUS, isDoseChangeAdvice, scrubInsights, STEM_PATTERN, type CorpusRow } from './refusal';

describe('ADVERSARIAL_CORPUS shape', () => {
  it('contains at least 50 rows (SC#3 floor)', () => {
    expect(ADVERSARIAL_CORPUS.length).toBeGreaterThanOrEqual(50);
  });

  it('covers all 5 categories', () => {
    const categories = new Set(ADVERSARIAL_CORPUS.map((r) => r.category));
    expect(categories).toEqual(
      new Set([
        'dose-change',
        'prompt-injection',
        'system-extraction',
        'emotional-manipulation',
        'benign-pass',
      ]),
    );
  });

  it('has ≥ 2 system-extraction rows containing literal fence tokens (T-04-03)', () => {
    const fenceLeakRows = ADVERSARIAL_CORPUS.filter(
      (r) => r.category === 'system-extraction' && (/<user_data>|<\/user_data>/i.test(r.text)),
    );
    expect(fenceLeakRows.length).toBeGreaterThanOrEqual(2);
    for (const r of fenceLeakRows) {
      expect(r.mustRefuse).toBe(true);
    }
  });
});

describe('isDoseChangeAdvice — adversarial corpus parity', () => {
  for (const row of ADVERSARIAL_CORPUS) {
    const label = `${row.category}: "${row.text.slice(0, 70)}"`;
    it(label, () => {
      expect(isDoseChangeAdvice(row.text)).toBe(row.mustRefuse);
    });
  }
});

describe('isDoseChangeAdvice — CR-01: multi-occurrence stem coverage', () => {
  const SECOND_CLAUSE_REFUSE = [
    'Increase your protein and increase your Ozempic dose tomorrow.',
    'Lower your stress and lower your tirzepatide dose this week.',
    'Bump up your fiber and bump your Wegovy dose by 0.25mg.',
    'Ramp up cardio and ramp your Mounjaro dose to maintenance.',
    'Double your water and double your compounded semaglutide dose.',
    'Skip the late-night snack and skip your weekly shot.',
    'Taper your caffeine and taper your retatrutide dose over four weeks.',
  ];
  for (const phrase of SECOND_CLAUSE_REFUSE) {
    it(`refuses second-clause dose-change: "${phrase}"`, () => {
      expect(isDoseChangeAdvice(phrase)).toBe(true);
    });
  }

  it('catches the canonical CR-01 case: "Increase your sleep. Increase your Ozempic dose to 2mg."', () => {
    expect(isDoseChangeAdvice('Increase your sleep. Increase your Ozempic dose to 2mg.')).toBe(true);
  });
});

describe('STEM_PATTERN — CR-02: expanded clinical verbs', () => {
  // The pattern must include the CR-02 verbs that the regression test calls
  // out — discontinue, hold, pause, resume, withhold, add, cut, reduce.
  // For `de-escalat`, the canonical pattern source uses `de[-\s]?escalat`, so
  // we check membership via plain `.includes()` rather than a fragile regex.
  const REQUIRED_FRAGMENTS = [
    'escalat',
    'de[-\\s]?escalat',
    'taper',
    'ramp',
    'withhold',
    'discontinu',
    'bump',
    'cut',
    'reduc',
  ];
  for (const frag of REQUIRED_FRAGMENTS) {
    it(`STEM_PATTERN source contains "${frag}"`, () => {
      expect(STEM_PATTERN.source).toContain(frag);
    });
  }

  const CR02_REFUSE = [
    'Discontinue your Ozempic this week.',
    'Hold your next shot until labs return.',
    'Pause your weekly dose.',
    'Resume your Wegovy injection on Monday.',
    'Withhold your dose pending labs.',
    'Add another mg to your Saturday shot.',
    'Cut your dose to 5mg.',
  ];
  for (const phrase of CR02_REFUSE) {
    it(`refuses clinical dose-change verb: "${phrase}"`, () => {
      expect(isDoseChangeAdvice(phrase)).toBe(true);
    });
  }

  const CR02_PASS = [
    'Hold a plank for 30 seconds at the end of your workout.',
    'Add more vegetables to your evening plate.',
    'Cut sugar from your morning coffee.',
    'Pause before bed to wind down screens.',
    'Resume your strength routine when soreness fades.',
  ];
  for (const phrase of CR02_PASS) {
    it(`passes benign use of clinical verb: "${phrase}"`, () => {
      expect(isDoseChangeAdvice(phrase)).toBe(false);
    });
  }
});

describe('scrubInsights', () => {
  it('filters dose-change rows and keeps benign rows', () => {
    const input = [
      { title: 'Pace check', body: 'You should increase your Ozempic dose.' },
      { title: 'Hydrate', body: 'Drink more water today.' },
    ];
    const out = scrubInsights(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('Hydrate');
  });
});

describe('CorpusRow type export', () => {
  it('is a typescript-only interface (compile-time check)', () => {
    const sample: CorpusRow = { text: 'x', category: 'benign-pass', mustRefuse: false };
    expect(sample.text).toBe('x');
  });
});
