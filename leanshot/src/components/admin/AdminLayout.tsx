/**
 * Phase 22 Plan 22-06 → Phase 24 Plan 24-03 → Phase 24 Plan 24-05 — AdminLayout shell.
 *
 * Phase 24 Plan 24-03 refactor:
 *   - Removed hard-coded nav array; manifest-driven nav via AdminShell.
 *   - Added `admin_role` fetch alongside `is_staff` for module-level role gating.
 *   - Two rendering modes:
 *     A) No `children` prop → renders AdminShell (manifest-driven routing).
 *     B) `children` prop provided → legacy mode for v1.2 pages.
 *
 * Phase 24 Plan 24-05 augment (Pattern S1 dual-layer — D-06, D-09):
 *   This component now checks two additional gates ABOVE the AdminShell render:
 *     Gate 1 (D-06): profiles.has_totp — if false, renders SetupTotpPage.
 *     Gate 2 (D-09): JWT aal claim — if 'aal1', renders StepUpTotpPage.
 *   Both gates are UX-layer only. The real security enforcement is at the DB
 *   layer: every admin SECURITY DEFINER Postgres function independently checks
 *   `is_admin_at_least()` AND `(auth.jwt() ->> 'aal') = 'aal2'`.
 *
 * IMPORTANT — NO middleware.ts:
 *   LeanShot is a Vite SPA with hash routing (no Next.js App Router, no Vercel
 *   Routing Middleware). There is NO middleware.ts in this project. The "middleware"
 *   enforcement is entirely done via (1) this AdminLayout React gate (client UX layer)
 *   and (2) Postgres RPC-level checks (server security layer). Future contributors:
 *   do NOT search for or add a middleware.ts — it would have no effect on this SPA.
 *
 * UX layer ONLY:
 *   1. Resolves profiles.is_staff + admin_role + has_totp for the current user.
 *   2. Resolves JWT aal claim asynchronously.
 *   3. Renders nothing while probing (no flash of forbidden message).
 *   4. Renders <NotAuthorizedCard /> for non-staff.
 *   5. Renders <SetupTotpPage /> if has_totp is false (D-06 hard-cut).
 *   6. Renders <StepUpTotpPage /> if aal='aal1' (D-09 per-session step-up).
 *   7a. [Mode A] Renders AdminShell (nav + module content) for staff + aal2.
 *   7b. [Mode B] Renders the surrounding chrome + children for legacy pages.
 */
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { supabase, assertAal2 } from '@/lib/supabase';
import AdminShell, { NotAuthorizedCard } from '@/components/admin/AdminShell';
import SetupTotpPage from '@/components/admin/SetupTotpPage';
import StepUpTotpPage from '@/components/admin/StepUpTotpPage';
import type { AdminRole } from '@/lib/admin/roles';

/** Possible states for the combined probe (staff + role + has_totp + aal2). */
type ProbeStatus =
  | 'resolving'   // still loading
  | 'not-staff'   // no admin access
  | 'needs-totp-setup'  // has_totp = false → SetupTotpPage
  | 'needs-step-up'     // aal = 'aal1' → StepUpTotpPage
  | 'ready';      // all gates passed → render AdminShell / content

interface AdminProbeState {
  status: ProbeStatus;
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
    status: 'resolving',
    adminRole: null,
  });

  // Shared probe function — runs on mount and after TOTP gates complete.
  const runProbe = useCallback(async (signal: { cancelled: boolean }) => {
    // 1. Resolve staff + role + has_totp
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) {
      if (!signal.cancelled) setProbe({ status: 'not-staff', adminRole: null });
      return;
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_staff, admin_role, has_totp')
      .eq('id', uid)
      .maybeSingle();
    const p = profile as {
      is_staff?: boolean;
      admin_role?: AdminRole | null;
      has_totp?: boolean | null;
    } | null;

    if (signal.cancelled) return;

    const staff = p?.is_staff === true;
    if (!staff) {
      setProbe({ status: 'not-staff', adminRole: null });
      return;
    }

    const role = p?.admin_role ?? null;
    const hasTotp = p?.has_totp === true;

    // Gate 1: has_totp (D-06 hard-cut, no grace window)
    if (!hasTotp) {
      setProbe({ status: 'needs-totp-setup', adminRole: role });
      return;
    }

    // Gate 2: aal2 step-up (D-09 — every admin session)
    const isAal2 = await assertAal2();
    if (signal.cancelled) return;

    if (!isAal2) {
      setProbe({ status: 'needs-step-up', adminRole: role });
      return;
    }

    setProbe({ status: 'ready', adminRole: role });
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    runProbe(signal).catch(() => {
      if (!signal.cancelled) setProbe({ status: 'not-staff', adminRole: null });
    });
    return () => { signal.cancelled = true; };
  }, [runProbe]);

  // ── Gate rendering ──────────────────────────────────────────────────────────

  // Still resolving — render nothing to avoid flash of forbidden message.
  if (probe.status === 'resolving') {
    return null;
  }

  // Not staff at all — Pattern S1 first gate.
  if (probe.status === 'not-staff') {
    return <NotAuthorizedCard />;
  }

  // D-06: TOTP not yet set up — hard-cut redirect.
  if (probe.status === 'needs-totp-setup') {
    return (
      <SetupTotpPage
        onComplete={() => {
          // Re-probe after setup: session now has aal2, has_totp flipped to true.
          setProbe({ status: 'resolving', adminRole: probe.adminRole });
          const signal = { cancelled: false };
          runProbe(signal).catch(() => {
            setProbe({ status: 'not-staff', adminRole: null });
          });
        }}
      />
    );
  }

  // D-09: Per-session aal2 step-up required.
  if (probe.status === 'needs-step-up') {
    return (
      <StepUpTotpPage
        next={typeof window !== 'undefined' ? window.location.pathname : '/admin'}
        onComplete={() => {
          // Re-probe after step-up: session is now aal2.
          setProbe({ status: 'resolving', adminRole: probe.adminRole });
          const signal = { cancelled: false };
          runProbe(signal).catch(() => {
            setProbe({ status: 'not-staff', adminRole: null });
          });
        }}
      />
    );
  }

  // ── All gates passed (status === 'ready') ───────────────────────────────────

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
