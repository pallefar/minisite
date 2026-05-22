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
  Building2 as Building2Icon,
  BookOpenCheck as BookOpenCheckIcon,
  Globe as GlobeIcon,
  TrendingUp as TrendingUpIcon,
  // Phase 42 Plan 42-10 — Quarterly NPS admin module icon.
  Smile as SmileIcon,
  // Phase 40 Plan 40-05 — Cancellation save-offer rule editor icon.
  HeartCrack as HeartCrackIcon,
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
  // Phase 34 Plan 34-08 ONBOARD-07 — Consumer onboarding builder (Builder + A/B
  // + Funnel tabs). Replaces the Phase 24 placeholder per memory
  // [[admin-module-manifest-vs-router-branch-drift]] (verify command asserts
  // placeholderFor no longer references onboarding). minRole stays 'admin' so
  // standard admins can OPEN the page (read existing flows); Save / Ship Winner
  // buttons gate further at the SECDEF/Edge Fn layer (Pattern S1 dual-layer).
  {
    key: 'onboarding',
    label: 'Onboarding',
    route: 'onboarding',
    icon: RocketIcon,
    lazy: () => import('@/components/admin/onboarding-builder/OnboardingBuilderModule'),
    flagKey: 'admin.onboarding.enabled',
    minRole: 'admin' as AdminRole,
  },
  // Phase 35 Plan 35-05 GAME-05/08 — Gamification admin module.
  // Replaces the Phase 24 placeholder per memory feedback_admin_module_manifest_vs_router_branch_drift.
  // AdminShell.tsx already uses manifest-driven routing (no hardcoded switch):
  //   pathname === `/admin/${m.route}` || pathname.startsWith(`/admin/${m.route}/`)
  // So registering here + supplying the real lazy import is sufficient for BOTH
  // manifest AND router branch coverage (no additional switch case needed).
  // minRole 'admin' so standard admins can read + create challenges;
  // SECDEF RPCs re-check profiles.admin_role server-side (Pattern S1 dual-layer).
  {
    key: 'gamification',
    label: 'Gamification',
    route: 'gamification',
    icon: GamepadIcon,
    lazy: () => import('@/components/admin/gamification/AdminGamificationModule'),
    flagKey: 'admin.gamification.enabled',
    minRole: 'admin' as AdminRole,
  },
  // Phase 36 Plan 36-04 (REVIEW-02/06/07/08) — admin reviews module
  // (Rules + Funnel + CTA Catalog sub-pages). Replaces the Phase 24 placeholder
  // per memory [[admin-module-manifest-vs-router-branch-drift]] — AdminShell.tsx
  // already prefix-routes /admin/reviews/* (line 119: pathname.startsWith(...)).
  // minRole upgraded from 'staff' → 'admin' per CONTEXT D-02: rule editing is an
  // admin operation; SECDEF RPCs re-check admin_role server-side (Pattern S1).
  {
    key: 'reviews',
    label: 'Reviews',
    route: 'reviews',
    icon: StarIcon,
    lazy: () => import('@/admin/modules/reviews'),
    flagKey: 'admin.reviews.enabled',
    minRole: 'admin' as AdminRole,
  },
  {
    key: 'membership',
    label: 'Cohorts',
    route: 'membership',
    icon: CrownIcon,
    // Phase 27 Plan 27-02 — replaces the Phase 22 retention heatmap placeholder
    // (AdminCohortsPage) with the cohort builder + list (CohortsPage).
    // Retention heatmap remains importable via AdminCohortsPage if revived later.
    lazy: () => import('@/components/admin/cohort/CohortsPage'),
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
  // Phase 27 Plan 27-05 — funnel-anomaly admin config (tracked funnels CRUD +
  // acknowledgment queue). Superadmin-only per status-writer ownership rule.
  {
    key: 'anomaly',
    label: 'Anomalies',
    route: 'anomaly',
    icon: BarChart3Icon,
    lazy: () =>
      import('@/components/admin/anomaly/AnomalyConfigPage').then((m) => ({
        default: m.default,
      })),
    flagKey: 'admin.anomaly.enabled',
    minRole: 'superadmin' as AdminRole,
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
  // Phase 37 Plan 37-07 — agent-facing helpdesk admin module.
  // Replaces the Phase 24 placeholder per [[admin-module-manifest-vs-router-branch-drift]].
  // AdminShell.tsx already supports prefix-branch matching at /admin/helpdesk/*
  // (line 124: pathname.startsWith(`/admin/${m.route}/`)), so sub-routes
  // /admin/helpdesk/inbox, /sentiment, /kb, etc. resolve correctly into the
  // HelpdeskLayout SUB_ROUTES table. minRole 'staff' so on-duty agents see it;
  // RLS on tickets + org_members re-checks at the data layer (Pattern S1).
  {
    key: 'helpdesk',
    label: 'Helpdesk',
    route: 'helpdesk',
    icon: LifeBuoyIcon,
    lazy: () =>
      import('@/admin/modules/helpdesk').then((m) => ({
        default: m.HelpdeskLayout,
      })),
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
  // Phase 43 Plan 05 (MEMBER-02 D-03) — Grandfathered Pricing admin CRUD.
  // SIBLING entry next to 'billing' (NOT a sub-route edit of the existing
  // entry) per [[feedback_admin_module_manifest_vs_router_branch_drift]].
  // AdminShell.tsx URL-prefix routing resolves /admin/billing/grandfathered-prices
  // here deterministically (longest-prefix match wins via the order-of-iteration
  // — but our router uses exact-or-prefix on each entry independently, so this
  // sibling entry's route 'billing/grandfathered-prices' matches its URL without
  // colliding with the bare 'billing' entry).
  // minRole 'admin' for the UI gate; the SECDEF RPCs re-check admin_role
  // server-side (Pattern S1 dual-layer).
  {
    key: 'billing-grandfathered',
    label: 'Grandfathered Pricing',
    route: 'billing/grandfathered-prices',
    icon: CreditCardIcon,
    lazy: () =>
      import('@/admin/modules/billing/GrandfatheredPricesPage').then((m) => ({
        default: m.GrandfatheredPricesPage,
      })),
    flagKey: 'admin.billing.grandfathered.enabled',
    minRole: 'admin' as AdminRole,
  },
  // Phase 40 Plan 40-05 (POLISH-01/04) — Cancellation save-offer rule editor.
  // Two tabs: Rules (this plan) + ROI (40-06 placeholder, replaced by 40-06 on merge).
  // AdminShell.tsx uses URL-prefix routing: /admin/cancellation resolves here without
  // needing a hardcoded switch branch (per feedback_admin_module_manifest_vs_router_branch_drift).
  // minRole 'admin' for UI gate; SECDEF RPCs re-check admin_role server-side (Pattern S1).
  // Archive requires superadmin — enforced at save_offer_rule_archive RPC, not here.
  {
    key: 'cancellation',
    label: 'Cancellation',
    route: 'cancellation',
    icon: HeartCrackIcon,
    lazy: () =>
      import('@/components/admin/cancellation/CancellationModule').then((m) => ({
        default: m.default,
      })),
    flagKey: 'admin.cancellation.enabled',
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
  // Phase 28 Plan 07 — clinic-orgs preview module (full Members & Invites UI in P31).
  // Preview: org count + member count rollup via browser anon-client (RLS-gated).
  // See .planning/phases/28-clinic-organizations-schema-rls-hardening/28-EXTENSION-CONTRACT.md
  {
    key: 'clinic-orgs',
    label: 'Clinic Orgs',
    route: 'clinic-orgs',
    icon: Building2Icon,
    lazy: () => import('@/components/admin/modules/ClinicOrgsPreview'),
    flagKey: 'admin.clinic_orgs.enabled',
    minRole: 'admin' as AdminRole,
  },
  // Phase 50 Plan 50-02 — Admin-curated RAG knowledge base.
  // Surface: topics CRUD + sources allowlist + telemetry placeholders + cost dash.
  // minRole 'admin' so plain admins can READ; writes are super-admin gated at RPC
  // layer (Pattern S1 dual-layer). flagKey 'admin_rag_kb' per CONTEXT.
  {
    key: 'rag',
    label: 'Knowledge Base',
    route: 'rag',
    icon: BookOpenCheckIcon,
    lazy: () => import('@/components/admin/rag/RagLayout'),
    flagKey: 'admin_rag_kb',
    minRole: 'admin' as AdminRole,
  },
  // Phase 32 Plan 32-04 I18N-08 — admin hot-patch surface for translation
  // bugs. RLS-gated table (locale_overrides) + Realtime broadcast on Publish.
  {
    key: 'i18n-overrides',
    label: 'Locale Overrides',
    route: 'i18n-overrides',
    icon: GlobeIcon,
    lazy: () => import('@/components/admin/i18n/LocaleOverridesModule'),
    flagKey: 'admin.i18n_overrides.enabled',
    minRole: 'admin' as AdminRole,
  },
  // Phase 33 Plan 33-05 ADETL-04/05/07/08 — CAC dashboard: health badges + gap badges
  // + Backfill RPC + CAC cards + drill-down drawer + CSV export.
  // Backfill routes via trigger_ad_etl_backfill SECDEF RPC (T-33-05-02 mitig).
  {
    key: 'growth-cac',
    label: 'Ad Spend / CAC',
    route: 'growth/cac',
    icon: TrendingUpIcon,
    lazy: () =>
      import('@/components/admin/growth/CACDashboardPage').then((m) => ({
        default: m.CACDashboardPage,
      })),
    flagKey: 'admin.growth.cac.enabled',
    minRole: 'admin' as AdminRole,
  },
  // Phase 42 Plan 42-10 (POLISH-12 D-24) — Quarterly NPS admin dashboard.
  // Reads from quarterly_nps_responses via get_quarterly_nps_dashboard SECDEF RPC
  // (is_admin_at_least('admin') gate inside; client minRole='admin' is the
  // Pattern S1 UX layer). Flag key follows the admin.<key>.enabled convention.
  {
    key: 'nps-quarterly',
    label: 'Quarterly NPS',
    route: 'nps/quarterly',
    icon: SmileIcon,
    lazy: () =>
      import('@/components/admin/QuarterlyNPSDashboard').then((m) => ({
        default: m.QuarterlyNPSDashboard,
      })),
    flagKey: 'admin.nps_quarterly.enabled',
    minRole: 'admin' as AdminRole,
  },
  // Phase 38 Plan 38-08 (RECOMMEND-07 D-12/13/14) — HITL admin queue.
  // Single queue for AI suggestion review across {recommender, digest, win_back}.
  // Super-admin only (D-14) — RLS on ai_suggestion_review enforces; minRole here
  // is the Pattern S1 UX layer. Auto-approved KB rows (status='auto_approved_kb')
  // surface as audit-only (D-13). Approve on digest rows triggers a follow-on
  // weekly-digest Edge Fn invocation that releases the held email.
  {
    key: 'hitl-queue',
    label: 'AI Suggestion Review',
    route: 'hitl-queue',
    icon: ShieldIcon,
    lazy: () => import('@/admin/modules/hitl-queue/HitlQueuePage'),
    flagKey: 'admin.hitl_queue.enabled',
    minRole: 'superadmin' as AdminRole,
  },
  // Phase 25 Plan 25-09 HIPAA-12/13 — BAA chain + subprocessor diff compliance module.
  // Superadmin-only: vendor BAA status updates are security-sensitive; superadmin gate
  // at RPC layer (vendor_baa_chain_update SECDEF) + minRole here (Pattern S1 dual-layer).
  {
    key: 'compliance',
    label: 'Compliance',
    route: 'compliance',
    icon: ShieldIcon,
    lazy: () =>
      import('@/components/admin/pages/AdminCompliancePage').then((m) => ({
        default: m.AdminCompliancePage,
      })),
    flagKey: 'admin.compliance.enabled',
    minRole: 'superadmin' as AdminRole,
  },
] as const satisfies readonly AdminModule[];

export type AdminModuleKey = (typeof ADMIN_MODULES)[number]['key'];
