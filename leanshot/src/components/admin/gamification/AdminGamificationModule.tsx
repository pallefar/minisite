/**
 * Phase 35 Plan 35-05 — AdminGamificationModule.
 *
 * Top-level admin module shell for the /admin/gamification route.
 * Registered in ADMIN_MODULES manifest (src/lib/admin/modules.ts) per
 * memory feedback_admin_module_manifest_vs_router_branch_drift.
 *
 * 3 subsections:
 *   1. Challenges — create/list weekly challenges + A/B variants (GAME-05/08)
 *   2. Freeze Tokens — D-10 admin grant path (ethical support cases only)
 *   3. Leaderboards — D-11 cohort enable/disable (admin-curated subset)
 *
 * Surface gate: admin.gamification.read — minimum 'admin' role (support_admin).
 */
import { Suspense, lazy, useEffect, useState } from 'react';
import { hasMinRole, type AdminRole } from '@/lib/admin/roles';
import { supabase } from '@/lib/supabase';

const ChallengeList = lazy(() => import('./ChallengeList'));
const ChallengeForm = lazy(() => import('./ChallengeForm'));
const FreezeTokenGrant = lazy(() => import('./FreezeTokenGrant'));
const LeaderboardEnable = lazy(() => import('./LeaderboardEnable'));

type Subsection = 'challenges' | 'freeze-tokens' | 'leaderboards';

const SUBSECTIONS: Array<{ id: Subsection; label: string }> = [
  { id: 'challenges', label: 'Challenges' },
  { id: 'freeze-tokens', label: 'Freeze Tokens' },
  { id: 'leaderboards', label: 'Leaderboards' },
];

export default function AdminGamificationModule() {
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [section, setSection] = useState<Subsection>('challenges');
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data: authData }) => {
      if (!authData.user || cancelled) { setRoleLoading(false); return; }
      void supabase
        .from('profiles')
        .select('admin_role')
        .eq('id', authData.user.id)
        .single()
        .then(({ data: prof }) => {
          if (!cancelled) {
            setAdminRole(((prof as { admin_role?: string } | null)?.admin_role as AdminRole) ?? null);
            setRoleLoading(false);
          }
        });
    });
    return () => { cancelled = true; };
  }, []);

  if (roleLoading) {
    return (
      <div className="p-6 text-sm text-[var(--color-text-secondary)]">Checking access…</div>
    );
  }

  // Surface gate: admin.gamification.read — minimum 'admin' role
  if (!hasMinRole(adminRole, 'admin')) {
    return (
      <div className="p-6">
        <p className="text-sm text-[var(--color-text-secondary)]">
          You need admin access to manage gamification.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Gamification</h2>
        {section === 'challenges' && hasMinRole(adminRole, 'admin') && (
          <button
            type="button"
            onClick={() => setShowForm((v: boolean) => !v)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:opacity-90 transition-opacity"
          >
            {showForm ? 'Cancel' : '+ New challenge'}
          </button>
        )}
      </div>

      {/* Section navigation tabs */}
      <nav aria-label="Gamification subsections">
        <ul className="flex gap-1 border-b border-[var(--color-border)]">
          {SUBSECTIONS.map(({ id, label }) => {
            // Leaderboard enable/disable is superadmin only (higher ethical responsibility)
            if (id === 'leaderboards' && !hasMinRole(adminRole, 'superadmin')) return null;
            const isActive = section === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => {
                    setSection(id);
                    setShowForm(false);
                  }}
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
      <Suspense fallback={<div className="p-4 text-sm text-[var(--color-text-secondary)]">Loading…</div>}>
        {section === 'challenges' && (
          <div className="space-y-4">
            {showForm && (
              <ChallengeForm onSaved={() => setShowForm(false)} />
            )}
            <ChallengeList />
          </div>
        )}
        {section === 'freeze-tokens' && hasMinRole(adminRole, 'admin') && (
          <FreezeTokenGrant />
        )}
        {section === 'leaderboards' && hasMinRole(adminRole, 'superadmin') && (
          <LeaderboardEnable />
        )}
      </Suspense>
    </div>
  );
}
