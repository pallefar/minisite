/**
 * Phase 9 Plan 09-08 — WorkspaceSwitcher.
 *
 * The single-identity affordance from D-09 + D-14. Pitfall #8's
 * "one auth.users per email + relationship tables for context" invariant
 * becomes meaningful to the user ONLY when this switcher renders the 3
 * grouped contexts (Personal account + Memberships + Workspaces I run).
 *
 * Lives in the index chunk (NOT lazy-loaded) — it must be visible on every
 * authenticated route. Index-chunk delta ≤ 3 kB gz (W-7 ceiling 24.5 kB gz).
 *
 * Pitfall #9 mitigation: defer-mount until `supabase.auth.getSession()`
 * resolves. While the session promise is pending, a Skeleton renders in
 * the trigger position (no empty-list flash on hard reload).
 *
 * Pitfall #8 invariant: even with 0 memberships AND 0 workspaces, the
 * Personal-account group ALWAYS renders + both empty hints render.
 *
 * Anonymous-route guard: if `getSession()` resolves to null, render nothing.
 * Belt-and-suspenders: AppShell only mounts this component for
 * authenticated views.
 */

import { ChevronDown, Plus } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/Skeleton';
import { subscribeToUserChannel } from '@/lib/clinic-realtime';
import { cn } from '@/lib/helpers';
import { supabase } from '@/lib/supabase';

interface MembershipJoined {
  id: string;
  org_id: string;
  role_id: string;
  organizations: {
    id: string;
    slug: string;
    name: string;
    logo_storage_path: string | null;
    created_by: string;
  } | null;
  roles: { name: string } | null;
}

type Group = 'memberships' | 'workspaces';

interface ContextRow {
  kind: 'personal' | Group;
  id: string;
  label: string;
  subtitle: string;
  /** Pathname to navigate to on click. */
  href: string;
  /** Stable id used by aria-current matching. */
  ctxId: string;
  /** Optional org logo storage path for img rendering. */
  logoPath: string | null;
  /** Initial letter monogram fallback. */
  monogram: string;
}

const PERSONAL_ROW: ContextRow = {
  kind: 'personal',
  id: 'personal',
  label: 'Your LeanShot',
  subtitle: 'Your tracking data',
  href: '/',
  ctxId: 'personal',
  logoPath: null,
  monogram: 'L',
};

/**
 * Operator-side role names — these get the "Workspaces I run" group.
 * The server's `has_permission()` dispatcher (Plan 09-01) is the security
 * floor; this client heuristic is a UX hint only. If the heuristic is
 * briefly stale (e.g., role just changed), the worst case is a row appears
 * in the wrong group for one render cycle — clicking still routes through
 * App.tsx selectView, which re-checks against actual signed-in state.
 *
 * Documented gap: a future Plan 10-xx can replace this with a
 * `list_user_contexts()` SECURITY DEFINER RPC that returns the
 * server-canonical is_operator boolean. Until then we partition client-side.
 */
const OPERATOR_ROLE_NAMES = new Set(['Owner', 'Coach']);

/**
 * Compute active context id from `window.location.pathname`.
 *   /clinic/{slug}/* → org:{slug}
 *   anything else    → 'personal'
 */
function detectActiveContextId(pathname: string): string {
  const m = /^\/clinic\/([^/]+)/.exec(pathname);
  if (m) return `org:${m[1]}`;
  return 'personal';
}

/**
 * Detect when WorkspaceSwitcher should hide itself entirely (anonymous
 * routes). Belt-and-suspenders: AppShell only mounts on authenticated
 * routes — but ClinicContextBar lives on /clinic/* too, so this guard is
 * harmless extra defense for any future mount site.
 */
function isAnonymousPath(pathname: string): boolean {
  if (pathname.startsWith('/clinic-invite/')) return true;
  return false;
}

function partitionContexts(
  memberships: MembershipJoined[],
  userId: string,
): { mem: ContextRow[]; ws: ContextRow[] } {
  const mem: ContextRow[] = [];
  const ws: ContextRow[] = [];
  for (const m of memberships) {
    const org = m.organizations;
    if (!org) continue;
    const roleName = m.roles?.name ?? '';
    const isOperator = OPERATOR_ROLE_NAMES.has(roleName) || org.created_by === userId;
    const row: ContextRow = {
      kind: isOperator ? 'workspaces' : 'memberships',
      id: m.id,
      label: org.name,
      subtitle: `${isOperator ? 'Operator' : 'Member'} · ${roleName || 'Member'}`,
      href: isOperator ? `/clinic/${org.slug}` : '/settings/organizations',
      ctxId: `org:${org.slug}`,
      logoPath: org.logo_storage_path,
      monogram: (org.name.trim().charAt(0) || '?').toUpperCase(),
    };
    if (isOperator) ws.push(row);
    else mem.push(row);
  }
  return { mem, ws };
}

