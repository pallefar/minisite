/**
 * Phase 58 Plan 58-06 — exhaustive `TabId → t()` heading helpers for dashboard
 * tab pages, plus picklist-label helpers for symptom names and mood labels.
 *
 * react-i18next + i18next-parser require STATIC literal keys (PATTERNS Pitfall 3).
 * When a tab renders dynamic arrays (SYMPTOMS_LIST, MOODS) template-string lookups
 * (`t(\`patient:tab.symptoms.symptom_${id}\`)`) emit parser warnings and would fail
 * the failOnWarnings gate.  These exhaustive switch helpers ensure each `t()` call
 * is a static literal resolvable by the AST walker.
 *
 * NOTE: `tabHeading` is intentionally limited to the 9 main dashboard tabs that
 * appear in src/components/dashboard/tabs/*.tsx (home through insights). Nav labels
 * (sidebar long/short) remain in nav-labels.ts which owns the `nav:` namespace.
 */

import type { TFunction } from 'i18next';

/** Maps a tab id to its human-readable page heading in the patient namespace. */
export function tabHeading(t: TFunction, id: string): string {
  switch (id) {
    case 'home':
      return t('patient:tab.home.heading');
    case 'medication':
      return t('patient:tab.medication.heading');
    case 'body':
      return t('patient:tab.body.heading');
    case 'activity':
      return t('patient:tab.activity.heading');
    case 'nutrition':
      return t('patient:tab.nutrition.heading');
    case 'mood':
      return t('patient:tab.mood.heading');
    case 'symptoms':
      return t('patient:tab.symptoms.heading');
    case 'supplements':
      return t('patient:tab.supplements.heading');
    case 'insights':
      return t('patient:tab.insights.heading');
    default:
      return id;
  }
}

/** Maps a symptom id (from SYMPTOMS_LIST) to its translated display name. */
export function symptomLabel(t: TFunction, id: string): string {
  switch (id) {
    case 'nausea':
      return t('patient:tab.symptoms.symptom_nausea');
    case 'fatigue':
      return t('patient:tab.symptoms.symptom_fatigue');
    case 'constipation':
      return t('patient:tab.symptoms.symptom_constipation');
    case 'diarrhea':
      return t('patient:tab.symptoms.symptom_diarrhea');
    case 'sulfur':
      return t('patient:tab.symptoms.symptom_sulfur');
    case 'reflux':
      return t('patient:tab.symptoms.symptom_reflux');
    case 'headache':
      return t('patient:tab.symptoms.symptom_headache');
    case 'injection':
      return t('patient:tab.symptoms.symptom_injection');
    case 'dizziness':
      return t('patient:tab.symptoms.symptom_dizziness');
    case 'mood':
      return t('patient:tab.symptoms.symptom_mood');
    case 'hairloss':
      return t('patient:tab.symptoms.symptom_hairloss');
    case 'cravings':
      return t('patient:tab.symptoms.symptom_cravings');
    default:
      return id;
  }
}

/** Maps a numeric mood value (1–5) to its translated label. */
export function moodLabel(t: TFunction, v: 1 | 2 | 3 | 4 | 5): string {
  switch (v) {
    case 1:
      return t('patient:tab.mood.mood_tough');
    case 2:
      return t('patient:tab.mood.mood_low');
    case 3:
      return t('patient:tab.mood.mood_even');
    case 4:
      return t('patient:tab.mood.mood_good');
    case 5:
      return t('patient:tab.mood.mood_great');
    default: {
      const _exhaustive: never = v;
      return _exhaustive;
    }
  }
}
