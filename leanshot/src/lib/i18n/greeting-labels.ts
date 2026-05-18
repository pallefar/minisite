/**
 * Phase 32 Plan 32-02 — exhaustive greeting + mood-label `t()` helpers.
 *
 * Same rationale as `nav-labels.ts` — i18next-parser requires literal keys.
 * GreetingStrip builds a key from `greeting()` slot (`morning|afternoon|evening`)
 * and from the mood enum (1..5); both lookups route through this helper.
 */

import type { TFunction } from 'i18next';

export type GreetingSlot = 'morning' | 'afternoon' | 'evening';

export function greetingText(t: TFunction, slot: GreetingSlot): string {
  switch (slot) {
    case 'morning':
      return t('common:greeting.morning');
    case 'afternoon':
      return t('common:greeting.afternoon');
    case 'evening':
      return t('common:greeting.evening');
    default: {
      const _exhaustive: never = slot;
      return _exhaustive;
    }
  }
}

export type MoodLevel = 1 | 2 | 3 | 4 | 5;

export function moodLabel(t: TFunction, level: MoodLevel): string {
  switch (level) {
    case 1:
      return t('common:mood_label.1');
    case 2:
      return t('common:mood_label.2');
    case 3:
      return t('common:mood_label.3');
    case 4:
      return t('common:mood_label.4');
    case 5:
      return t('common:mood_label.5');
    default: {
      const _exhaustive: never = level;
      return _exhaustive;
    }
  }
}
