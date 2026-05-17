/**
 * Phase 24 Plan 24-03 — ADMIN_MODULES manifest (D-01, D-05).
 *
 * Single source of truth for all 12 v1.3 admin modules.
 * AdminShell maps over this to render nav links + lazy routes.
 *
 * Rules:
 * - Each entry: { key, label, route, icon, lazy, flagKey, minRole }
 * - `route` matches /admin/<route> (pathname-based, no react-router)
 * - `lazy` must return { default: ComponentType }
 * - `flagKey` is resolved via posthog.isFeatureEnabled(flagKey)
 * - `minRole` is enforced by hasMinRole(adminRole, minRole)
 *
 * 7 placeholder modules ship with PlaceholderModule + shipsIn hint.
 * 5 real modules: Users (AdminMembersPage), Membership (AdminCohortsPage),
 *   Analytics (AdminMetricsPage), Settings (SettingsModule), Audit Log (AuditLogModule).
 *
 * Note: Billing reuses AdminAffiliatesPage as its v1.3 foundation (affiliate payouts
 * are the billing surface in scope; full billing dashboard arrives in a later phase).
 */
import {
  Users as UsersIcon,
  FileText as FileTextIcon,
  Rocket as RocketIcon,
  Gamepad2 as GamepadIcon,
  Star as StarIcon,
  Crown as CrownIcon,
  BarChart3 as BarChart3Icon,
  Sparkles as SparklesIcon,
  LifeBuoy as LifeBuoyIcon,
  CreditCard as CreditCardIcon,
  Settings as SettingsIcon,
  Shield as ShieldIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { AdminRole } from './roles';

export interface AdminModule {
  readonly key: string;
  readonly label: string;
  /** Matches the path segment after /admin/ — e.g. "users" → /admin/users */
  readonly route: string;
  readonly icon: ComponentType<{ size?: number; className?: string }>;
  /** Dynamic import returning { default: ComponentType } */
  readonly lazy: () => Promise<{ default: ComponentType }>;
  /** PostHog feature flag key */
  readonly flagKey: string;
  /** Minimum admin_role required to see this module */
  readonly minRole: AdminRole;
}

/**
 * Helper: returns a lazy factory that imports PlaceholderModule and pre-bakes
 * the `shipsIn` prop so each placeholder has a useful hint without needing
 * per-module component files.
 *
 * NOTE: This wraps the default export in a new function component, which means
 * the lazy chunk is PlaceholderModule (shared) — not one chunk per module.
 * The wrapper captures `shipsIn` in a closure; no JSX needed in this .ts file
 * because we return a plain function that PlaceholderModule renders.
 */
function placeholderFor(shipsIn: string): () => Promise<{ default: ComponentType }> {
  return async () => {
    const { default: PlaceholderModule } = await import(
      '@/components/admin/PlaceholderModule'
    );
    // Return a new component that passes the pre-baked shipsIn prop.
    // The wrapper is a plain function, not JSX — avoids needing this to be .tsx.
    const Wrapper: ComponentType = () =>
      PlaceholderModule({ shipsIn }) as ReturnType<typeof PlaceholderModule>;
    Wrapper.displayName = `PlaceholderModule(${shipsIn})`;
    return { default: Wrapper };
  };
}

export const ADMIN_MODULES = [
  {
    key: 'users',
    label: 'Users',
    route: 'users',
    icon: UsersIcon,
    lazy: () =>
      import('@/components/admin/pages/AdminMembersPage').then((m) => ({
        default: m.AdminMembersPage,
      })),
    flagKey: 'admin.users.enabled',
    minRole: 'staff' as AdminRole,
  },
  {
    key: 'content',
    label: 'Content',
    route: 'content',
    icon: FileTextIcon,
    lazy: placeholderFor('Phase 26 (Content moderation + page builder admin)'),
    flagKey: 'admin.content.enabled',
    minRole: 'admin' as AdminRole,
  },
  {
    key: 'onboarding',
    label: 'Onboarding',
    route: 'onboarding',
    icon: RocketIcon,
    lazy: placeholderFor('Phase 28+ (Onboarding analytics + experiments)'),
    flagKey: 'admin.onboarding.enabled',
    minRole: 'admin' as AdminRole,
  },
  {
    key: 'gamification',
    label: 'Gamification',
    route: 'gamification',
    icon: GamepadIcon,
    lazy: placeholderFor('Phase 30+ (Streaks, XP, badges admin)'),
    flagKey: 'admin.gamification.enabled',
    minRole: 'admin' as AdminRole,
  },
  {
    key: 'reviews',
    label: 'Reviews',
    route: 'reviews',
    icon: StarIcon,
    lazy: placeholderFor('Phase 32+ (Review-prompt moderation)'),
    flagKey: 'admin.reviews.enabled',
    minRole: 'staff' as AdminRole,
  },
  {
    key: 'membership',
    label: 'Membership',
    route: 'membership',
    icon: CrownIcon,
    lazy: () => import('@/components/admin/pages/AdminCohortsPage'),
    flagKey: 'admin.membership.enabled',
    minRole: 'admin' as AdminRole,
  },
  {
    key: 'analytics',
    label: 'Analytics',
    route: 'analytics',
    icon: BarChart3Icon,
    lazy: () => import('@/components/admin/pages/AdminMetricsPage'),
    flagKey: 'admin.analytics.enabled',
    minRole: 'admin' as AdminRole,
  },
  {
    key: 'ai',
    label: 'AI',
    route: 'ai',
    icon: SparklesIcon,
    lazy: placeholderFor('Phase 34+ (AI coach config + eval suite)'),
    flagKey: 'admin.ai.enabled',
    minRole: 'superadmin' as AdminRole,
  },
  {
    key: 'helpdesk',
    label: 'Helpdesk',
    route: 'helpdesk',
    icon: LifeBuoyIcon,
    lazy: placeholderFor('Phase 36+ (Helpdesk ticket inbox)'),
    flagKey: 'admin.helpdesk.enabled',
    minRole: 'staff' as AdminRole,
  },
  {
    key: 'billing',
    label: 'Billing',
    route: 'billing',
    icon: CreditCardIcon,
    lazy: () =>
      import('@/components/admin/pages/AdminAffiliatesPage').then((m) => ({
        default: m.AdminAffiliatesPage,
      })),
    flagKey: 'admin.billing.enabled',
    minRole: 'admin' as AdminRole,
  },
  {
    key: 'settings',
    label: 'Settings',
    route: 'settings',
    icon: SettingsIcon,
    lazy: () => import('@/components/admin/SettingsModule'),
    flagKey: 'admin.settings.enabled',
    minRole: 'admin' as AdminRole,
  },
  {
    key: 'audit-log',
    label: 'Audit Log',
    route: 'audit-log',
    icon: ShieldIcon,
    lazy: () => import('@/components/admin/AuditLogModule'),
    flagKey: 'admin.audit_log.enabled',
    minRole: 'superadmin' as AdminRole,
  },
] as const satisfies readonly AdminModule[];

export type AdminModuleKey = (typeof ADMIN_MODULES)[number]['key'];
