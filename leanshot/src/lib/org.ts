/**
 * Phase 28 Plan 28-05 ORG-06 — org-context layer (CONTEXT D-03).
 *
 * Additive sibling to src/lib/clinic.ts (CONTEXT D-01 — clinic.ts UNCHANGED).
 * 6 LOCKED exports per D-03; ROLE_PERMISSIONS const matrix per D-12.
 *
 * Purpose: Centralize current-org resolution + permission check + path prefix
 * + branding overlay in one consumable module so Plan 06 (RouteOrgGuard) and
 * downstream phase code don't re-derive org context.
 *
 * D-02 resolution precedence (handled externally by RouteOrgGuard + store setters):
 *   1. path /clinic/{slug} parsed by RouteOrgGuard → useStore.setCurrentOrg(...)
 *   2. fallback: org_members.org_id most-recent last_active_at
 *   3. null when user has no org membership
 *
 * Cached in Zustand org slice; invalidated on Auth USER_UPDATED event
 * (wired in main.tsx — Plan 28-05 Task 3).
 *
 * SECURITY NOTE (T-28-05-03): surfaceCheck is a CLIENT HINT only.
 * Every SECDEF RPC re-checks role in DB body (Pattern S1 dual-layer security).
 * Bypassing surfaceCheck on the client just sends a request the server denies.
 */

import type { OrgContext, OrgRole, CurrentOrgContext } from '@/types/org';
import { useStore } from './store';

// Re-export types so consumers only need one import when working with org context.
export type { OrgContext, OrgRole, CurrentOrgContext };

// ---------------------------------------------------------------------------
// ROLE_PERMISSIONS matrix (per CONTEXT D-12 + research §Pattern 2).
// Only 6 permissions are needed at the client layer (UX hints).
// The server-side has_permission() SECDEF function (Phase 9) is the security floor.
// ---------------------------------------------------------------------------

const ROLE_PERMISSIONS: Record<OrgRole, ReadonlySet<string>> = {
  admin: new Set([
    'members.invite',
    'members.revoke',
    'members.list',
    'settings.edit',
    'branding.edit',
    'patients.link',
  ]),
  staff: new Set(['members.list', 'patients.link']),
  viewer: new Set(['members.list']),
};

// ---------------------------------------------------------------------------
// Imperative helpers — usable outside React tree (e.g., from event handlers,
// utility functions, or tests). Read directly from the Zustand singleton.
// ---------------------------------------------------------------------------

/**
 * Returns the current org's id, or null when no org is active.
 * Does NOT throw — use for optional-context code paths.
 */
export function getCurrentOrgIdOrNull(): string | null {
  return useStore.getState().currentOrg?.id ?? null;
}

/**
 * Returns the current org's id.
 * THROWS when no org is active — use inside <RouteOrgGuard> tree only.
 * Error message is the contract tested by Plan 28-05 Task 2 Test 3.
 */
export function getCurrentOrgId(): string {
  const id = getCurrentOrgIdOrNull();
  if (!id) {
    throw new Error('No current org — call from inside <RouteOrgGuard> tree');
  }
  return id;
}

/**
 * Check whether the current user has a given permission in their active org.
 *
 * Returns false when:
 *   - role is null (no active org or not a member)
 *   - permission not in the role's set
 *   - unknown permission key (typo safety via Set.has)
 *
 * This is a CLIENT HINT for UX affordances only (T-28-05-03).
 * The DB-level has_permission() SECDEF function is the actual gate.
 */
export function surfaceCheck(permission: string): boolean {
  const role = useStore.getState().currentOrgRole;
  if (!role) return false;
  return ROLE_PERMISSIONS[role].has(permission);
}

/**
 * Prefix a relative path with the current org's clinic route.
 *
 * withOrgPath('/settings') → '/clinic/acme-clinic/settings'
 * withOrgPath('settings')  → '/clinic/acme-clinic/settings'
 *
 * THROWS when no org is active (must be inside a RouteOrgGuard context).
 */
export function withOrgPath(relativePath: string): string {
  const slug = useStore.getState().currentOrg?.slug;
  if (!slug) {
    throw new Error('withOrgPath: no current org — call from inside <RouteOrgGuard> tree');
  }
  const normalized = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  return `/clinic/${slug}${normalized}`;
}

/**
 * Apply org branding CSS custom properties to document.documentElement.
 *
 * Skeleton overlay (D-16): only primary_color + accent_color handled.
 * Full token map + onboarding-flow theming deferred to P31.
 *
 * Null/undefined values are no-ops — previously-set tokens are preserved
 * (design requirement: callers can call with partial updates without
 * clearing other tokens inadvertently).
 *
 * T-28-05-04 mitigation: values come from org_branding (RLS UPDATE limited
 * to org admins); cross-tenant CSS injection is blocked at the RLS layer.
 */
export function overlayBrandingTokens(branding: {
  primary_color?: string | null;
  accent_color?: string | null;
}): void {
  const root = document.documentElement;
  if (branding.primary_color) {
    root.style.setProperty('--color-primary', branding.primary_color);
  }
  if (branding.accent_color) {
    root.style.setProperty('--color-accent', branding.accent_color);
  }
}

// ---------------------------------------------------------------------------
// React hook — reads from Zustand slice; subscribers re-render on changes.
// ---------------------------------------------------------------------------

/**
 * Hook to access the current org context.
 *
 * Returns { org, role, loading } from the Zustand org slice.
 * Selects primitives individually (CLAUDE.md anti-pattern: never useStore(s=>s)).
 *
 * Stable re-render contract: only re-renders when the selected primitive changes.
 * useCurrentOrg is intended for display components; for guarded actions use
 * surfaceCheck() or getCurrentOrgId() which read from the store imperatively.
 */
export function useCurrentOrg(): CurrentOrgContext {
  // CLAUDE.md anti-pattern: never `useStore(s => s)`. Select primitives.
  const org = useStore((s) => s.currentOrg);
  const role = useStore((s) => s.currentOrgRole);
  const loading = useStore((s) => s.currentOrgLoading);
  return { org, role, loading };
}

// ---------------------------------------------------------------------------
// Test-only export — do NOT consume from application code.
// Provides ROLE_PERMISSIONS access for test assertions without exporting
// the const itself at the module's public surface (it's an implementation detail).
// ---------------------------------------------------------------------------
export const _ROLE_PERMISSIONS_FOR_TEST = ROLE_PERMISSIONS;
