/**
 * Phase 42 Plan 42-02 (POLISH-09): a11y baseline route manifest.
 *
 * Enumerates every top-level surface the SPA renders for the WCAG 2.2 AA
 * baseline gate. Each entry has:
 *   - `path`: the user-visible URL path (logical key for accessibility-baseline.json)
 *   - `label`: human description used in test names + PR-comment diff output
 *   - `mountComponent()`: async loader returning a ReactElement ready to render
 *     into jsdom.
 *
 * Design notes:
 *   - The SPA has no router (CLAUDE.md "Routing: Intentionally none") — paths
 *     are logical keys, not router targets. Each `mountComponent()` dynamically
 *     imports the matching component and returns it wrapped only in what it
 *     needs (no full App.tsx shell — that would mount the entire dashboard
 *     graph and break determinism).
 *   - v1.3-NEW routes whose components ship in later plans (42-08 settings
 *     notifications, 42-11 admin/nps/quarterly, helpdesk, community, courses)
 *     get a `placeholderEntry()` mount so the baseline file already has the
 *     slot reserved. When those features ship, the mount swap-in changes the
 *     placeholder to the real component without altering the baseline schema.
 *   - Component mounts that depend on Zustand state seed a minimal user via
 *     `seedTestStore()` inside render-route.tsx.
 *
 * Per D-09: scan v1.1 + v1.2 + v1.3 surfaces (NOT just new). Pre-existing
 * violations grandfather into the baseline; new code can only ADD if it
 * stays within the per-route limit.
 */

import type { ReactElement } from 'react';
import { createElement } from 'react';

export interface RouteEntry {
  /** Logical URL path used as the key in accessibility-baseline.json. */
  path: string;
  /** Human-readable description rendered in test names + PR-comment diff. */
  label: string;
  /** Async loader returning a ready-to-render React element. */
  mountComponent: () => Promise<ReactElement>;
}

/**
 * Placeholder component used by routes whose real component ships in a later
 * v1.3 plan. Renders a minimal accessible Card-equivalent so axe-core finds
 * zero blocking violations on the placeholder — when the real surface lands,
 * any regression vs this clean baseline blocks merge per D-09.
 */
function placeholderEntry(title: string): () => Promise<ReactElement> {
  return async () =>
    createElement(
      'main',
      { 'aria-labelledby': 'placeholder-heading' },
      createElement('h1', { id: 'placeholder-heading' }, title),
      createElement(
        'p',
        {},
        'This v1.3 surface ships in a later plan. Baseline reserved.',
      ),
    );
}

