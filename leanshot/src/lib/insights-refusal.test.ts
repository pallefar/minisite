import { describe, expect, it } from 'vitest';
import { isDoseChangeAdvice, scrubInsights } from './insights-refusal';

/**
 * Adversarial corpus for the insights refusal-list (PK-02).
 *
 * 25 REFUSE + 25 PASS = 50 inputs, satisfying ROADMAP SC#3 and CONTEXT D-05
 * ("50+ adversarial test corpus"). PASS rows intentionally include
 * false-positive-prone stems (more, less, double, taper, de-escalate) in
 * benign contexts so the ±5-token med-noun context-guard is exercised.
 */

describe('isDoseChangeAdvice — must REFUSE (true positives)', () => {
  const REFUSE_CORPUS = [
    'You should increase your Ozempic dose to 2mg.',
    'Consider lowering your tirzepatide dose if symptoms persist.',
    'Try doubling your weekly injection.',
    'Skip your next dose if you feel nauseous.',
    'Stop your Wegovy until you talk to your doctor.',
    'Start a 0.5mg dose this week.',
    'Taper your semaglutide over 4 weeks.',
    'Ramp up to 10mg of Mounjaro by month two.',
    'Escalate the dose to maintenance now.',
    'De-escalate your Zepbound back to 5mg.',
    'Bump your dose up by 0.25mg.',
    'Take more Saxenda in the evening.',
    'Inject less Trulicity this week.',
    'Halve your dose if side effects worsen.',
    'Raise the mg of your retatrutide injection.',
    "Skip this week's shot to give your body a break.",
    'Double your compound semaglutide dose for faster results.',
    'Lower your retatrutide dose to 8mg if nausea returns.',
    'Increase Rybelsus to 14mg starting tomorrow.',
    'Bump the dulaglutide titration one step earlier.',
    'Stop the GLP-1 injection if your appetite returns.',
    'Halve your weekly mg until labs come back.',
    'Ramp down your compounded tirzepatide to 7.5mg.',
    'Taper the meds across the next four shots.',
    'Start a 0.25mg injection schedule again this week.',
  ];
  it('corpus has 25 entries', () => {
    expect(REFUSE_CORPUS).toHaveLength(25);
  });
  for (const phrase of REFUSE_CORPUS) {
    it(`refuses: "${phrase}"`, () => {
      expect(isDoseChangeAdvice(phrase)).toBe(true);
    });
  }
});

describe('isDoseChangeAdvice — must PASS (false positives)', () => {
  const PASS_CORPUS = [
    'Increase your protein to preserve muscle.',
    'Lower your stress to support sleep quality.',
    'Aim for more reps on your strength sessions.',
    'Try less screen time before bed.',
    'Start a daily walk after lunch.',
    'Stop drinking water 2 hours before sleep.',
    'Skip the late-night snack tonight.',
    'Taper your caffeine intake gradually.',
    'Bump up your fiber from 25g to 35g per day.',
    'Ramp up cardio sessions to three a week.',
    'Escalate your weight goal to a sustainable pace.',
    'Double your water intake on hot days.',
    'Halve your alcohol consumption to support recovery.',
    'Raise your protein target to 130g.',
    "You're crushing protein — keep more lean meat in the rotation.",
    'Add more vegetables to your evening plate.',
    "Lower the intensity of tomorrow's run if your legs feel heavy.",
    'Start a five-minute mobility routine before bed.',
    'Increase your daily step count toward 8,000.',
    'Stop scrolling at least an hour before sleep.',
    "Skip the weigh-in if it's a high-stress morning.",
    'Ramp up your strength training to twice a week.',
    'De-escalate the tone of the conversation, not the protein goal.',
    'Double the fiber from chia and berries, not the meds.',
    'Taper screen brightness in the evening for better sleep.',
  ];
  it('corpus has 25 entries', () => {
    expect(PASS_CORPUS).toHaveLength(25);
  });
  for (const phrase of PASS_CORPUS) {
    it(`passes: "${phrase}"`, () => {
      expect(isDoseChangeAdvice(phrase)).toBe(false);
    });
  }
});

/**
 * CR-01 regression (Phase 3 review): the prior `tokens.findIndex(...)` only
 * inspected the FIRST occurrence of a stem. These rows place a benign
 * occurrence of the dose-change verb BEFORE the dangerous one near a med
 * noun — under the old code, isDoseChangeAdvice returned `false` (leak);
 * under the fix it must return `true`.
 */
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
