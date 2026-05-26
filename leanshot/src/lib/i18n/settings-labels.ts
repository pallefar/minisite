/**
 * Phase 58 Plan 58-04 — exhaustive `Section → t()` helper for SettingsPage NAV.
 *
 * Mirrors the pattern from nav-labels.ts (Phase 32 Plan 32-02). The NAV array
 * in SettingsPage.tsx iterates over typed Section values; using a template
 * literal (`t(\`settings:nav.${id}\`)`) would produce zero extracted keys for
 * i18next-parser. This exhaustive switch gives the parser a static literal per
 * case AND gives TypeScript a compile-time guard if Section ever gains a new value.
 */

import type { TFunction } from 'i18next';

export type Section =
  | 'account'
  | 'profile'
  | 'goals'
  | 'language'
  | 'notifications'
  | 'leaderboards'
  | 'privacy'
  | 'email-preferences'
  | 'privacy-dsar'
  | 'shares'
  | 'organizations'
  | 'recovery'
  | 'subscription'
  | 'data'
  | 'phi-access-log'
  | 'security'
  | 'healthkit'
  // Phase 60 Plan 60-12: research newsletter opt-in
  | 'newsletter'
  | 'dev';

export function sectionLabel(t: TFunction, id: Section): string {
  switch (id) {
    case 'account':
      return t('settings:nav.account');
    case 'profile':
      return t('settings:nav.profile');
    case 'goals':
      return t('settings:nav.goals');
    case 'language':
      return t('settings:nav.language');
    case 'notifications':
      return t('settings:nav.notifications');
    case 'leaderboards':
      return t('settings:nav.leaderboards');
    case 'privacy':
      return t('settings:nav.privacy');
    case 'email-preferences':
      return t('settings:nav.email_preferences');
    case 'privacy-dsar':
      return t('settings:nav.privacy_dsar');
    case 'shares':
      return t('settings:nav.shares');
    case 'organizations':
      return t('settings:nav.organizations');
    case 'recovery':
      return t('settings:nav.recovery');
    case 'subscription':
      return t('settings:nav.subscription');
    case 'data':
      return t('settings:nav.data');
    case 'phi-access-log':
      return t('settings:nav.phi_access_log');
    case 'security':
      return t('settings:nav.security');
    case 'healthkit':
      return t('settings:nav.healthkit');
    // Phase 60 Plan 60-12: research newsletter opt-in section
    case 'newsletter':
      return t('settings:nav.newsletter');
    case 'dev':
      return t('settings:nav.dev');
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}
