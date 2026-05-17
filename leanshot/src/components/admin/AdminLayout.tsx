/**
 * Phase 22 Plan 22-06 → Phase 24 Plan 24-03 — AdminLayout shell.
 *
 * Phase 24 refactor (Plan 24-03):
 *   - Removed hard-coded nav array; manifest-driven nav via AdminShell.
 *   - Added `admin_role` fetch alongside `is_staff` for module-level role gating.
 *   - Two rendering modes:
 *     A) No `children` prop → renders AdminShell (manifest-driven routing).
 *        App.tsx will migrate to this mode progressively as v1.3 phases ship.
 *     B) `children` prop provided → legacy mode for existing v1.2 pages that
 *        wrap AdminLayout directly (AdminMembersPage, AdminMetricsPage, etc.).
 *        These pages continue to work until migrated to be pure content
 *        components rendered BY AdminShell.
 *
 * UX layer ONLY — the security boundary is each admin RPC's is_staff() /
 * is_admin_at_least() gate (Pattern S1 dual-layer, 22-PATTERNS Wave E,
 * extended by Plan 24-01). This component:
 *   1. Resolves profiles.is_staff for the current user.
 *   2. Resolves profiles.admin_role for module-level role gating (Phase 24 D-04).
 *   3. Renders nothing while the probe resolves (no flash of forbidden message).
 *   4. Renders <NotAuthorizedCard /> for non-staff.
 *   5a. [Mode A] Renders AdminShell (nav + module content) for staff.
 *   5b. [Mode B] Renders the surrounding chrome + children for legacy pages.
 */
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AdminShell, { NotAuthorizedCard } from '@/components/admin/AdminShell';
import type { AdminRole } from '@/lib/admin/roles';

interface AdminProbeState {
  isStaff: boolean | undefined;
  adminRole: AdminRole | null;
}

/** Legacy props — kept for v1.2 pages that pass `active`, `heading`, `children`. */
export interface AdminLayoutProps {
  /**
   * @deprecated v1.2 compat — which sub-nav link is active.
   * Ignored in Mode A (AdminShell-based routing).
   */
  active?: string;
  /** Page heading rendered at the top of the main area (Mode B only). */
  heading?: string;
  /** Optional right-aligned action cluster in the header (Mode B only). */
  headerAction?: ReactNode;
  /**
   * Content to render inside the layout (Mode B — legacy pages).
   * Omit to use Mode A (AdminShell manages all routing).
   */
  children?: ReactNode;
}

export function AdminLayout({ heading, headerAction, children }: AdminLayoutProps) {
  const [probe, setProbe] = useState<AdminProbeState>({
    isStaff: undefined,
    adminRole: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) {
        if (!cancelled) setProbe({ isStaff: false, adminRole: null });
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_staff, admin_role')
        .eq('id', uid)
        .maybeSingle();
      const p = profile as { is_staff?: boolean; admin_role?: AdminRole | null } | null;
      const staff = p?.is_staff === true;
      const role = p?.admin_role ?? null;
      if (!cancelled) setProbe({ isStaff: staff, adminRole: role });
    })().catch(() => {
      if (!cancelled) setProbe({ isStaff: false, adminRole: null });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Still resolving — render nothing to avoid flash of forbidden message.
  if (probe.isStaff === undefined) {
    return null;
  }

  // Not staff at all — Pattern S1 first gate.
  if (!probe.isStaff) {
    return <NotAuthorizedCard />;
  }

  // Staff confirmed.
  if (children) {
    // Mode B: legacy wrapper — render surrounding chrome + children.
    // Used by v1.2 pages (AdminMembersPage, AdminMetricsPage, etc.) that
    // pass their own content as children.
    return (
      <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
        <AdminShell adminRole={probe.adminRole} navOnly />
        <main className="p-4 md:p-6">
          {heading && (
            <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <h1 className="text-xl font-semibold tracking-tight">{heading}</h1>
              {headerAction && <div className="shrink-0">{headerAction}</div>}
            </header>
          )}
          {children}
        </main>
      </div>
    );
  }

  // Mode A: AdminShell manages routing.
  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <AdminShell adminRole={probe.adminRole} />
    </div>
  );
}

export default AdminLayout;
