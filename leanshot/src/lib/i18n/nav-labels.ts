/**
 * Phase 32 Plan 32-02 — exhaustive `TabId → t()` helpers.
 *
 * react-i18next + i18next-parser require STATIC literal keys (RESEARCH
 * Pitfall 3). The dashboard's `TabId` enum drives 9 nav labels + 9 short
 * labels; both Sidebar and MobileNav iterate over the TABS array, so a
 * template-string lookup (`t(`nav:${id}`)`) would emit "Key is not a
 * string literal" parser warnings and fail the failOnWarnings gate.
 *
 * These helpers use an exhaustive `switch` per Pattern 4 — each case has
 * a literal `t('nav:<key>')` call that the parser's AST walker can
 * statically resolve. The `never` fallback gives a compile-time miss if
 * `TabId` ever gains a new value (forces this file to be updated).
 */

import type { TFunction } from 'i18next';
import type { TabId } from '@/types';

export function tabLongLabel(t: TFunction, id: TabId): string {
  switch (id) {
    case 'home':
      return t('nav:tab_home_short');
    case 'medication':
      return t('nav:medication');
    case 'symptoms':
      return t('nav:symptoms');
    case 'body':
      return t('nav:body');
    case 'nutrition':
      return t('nav:nutrition');
    case 'activity':
      return t('nav:activity');
    case 'supplements':
      return t('nav:supplements');
    case 'mood':
      return t('nav:mood');
    case 'insights':
      return t('nav:insights');
    case 'community':
      return t('nav:community');
    case 'classroom':
      // Phase 46 — Classroom (consumer-side course surface).
      return t('nav:classroom');
    case 'events':
      // Phase 47 Plan 10 — Events (consumer-side calendar / RSVP / Join Meeting surface).
      return t('nav:events');
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export function tabShortLabel(t: TFunction, id: TabId): string {
  switch (id) {
    case 'home':
      return t('nav:tab_short_home');
    case 'medication':
      return t('nav:tab_short_medication');
    case 'symptoms':
      return t('nav:tab_short_symptoms');
    case 'body':
      return t('nav:tab_short_body');
    case 'nutrition':
      return t('nav:tab_short_nutrition');
    case 'activity':
      return t('nav:tab_short_activity');
    case 'supplements':
      return t('nav:tab_short_supplements');
    case 'mood':
      return t('nav:tab_short_mood');
    case 'insights':
      return t('nav:tab_short_insights');
    case 'community':
      return t('nav:tab_short_community');
    case 'classroom':
      // Phase 46 — short label for iOS-bottom-nav style strip.
      return t('nav:tab_short_classroom');
    case 'events':
      // Phase 47 Plan 10 — short label for iOS-bottom-nav style strip.
      return t('nav:tab_short_events');
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}
