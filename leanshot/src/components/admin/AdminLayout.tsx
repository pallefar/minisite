/**
 * Phase 22 Plan 22-06 — AdminLayout shell with is_staff client gate + sub-nav.
 *
 * UX layer ONLY — the security boundary is each admin RPC's is_staff()
 * gate (Pattern S1 dual-layer, 22-PATTERNS Wave E). This component:
 *   1. Resolves profiles.is_staff for the current user (mirrors
 *      AdminAffiliatesScaffold Phase 19 lines 82-108 verbatim).
 *   2. Renders nothing while the probe resolves (no flash of forbidden
 *      message for a staff user with a slow getUser).
 *   3. Renders <NotAuthorizedCard /> for non-staff.
 *   4. Renders the sub-nav + children for staff.
 *
 * App.tsx wiring (React.lazy) is intentionally deferred to plan 22-12 to
 * avoid shared-file choreography per the planner's Pre-emptive warning 4.
 */
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';

export type AdminNavKey = 'members' | 'metrics' | 'cohorts' | 'affiliates';

interface AdminNavLink {
  key: AdminNavKey;
  label: string;
  href: string;
}

const ADMIN_NAV: AdminNavLink[] = [
  { key: 'members', label: 'Members', href: '/admin/members' },
  { key: 'metrics', label: 'Metrics', href: '/admin/metrics' },
  { key: 'cohorts', label: 'Cohorts', href: '/admin/cohorts' },
  { key: 'affiliates', label: 'Affiliates', href: '/admin/affiliates' },
];

export interface AdminLayoutProps {
  /** Which sub-nav link is active (for aria-current and styling). */
  active: AdminNavKey;
  /** Page heading rendered at the top of the main area. */
  heading: string;
  /** Optional right-aligned action cluster in the header. */
  headerAction?: ReactNode;
  children: ReactNode;
}

function NotAuthorizedCard() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6">
      <Card variant="flat" padding="lg" className="max-w-md mx-auto mt-12 text-center">
        <h1 className="text-xl font-semibold mb-2">This area is for admins only</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          You don&apos;t have access to the admin console.
        </p>
        <a
          href="/"
          className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
        >
          Back to home →
        </a>
      </Card>
    </main>
  );
}

function AdminSubNav({ active }: { active: AdminNavKey }) {
  return (
    <nav
      aria-label="Admin sections"
      className="border-b border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      <ul className="flex flex-wrap gap-1 px-4 md:px-6 py-2">
        {ADMIN_NAV.map((link) => {
          const isActive = link.key === active;
          return (
            <li key={link.key}>
              <a
                href={link.href}
                aria-current={isActive ? 'page' : undefined}
                className={
                  isActive
                    ? 'inline-flex items-center h-8 px-3 rounded-pill text-[13px] font-semibold bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                    : 'inline-flex items-center h-8 px-3 rounded-pill text-[13px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-surface-elevated)]'
                }
              >
                {link.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AdminLayout({ active, heading, headerAction, children }: AdminLayoutProps) {
  const [isStaff, setIsStaff] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) {
        if (!cancelled) setIsStaff(false);
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_staff')
        .eq('id', uid)
        .maybeSingle();
      const staff = (profile as { is_staff?: boolean } | null)?.is_staff === true;
      if (!cancelled) setIsStaff(staff);
    })().catch(() => {
      if (!cancelled) setIsStaff(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isStaff === undefined) {
    return null;
  }
  if (!isStaff) {
    return <NotAuthorizedCard />;
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <AdminSubNav active={active} />
      <main className="p-4 md:p-6">
        <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h1 className="text-xl font-semibold tracking-tight">{heading}</h1>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </header>
        {children}
      </main>
    </div>
  );
}

export default AdminLayout;
