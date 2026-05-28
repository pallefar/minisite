/**
 * Phase 40 Plan 40-05 — CancellationModule.
 *
 * Top-level admin module shell for the /admin/cancellation route.
 * Registered in ADMIN_MODULES manifest (src/lib/admin/modules.ts) per
 * memory feedback_admin_module_manifest_vs_router_branch_drift.
 *
 * AdminShell.tsx uses URL-prefix routing:
 *   pathname === `/admin/cancellation` ||
 *   pathname.startsWith(`/admin/cancellation/`)
 * No hardcoded switch branch needed.
 *
 * 2 subsections:
 *   1. Rules — admin creates/updates/archives/reorders save_offer_rules (POLISH-01/04)
 *   2. ROI   — 40-06 placeholder; overwritten by Plan 40-06 on merge
 *
 * Surface gate: admin.cancellation.enabled — minimum 'admin' role.
 * SECDEF RPCs re-check admin_role server-side (Pattern S1 dual-layer).
 */
import { Suspense, lazy, useEffect, useState } from 'react';
import { hasMinRole, type AdminRole } from '@/lib/admin/roles';
import { supabase } from '@/lib/supabase';

const CancellationRulesTab = lazy(() => import('./CancellationRulesTab'));
// CancellationRoiTab is owned by Plan 40-06; stub ships here so 40-05 builds cleanly.
// Plan 40-06 overwrites this file with the real ROI dashboard.
const CancellationRoiTab = lazy(() => import('./CancellationRoiTab'));

type Subsection = 'rules' | 'roi';

const SUBSECTIONS: Array<{ id: Subsection; label: string }> = [
  { id: 'rules', label: 'Rules' },
  { id: 'roi', label: 'ROI' },
];

export default function CancellationModule() {
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [section, setSection] = useState<Subsection>('rules');

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data: authData }) => {
      if (!authData.user || cancelled) {
        setRoleLoading(false);
        return;
      }
      void supabase
        .from('profiles')
        .select('admin_role')
        .eq('id', authData.user.id)
        .single()
        .then(({ data: prof }) => {
          if (!cancelled) {
            setAdminRole(
              ((prof as { admin_role?: string } | null)?.admin_role as AdminRole) ?? null,
            );
            setRoleLoading(false);
          }
        });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (roleLoading) {
    return <div className="p-6 text-sm text-[var(--color-text-secondary)]">Checking access…</div>;
  }

  // Surface gate: admin.cancellation.enabled — minimum 'admin' role
  if (!hasMinRole(adminRole, 'admin')) {
    return (
      <div className="p-6">
        <p className="text-sm text-[var(--color-text-secondary)]">
          You need admin access to manage cancellation save-offer rules.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Cancellation Save-Offer Rules</h2>
      </div>

      {/* Section navigation tabs */}
      <nav aria-label="Cancellation module subsections">
        <ul className="flex gap-1 border-b border-[var(--color-border)]">
          {SUBSECTIONS.map(({ id, label }) => {
            const isActive = section === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => setSection(id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={[
                    'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                    isActive
                      ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                      : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
                  ].join(' ')}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Section content */}
      <Suspense
        fallback={<div className="p-4 text-sm text-[var(--color-text-secondary)]">Loading…</div>}
      >
        {section === 'rules' && <CancellationRulesTab adminRole={adminRole} />}
        {section === 'roi' && <CancellationRoiTab />}
      </Suspense>
    </div>
  );
}
