/**
 * Phase 48 Plan 48-10 — ModerationLayout (admin pathname-based module).
 *
 * Sub-routes (resolveView regex):
 *   /admin/moderation                 → ReportsQueue (default; all sources)
 *   /admin/moderation/auto-flags      → ReportsQueue filtered to system reports
 *   /admin/moderation/banned-words    → BannedWordsEditor
 *   /admin/moderation/bans            → UserBansRoster
 *   /admin/moderation/bans/:userId    → ApplyModerationForm
 *   /admin/moderation/audit-log       → AuditLogViewer
 *
 * Registers via ADMIN_MODULES (src/lib/admin/modules.ts entry key='moderation').
 * AdminShell.tsx prefix-routes /admin/moderation/* here automatically.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';

const ReportsQueue = lazy(() =>
  import('./ReportsQueue').then((m) => ({ default: m.ReportsQueue })),
);
const BannedWordsEditor = lazy(() =>
  import('./BannedWordsEditor').then((m) => ({ default: m.BannedWordsEditor })),
);
const UserBansRoster = lazy(() =>
  import('./UserBansRoster').then((m) => ({ default: m.UserBansRoster })),
);
const ApplyModerationForm = lazy(() =>
  import('./ApplyModerationForm').then((m) => ({ default: m.ApplyModerationForm })),
);
const AuditLogViewer = lazy(() =>
  import('./AuditLogViewer').then((m) => ({ default: m.AuditLogViewer })),
);

type View =
  | { kind: 'reports' }
  | { kind: 'auto-flags' }
  | { kind: 'banned-words' }
  | { kind: 'bans' }
  | { kind: 'apply'; userId: string }
  | { kind: 'audit' };

export function resolveView(pathname: string): View {
  const m = pathname.match(/^\/admin\/moderation\/?([^/]+)?\/?([^/]+)?/);
  const sub = m?.[1] ?? '';
  const seg2 = m?.[2];
  switch (sub) {
    case '':
      return { kind: 'reports' };
    case 'auto-flags':
      return { kind: 'auto-flags' };
    case 'banned-words':
      return { kind: 'banned-words' };
    case 'bans':
      return seg2 ? { kind: 'apply', userId: seg2 } : { kind: 'bans' };
    case 'audit-log':
      return { kind: 'audit' };
    default:
      return { kind: 'reports' };
  }
}

const NAV_LINKS: ReadonlyArray<{ href: string; label: string; matchKind: View['kind'] }> = [
  { href: '/admin/moderation', label: 'Reports', matchKind: 'reports' },
  { href: '/admin/moderation/auto-flags', label: 'Auto-flags', matchKind: 'auto-flags' },
  { href: '/admin/moderation/banned-words', label: 'Banned words', matchKind: 'banned-words' },
  { href: '/admin/moderation/bans', label: 'User bans', matchKind: 'bans' },
  { href: '/admin/moderation/audit-log', label: 'Audit log', matchKind: 'audit' },
];

export default function ModerationLayout() {
  const [pathname, setPathname] = useState<string>(window.location.pathname);

  useEffect(() => {
    const onPop = (): void => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const view = useMemo(() => resolveView(pathname), [pathname]);

  const navigate = (path: string): void => {
    window.history.pushState({}, '', path);
    setPathname(path);
  };

  return (
    <div className="moderation-admin-module space-y-6">
      <nav
        aria-label="Moderation sub-navigation"
        className="flex flex-wrap gap-2 border-b border-[var(--color-border)] pb-2"
      >
        {NAV_LINKS.map((link) => {
          const active =
            link.matchKind === 'bans'
              ? view.kind === 'bans' || view.kind === 'apply'
              : view.kind === link.matchKind;
          return (
            <button
              key={link.href}
              type="button"
              onClick={() => navigate(link.href)}
              aria-current={active ? 'page' : undefined}
              className={
                'rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ' +
                (active
                  ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                  : 'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]')
              }
            >
              {link.label}
            </button>
          );
        })}
      </nav>

      <Suspense fallback={<Skeleton className="h-32 w-full" />}>
        {view.kind === 'reports' && <ReportsQueue mode="all" />}
        {view.kind === 'auto-flags' && <ReportsQueue mode="auto-flags" />}
        {view.kind === 'banned-words' && <BannedWordsEditor />}
        {view.kind === 'bans' && (
          <UserBansRoster onSelectUser={(uid) => navigate(`/admin/moderation/bans/${uid}`)} />
        )}
        {view.kind === 'apply' && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => navigate('/admin/moderation/bans')}
              className="text-sm text-[var(--color-primary)] hover:underline focus-visible:outline-none"
            >
              ← Back to user bans
            </button>
            <ApplyModerationForm userId={view.userId} />
          </div>
        )}
        {view.kind === 'audit' && <AuditLogViewer />}
      </Suspense>
    </div>
  );
}
