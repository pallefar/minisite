/**
 * Phase 7 Plan 07-03 (COMPL-02) — Single-source-of-truth manifest of every
 * persisted data category LeanShot collects.
 *
 * Imported by:
 *   - src/components/legal/ConsumerHealthData.tsx
 *       (renders §1 of the WMHMDA Consumer Health Data Privacy notice)
 *   - e2e/legal-pages.spec.ts
 *       (asserts every entry's `label` appears in the rendered policy)
 *
 * MUTATION RULE (T-07-03-03 mitigation — policy/practice drift):
 *   When a future phase adds a new persisted slice to PersistedState in
 *   src/lib/storage.ts, that slice MUST be added here in the SAME commit.
 *   When a slice is removed from PersistedState, the matching entry MUST
 *   be removed here. The legal-pages e2e spec fails CI on any drift, which
 *   is the integrity gate that keeps the published CHDP truthful over time.
 *
 * NON-CHD entries (`isConsumerHealthData: false`) are included for
 * transparency — listing them does not narrow the WMHMDA scope. The flag
 * lets the CHDP split them into a separate "non-CHD data we hold" list
 * so a regulator can tell at a glance which fields fall under RCW 19.373.
 */

export interface DataCategory {
  /** Stable key — matches the PersistedState field name or a logical grouping. */
  key: string;
  /** Plain-English label rendered verbatim in the CHDP §1 list AND asserted by e2e. */
  label: string;
  /** One- or two-sentence description of what is collected. */
  description: string;
  /** Whether this category meets the "consumer health data" definition in RCW 19.373.020(8). */
  isConsumerHealthData: boolean;
}

export const DATA_CATEGORIES: readonly DataCategory[] = [
  {
    key: 'profile',
    label: 'Profile and goals',
    description:
      'Name, age, sex, height, body composition, medication choice, dose, dose unit, activity level, lifting experience, goal type, goal weight, daily macro and water targets, injection day, and account creation date.',
    isConsumerHealthData: true,
  },
  {
    key: 'injections',
    label: 'Injection logs',
    description:
      'Every recorded GLP-1 or peptide dose: timestamp, dose amount, unit, injection site, and free-text notes.',
    isConsumerHealthData: true,
  },
  {
    key: 'symptoms',
    label: 'Symptoms and side effects',
    description: 'Symptom name, severity (1–5), date, and free-text notes.',
    isConsumerHealthData: true,
  },
  {
    key: 'weights',
    label: 'Body weight and body-fat logs',
    description: 'Date-stamped body weight (kg or lb) and optional body-fat percentage.',
    isConsumerHealthData: true,
  },
  {
    key: 'measurements',
    label: 'Body measurements',
    description: 'Waist, hips, chest, neck, arms, and thighs measurements with date.',
    isConsumerHealthData: true,
  },
  {
    key: 'meals',
    label: 'Meals and nutrition',
    description:
      'Meal name, calories, protein, fiber, hunger score, satisfaction score, and date.',
    isConsumerHealthData: true,
  },
  {
    key: 'water',
    label: 'Water intake',
    description: 'Daily water totals (in your chosen units).',
    isConsumerHealthData: true,
  },
  {
    key: 'foodNoise',
    label: 'Food-noise score',
    description: 'Daily subjective food-noise score — a GLP-1-specific symptom proxy.',
    isConsumerHealthData: true,
  },
  {
    key: 'workouts',
    label: 'Workouts',
    description:
      'Workout type (resistance, cardio, hybrid, walking, yoga), name, duration in minutes, perceived effort (RPE), and notes.',
    isConsumerHealthData: true,
  },
  {
    key: 'steps',
    label: 'Step counts',
    description: 'Daily step totals.',
    isConsumerHealthData: true,
  },
  {
    key: 'supplements',
    label: 'Supplement adherence',
    description: 'Per-day, per-supplement taken/not-taken flags.',
    isConsumerHealthData: true,
  },
  {
    key: 'mood',
    label: 'Mood and energy logs',
    description: 'Mood (1–5), energy score, and notes by date.',
    isConsumerHealthData: true,
  },
  {
    key: 'sleep',
    label: 'Sleep logs',
    description: 'Hours slept, quality, number of wakings, and notes by date.',
    isConsumerHealthData: true,
  },
  {
    key: 'nsvs',
    label: 'Non-scale victories',
    description: 'Free-text wellness wins (for example, "fit into old jeans").',
    isConsumerHealthData: true,
  },
  {
    key: 'photos',
    label: 'Progress photos',
    description:
      'Image bytes stored in cloud Storage plus per-photo metadata (date, optional body weight at time of photo, MIME type, byte size). Pre-cloud captures are also held locally on your device.',
    isConsumerHealthData: true,
  },
  {
    key: 'vials',
    label: 'Medication vial inventory',
    description: 'Vial name, doses per vial, doses used, start date, and expiration date.',
    isConsumerHealthData: true,
  },
  {
    key: 'costs',
    label: 'Out-of-pocket cost log',
    description:
      'Amount, type (vial, copay, compound, telehealth, lab, or other), and free-text notes.',
    isConsumerHealthData: true,
  },
  {
    key: 'aiHistory',
    label: 'AI coach conversation history',
    description:
      'The text of your conversations with the in-app AI coach. May include consumer health data you describe in chat.',
    isConsumerHealthData: true,
  },
  {
    key: 'settings',
    label: 'App settings and acknowledgements',
    description:
      'Theme preference, units (metric/imperial), and a flag recording that you acknowledged the medical disclaimer.',
    isConsumerHealthData: false,
  },
  {
    key: 'authIdentity',
    label: 'Account identity',
    description:
      'Email address and (when used) password hash, held by Supabase Auth on our behalf. We do not store your password ourselves.',
    isConsumerHealthData: false,
  },
  {
    key: 'operational',
    label: 'Operational metadata',
    description:
      'Offline write queue, migration progress flags, device session tokens, rate-limit counters, and the audit log of cloud writes (timestamp, action, hashed before/after row state — no plaintext content). Retained for breach investigation and account recovery.',
    isConsumerHealthData: false,
  },
] as const;