interface MonogramOrLogoProps {
  logoPath: string | null;
  monogram: string;
  alt: string;
  size?: 'sm' | 'md';
}

function MonogramOrLogo({ logoPath, monogram, alt, size = 'md' }: MonogramOrLogoProps) {
  const dim = size === 'sm' ? 'size-6' : 'size-8';
  if (logoPath) {
    // Inline computation — we avoid pulling the supabase client into this
    // tiny helper at render time; instead the caller can pre-resolve. To
    // keep WorkspaceSwitcher bundle-size minimal we use a synchronous
    // public-URL build (storage public bucket = stable URL form).
    try {
      const { data } = supabase.storage.from('org-logos').getPublicUrl(logoPath);
      const url = data?.publicUrl;
      if (url) {
        return <img src={url} alt={alt} className={cn(dim, 'rounded-md object-cover')} />;
      }
    } catch {
      // fall through to monogram
    }
  }
  return (
    <span
      aria-hidden
      className={cn(
        dim,
        'rounded-md bg-[var(--color-primary-soft)] text-[var(--color-primary)] inline-flex items-center justify-center font-bold text-[13px]',
      )}
    >
      {monogram}
    </span>
  );
}

export interface WorkspaceSwitcherProps {
  className?: string;
}

export function WorkspaceSwitcher({ className }: WorkspaceSwitcherProps) {
  const { t } = useTranslation('nav');
  const [authState, setAuthState] = useState<'pending' | 'anon' | 'signedin'>('pending');
  const [userId, setUserId] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<MembershipJoined[]>([]);
  const [open, setOpen] = useState(false);
  const [pathname, setPathname] = useState<string>(() => window.location.pathname);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  // Pitfall #9 — defer-mount until auth resolves.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        const u = data?.session?.user;
        if (u?.id) {
          setUserId(u.id);
          setAuthState('signedin');
        } else {
          setAuthState('anon');
        }
      } catch {
        if (!cancelled) setAuthState('anon');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refetchMemberships = useCallback(async (uid: string) => {
    try {
      const result = (await supabase
        .from('memberships')
        .select(
          'id, role_id, org_id, organizations(id, slug, name, logo_storage_path, created_by), roles(name)',
        )
        .eq('user_id', uid)
        .is('revoked_at', null)) as { data: MembershipJoined[] | null; error: unknown };
      const rows = result.data ?? [];
      setMemberships(rows);
    } catch {
      // Defensive: leave existing list; never throw out of an effect.
    }
  }, []);

  // Initial fetch when user resolves.
  useEffect(() => {
    if (authState !== 'signedin' || !userId) return;
    void refetchMemberships(userId);
  }, [authState, userId, refetchMemberships]);

  // Realtime — refetch on membership broadcast (Test 16).
  useEffect(() => {
    if (authState !== 'signedin' || !userId) return;
    let channel: { unsubscribe: () => Promise<'ok'> | unknown } | null = null;
    let cancelled = false;
    void (async () => {
      const c = await subscribeToUserChannel(userId, () => {
        if (cancelled) return;
        void refetchMemberships(userId);
      });
      channel = c;
    })();
    return () => {
      cancelled = true;
      void channel?.unsubscribe();
    };
  }, [authState, userId, refetchMemberships]);

  // Listen for path changes so the active-context indicator stays accurate.
  useEffect(() => {
    const onPathChange = (): void => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPathChange);
    return () => window.removeEventListener('popstate', onPathChange);
  }, []);

  const activeContextId = useMemo(() => detectActiveContextId(pathname), [pathname]);

  const { mem, ws } = useMemo(
    () => (userId ? partitionContexts(memberships, userId) : { mem: [], ws: [] }),
    [memberships, userId],
  );

  // Build trigger label
  const triggerContext = useMemo<ContextRow>(() => {
    if (activeContextId === 'personal') return PERSONAL_ROW;
    const match = [...mem, ...ws].find((r) => r.ctxId === activeContextId);
    return match ?? PERSONAL_ROW;
  }, [activeContextId, mem, ws]);

  // Auto-focus the active option when the dropdown opens.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const node = listboxRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
      const fallback = listboxRef.current?.querySelector<HTMLElement>('[role="option"]');
      (node ?? fallback)?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  const navigateAndClose = useCallback((href: string) => {
    // pushState + dispatch popstate so App.tsx's recompute fires.
    window.history.pushState({}, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
    setPathname(window.location.pathname);
    setOpen(false);
    // return focus to trigger
    setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const onKeyDownOption = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, href: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        navigateAndClose(href);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        setTimeout(() => triggerRef.current?.focus(), 0);
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = listboxRef.current;
        if (!list) return;
        const options = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'));
        const idx = options.indexOf(e.currentTarget);
        const next =
          e.key === 'ArrowDown'
            ? options[Math.min(idx + 1, options.length - 1)]
            : options[Math.max(idx - 1, 0)];
        next?.focus();
      }
    },
    [navigateAndClose],
  );

  // Anonymous-route guard.
  if (isAnonymousPath(pathname)) return null;

  // Pitfall #9 — show skeleton while auth pending.
  if (authState === 'pending') {
    return (
      <div className={cn('inline-flex items-center', className)}>
        <Skeleton
          shape="pill"
          data-testid="workspace-switcher-skeleton"
          className="h-9 w-[160px]"
        />
      </div>
    );
  }

  // Anonymous: render nothing.
  if (authState === 'anon') return null;

  const allRows: {
    group: 'personal' | Group;
    rows: ContextRow[];
    heading: string;
    emptyHint: string | null;
  }[] = [
    { group: 'personal', rows: [PERSONAL_ROW], heading: 'Personal account', emptyHint: null },
    {
      group: 'memberships',
      rows: mem,
      heading: 'Memberships',
      emptyHint: "When clinics or coaches invite you, they'll appear here.",
    },
    {
      group: 'workspaces',
      rows: ws,
      heading: 'Workspaces I run',
      emptyHint: 'Create a workspace to start managing patients.',
    },
  ];

  const triggerLabel =
    activeContextId === 'personal'
      ? 'Switch workspace. Currently in your personal account.'
      : `Switch workspace. Currently in ${triggerContext.label}.`;

  return (
    <div className={cn('relative inline-flex items-center', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={triggerLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        data-testid="workspace-switcher-trigger"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.preventDefault();
            setOpen(false);
          }
        }}
        className="inline-flex items-center gap-2 rounded-pill px-2.5 py-1.5 min-h-9 max-w-[220px] hover:bg-[var(--color-surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        <MonogramOrLogo
          logoPath={triggerContext.logoPath}
          monogram={triggerContext.monogram}
          alt={`${triggerContext.label} logo`}
          size="sm"
        />
        <span className="text-[13px] font-semibold text-[var(--color-text)] truncate">
          {triggerContext.label}
        </span>
        <ChevronDown
          className={cn(
            'size-3.5 text-[var(--color-text-tertiary)] transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {open && (
        <>
          {/* Click-away overlay (no backdrop dim — operator-side affordance). */}
          <div aria-hidden className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            aria-label="Workspaces"
            className="absolute left-0 top-[calc(100%+4px)] z-40 w-[280px] max-h-[80vh] overflow-y-auto rounded-card border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg p-1"
          >
            {allRows.map((g) => {
              const headingId = `${listboxId}-${g.group}-heading`;
              return (
                <div key={g.group} role="group" aria-labelledby={headingId} className="py-1">
                  <div
                    id={headingId}
                    className="px-3 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]"
                  >
                    {g.heading}
                  </div>
                  {g.rows.length === 0 && g.emptyHint ? (
                    <p className="px-3 py-1.5 text-[12px] text-[var(--color-text-tertiary)] italic">
                      {g.emptyHint}
                    </p>
                  ) : (
                    g.rows.map((row) => {
                      const isActive = row.ctxId === activeContextId;
                      return (
                        <div
                          key={row.id}
                          role="option"
                          aria-selected={isActive}
                          {...(isActive ? { 'aria-current': 'true' as const } : {})}
                          tabIndex={-1}
                          onClick={() => navigateAndClose(row.href)}
                          onKeyDown={(e) => onKeyDownOption(e, row.href)}
                          className={cn(
                            'flex items-center gap-2.5 cursor-pointer rounded-md px-2.5 py-1.5 mx-1 text-start',
                            'hover:bg-[var(--color-surface-elevated)] focus:bg-[var(--color-surface-elevated)] focus:outline-none',
                            isActive && 'border-s-2 border-teal-700 ps-[8px]',
                          )}
                        >
                          <MonogramOrLogo
                            logoPath={row.logoPath}
                            monogram={row.monogram}
                            alt={`${row.label} logo`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-semibold text-[var(--color-text)] truncate">
                              {row.label}
                            </div>
                            <div className="text-[11px] text-[var(--color-text-tertiary)] truncate">
                              {row.subtitle}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })}
            <div className="border-t border-[var(--color-border)] mt-1 pt-1">
              <button
                type="button"
                onClick={() => navigateAndClose('/?create-workspace=1')}
                className="w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] font-medium text-[var(--color-primary)] hover:bg-[var(--color-surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                <Plus className="size-4" aria-hidden />
                {t('create_workspace', 'Create a new workspace')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default WorkspaceSwitcher;