export const routesManifest: RouteEntry[] = [
  // ─── v1.0 / v1.1 marketing + auth surfaces ──────────────────────────────
  {
    path: '/',
    label: 'Marketing landing',
    mountComponent: async () => {
      const m = await import('@/components/marketing/Landing');
      return createElement(m.Landing, { onStart: () => {} });
    },
  },
  {
    path: '/auth',
    label: 'Auth view (sign-in/sign-up)',
    mountComponent: async () => {
      const m = await import('@/components/auth/AuthView');
      return createElement(m.default, {});
    },
  },

  // ─── Legal pages (Phase 7) ──────────────────────────────────────────────
  {
    path: '/legal/privacy',
    label: 'Privacy policy',
    mountComponent: async () => {
      const m = await import('@/components/legal/PrivacyPolicy');
      return createElement(m.PrivacyPolicy);
    },
  },
  {
    path: '/legal/consumer-health',
    label: 'Consumer health data',
    mountComponent: async () => {
      const m = await import('@/components/legal/ConsumerHealthData');
      return createElement(m.ConsumerHealthData);
    },
  },
  {
    path: '/legal/terms',
    label: 'Terms of service',
    mountComponent: async () => {
      const m = await import('@/components/legal/TermsOfService');
      return createElement(m.TermsOfService);
    },
  },
  {
    path: '/legal/disclaimer',
    label: 'Medical disclaimer',
    mountComponent: async () => {
      const m = await import('@/components/legal/MedicalDisclaimer');
      return createElement(m.MedicalDisclaimer);
    },
  },

  // ─── Dashboard tabs (v1.1 core SPA) ─────────────────────────────────────
  {
    path: '/dashboard',
    label: 'Dashboard home tab',
    mountComponent: async () => {
      const m = await import('@/components/dashboard/tabs/HomeTab');
      return createElement(m.HomeTab, { onOpenAI: () => {} });
    },
  },
  {
    path: '/dashboard/medication',
    label: 'Dashboard medication tab',
    mountComponent: async () => {
      const m = await import('@/components/dashboard/tabs/MedicationTab');
      return createElement(m.MedicationTab);
    },
  },
  {
    path: '/dashboard/body',
    label: 'Dashboard body tab',
    mountComponent: async () => {
      const m = await import('@/components/dashboard/tabs/BodyTab');
      return createElement(m.BodyTab);
    },
  },
  {
    path: '/dashboard/nutrition',
    label: 'Dashboard nutrition tab',
    mountComponent: async () => {
      const m = await import('@/components/dashboard/tabs/NutritionTab');
      return createElement(m.NutritionTab);
    },
  },
  {
    path: '/dashboard/mood',
    label: 'Dashboard mood tab',
    mountComponent: async () => {
      const m = await import('@/components/dashboard/tabs/MoodTab');
      return createElement(m.MoodTab);
    },
  },
  {
    path: '/dashboard/symptoms',
    label: 'Dashboard symptoms tab',
    mountComponent: async () => {
      const m = await import('@/components/dashboard/tabs/SymptomsTab');
      return createElement(m.SymptomsTab);
    },
  },
  {
    path: '/dashboard/activity',
    label: 'Dashboard activity tab',
    mountComponent: async () => {
      const m = await import('@/components/dashboard/tabs/ActivityTab');
      return createElement(m.ActivityTab);
    },
  },
  {
    path: '/dashboard/supplements',
    label: 'Dashboard supplements tab',
    mountComponent: async () => {
      const m = await import('@/components/dashboard/tabs/SupplementsTab');
      return createElement(m.SupplementsTab);
    },
  },
  {
    path: '/dashboard/insights',
    label: 'Dashboard insights tab',
    mountComponent: async () => {
      const m = await import('@/components/dashboard/tabs/InsightsTab');
      return createElement(m.InsightsTab, { onOpenReport: () => {} });
    },
  },

  // ─── Settings (Phase 22 + v1.3 NEW notifications subtab) ────────────────
  {
    path: '/dashboard/settings',
    label: 'Settings drawer',
    mountComponent: async () => {
      const m = await import('@/components/dashboard/settings/SettingsPage');
      return createElement(m.SettingsPage, { open: true, onClose: () => {} });
    },
  },
  // v1.3 NEW (42-08) — placeholder baseline reserved.
  {
    path: '/dashboard/settings/notifications',
    label: 'Settings — notifications subtab (v1.3 NEW)',
    mountComponent: placeholderEntry('Notification preferences'),
  },

  // ─── Admin surfaces (Phase 22 + v1.3 NEW NPS quarterly) ─────────────────
  {
    path: '/admin',
    label: 'Admin shell entry',
    mountComponent: async () => {
      const m = await import('@/components/admin/pages/AdminMembersPage');
      return createElement(m.AdminMembersPage);
    },
  },
  {
    path: '/admin/members',
    label: 'Admin — members list',
    mountComponent: async () => {
      const m = await import('@/components/admin/pages/AdminMembersPage');
      return createElement(m.AdminMembersPage);
    },
  },
  {
    path: '/admin/metrics',
    label: 'Admin — metrics dashboard',
    mountComponent: async () => {
      const m = await import('@/components/admin/pages/AdminMetricsPage');
      return createElement(m.AdminMetricsPage);
    },
  },
  {
    path: '/admin/cohorts',
    label: 'Admin — cohorts',
    mountComponent: async () => {
      const m = await import('@/components/admin/pages/AdminCohortsPage');
      return createElement(m.AdminCohortsPage);
    },
  },
  {
    path: '/admin/audit',
    label: 'Admin — audit log (v1.3 NEW placeholder)',
    mountComponent: placeholderEntry('Audit log'),
  },
  // v1.3 NEW (42-11) — quarterly NPS dashboard placeholder.
  {
    path: '/admin/nps/quarterly',
    label: 'Admin — quarterly NPS dashboard (v1.3 NEW)',
    mountComponent: placeholderEntry('Quarterly NPS responses'),
  },

  // ─── Share / clinic surfaces (Phase 8 + Phase 9) ────────────────────────
  {
    path: '/clinic/:slug/dashboard',
    label: 'Clinic operator dashboard',
    mountComponent: async () => {
      const m = await import('@/components/clinic/ClinicWorkspace');
      return createElement(m.ClinicWorkspace);
    },
  },
  {
    path: '/clinic-invite',
    label: 'Clinic invite acceptance',
    mountComponent: async () => {
      const m = await import('@/components/clinic-invite/ClinicInvitePage');
      return createElement(m.ClinicInvitePage);
    },
  },

  // ─── v1.3 placeholders for helpdesk / community / courses (M6/M7/M8) ────
  // Components will ship in later v1.3 plans; baseline reserved per D-09.
  {
    path: '/helpdesk',
    label: 'Helpdesk (v1.3 NEW placeholder)',
    mountComponent: placeholderEntry('Helpdesk inbox'),
  },
  {
    path: '/community/feed',
    label: 'Community feed (v1.3 NEW placeholder)',
    mountComponent: placeholderEntry('Community feed'),
  },
  {
    path: '/courses/:slug',
    label: 'Course player (v1.3 NEW placeholder)',
    mountComponent: placeholderEntry('Course player'),
  },

  // ─── Onboarding ────────────────────────────────────────────────────────
  {
    path: '/onboarding',
    label: 'Onboarding flow',
    mountComponent: async () => {
      const m = await import('@/components/onboarding/OnboardingFlow');
      return createElement(m.OnboardingFlow, {
        onComplete: () => {},
        onCancel: () => {},
      });
    },
  },

  // ─── Status / cancel-deletion (Phase 22) ────────────────────────────────
  {
    path: '/cancel-deletion',
    label: 'Cancel-deletion landing',
    mountComponent: async () => {
      const m = await import('@/pages/cancel-deletion');
      return createElement(m.CancelDeletionPage);
    },
  },

  // ─── What's New drawer (Phase 42 Plan 42-09 — POLISH-11) ───────────────
  // The drawer mounts inside a role="dialog" Sheet; baseline scans the
  // drawer's body content (one <article> per changelog entry). Stub entries
  // mirror the 3 seed rows from 42-06 so the baseline contains realistic
  // markup. Real drawer module is React.lazy from App.tsx.
  {
    path: '/whats-new',
    label: 'What\'s New drawer',
    mountComponent: async () => {
      const m = await import('@/components/changelog/WhatsNewDrawer');
      const entries = [
        {
          id: 'seed-dark',
          slug: 'v1-3-dark-mode',
          title: 'Dark mode, everywhere',
          body_md: 'Dark mode now covers every surface in the app.',
          published_at: '2026-05-19T00:00:00Z',
        },
        {
          id: 'seed-pwa',
          slug: 'v1-3-pwa-offline',
          title: 'View your data offline',
          body_md: 'Read-only **offline** support lands in v1.3.',
          published_at: '2026-05-18T00:00:00Z',
        },
        {
          id: 'seed-notif',
          slug: 'v1-3-smart-notifications',
          title: 'Smart Notifications are here',
          body_md: 'Tune your dose reminders and clinic alerts.',
          published_at: '2026-05-17T00:00:00Z',
        },
      ];
      return createElement(m.WhatsNewDrawer, {
        open: true,
        entries,
        onClose: () => {},
        markRead: () => Promise.resolve(),
      });
    },
  },
];
