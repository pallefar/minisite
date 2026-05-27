/**
 * Phase 19 Plan 19-06a — PartnerLayout (shared shell for /partner/*).
 *
 * Spec references:
 *   - 19-CONTEXT.md D-10: 10-min poll
 *   - 19-UI-SPEC.md §/partner/dashboard: sub-nav + role gate
 *   - 19-PATTERNS.md §C.4: SWR + lastFetchedAt pattern
 *   - mirror Phase 9/10 clinic-operator role pattern: client-side gate is a
 *     HINT; RLS in Plan 19-01 is enforcement (T-19-06a-S).
 *
 * Exports:
 *   - PartnerContext (React Context) — consumed by 19-06b
 *   - usePartnerContext() — throws if used outside provider
 *   - default PartnerLayout
 *
 * BL-4: does NOT modify App.tsx. Plan 19-09 wires the route.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { fetchAffiliateProfile, type AffiliateProfile } from '@/lib/affiliate/api';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

const POLL_MS = 10 * 60 * 1000; // 10 min — D-10

export type ConnectState = 'pending' | 'needs_info' | 'active' | 'restricted';

export interface PartnerContextValue {
  profile: AffiliateProfile;
  connectState: ConnectState;
  requirements: string[];
  disabledReason: string | null;
  refreshAll: () => void;
  lastFetchedAt: Date | null;
}

export const PartnerContext = createContext<PartnerContextValue | null>(null);

export function usePartnerContext(): PartnerContextValue {
  const ctx = useContext(PartnerContext);
  if (!ctx) {
    throw new Error('usePartnerContext must be used inside a <PartnerLayout> provider');
  }
  return ctx;
}

const SUB_NAV: { to: string; label: string }[] = [
  { to: '/partner/dashboard', label: 'Dashboard' },
  { to: '/partner/links', label: 'Links' },
  { to: '/partner/payouts', label: 'Payouts' },
  { to: '/partner/assets', label: 'Assets' },
];

interface ForbiddenStateProps {
  title?: string;
  body?: string;
}

function ForbiddenState({ title, body }: ForbiddenStateProps): ReactNode {
  return (
    <div className="max-w-[480px] mx-auto py-16 px-4 md:px-6">
      <Card variant="default" padding="lg" span={12}>
        <h1 className="text-2xl font-semibold text-[var(--color-text)] mb-2">
          {title ?? 'This area is for approved affiliates only'}
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          {body ??
            "If you'd like to join the LeanShot affiliate program, head back to the main site to apply."}
        </p>
        <a
          href="/"
          className="text-sm font-semibold text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded-pill"
        >
          Back to LeanShot →
        </a>
      </Card>
    </div>
  );
}

interface PartnerAccountStatusResponse {
  state: ConnectState;
  requirements: string[];
  disabled_reason: string | null;
}

async function fetchPartnerAccountStatus(): Promise<PartnerAccountStatusResponse | null> {
  try {
    const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
    const sess = await supabase.auth.getSession();
    const jwt = sess.data.session?.access_token;
    if (!jwt) return null;
    // base is empty in test mode; fetch URL becomes `/functions/v1/...` which
    // the test's fetchMock matches. Production sets VITE_SUPABASE_URL.
    const res = await fetch(`${base}/functions/v1/partner-account-status`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as PartnerAccountStatusResponse;
  } catch {
    return null;
  }
}

export interface PartnerLayoutProps {
  children: ReactNode;
  /** Test-only: override the active path (defaults to window.location.pathname). */
  __testActivePath?: string;
}

/**
 * Shared shell for /partner/*. Enforces:
 *   1. Signed-in user
 *   2. `auth.users.app_metadata.role === 'affiliate'` (hint — RLS is enforcement)
 *   3. Real `affiliates` row exists (D-12: even if app_metadata is set, no row → forbidden)
 *
 * Provides PartnerContext to children.
 */
export default function PartnerLayout({
  children,
  __testActivePath,
}: PartnerLayoutProps): ReactNode {
  const user = useStore((s) => s.signedIn?.user ?? null);

  // Guard #1: signed in
  if (!user) {
    return (
      <ForbiddenState
        title="Sign in to access the partner area"
        body="Please sign in with the email you used when applying to the affiliate program."
      />
    );
  }

  // Guard #2: role hint
  const role = (user.app_metadata as { role?: string } | undefined)?.role;
  if (role !== 'affiliate') {
    return <ForbiddenState />;
  }

  return <PartnerLayoutInner user={user} __testActivePath={__testActivePath}>{children}</PartnerLayoutInner>;
}

interface PartnerLayoutInnerProps {
  user: { id: string };
  children: ReactNode;
  __testActivePath?: string;
}

function PartnerLayoutInner({
  user,
  children,
  __testActivePath,
}: PartnerLayoutInnerProps): ReactNode {
  const [profile, setProfile] = useState<AffiliateProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState<boolean>(true);
  const [profileError, setProfileError] = useState<boolean>(false);
  const [connectState, setConnectState] = useState<ConnectState>('pending');
  const [requirements, setRequirements] = useState<string[]>([]);
  const [disabledReason, setDisabledReason] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  // Bump on every refreshAll() to give context consumers a re-render trigger
  // for their own data fetchers.
  const [refreshTick, setRefreshTick] = useState<number>(0);

  // Load profile once on mount (guard #3).
  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const p = await fetchAffiliateProfile(user.id, supabase);
        if (cancelled) return;
        setProfile(p);
        setProfileError(false);
      } catch {
        if (!cancelled) setProfileError(true);
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  // Load account-status + poll every 10 min + window-focus refresh.
  const loadStatus = useCallback(async () => {
    const s = await fetchPartnerAccountStatus();
    if (s) {
      setConnectState(s.state);
      setRequirements(s.requirements ?? []);
      setDisabledReason(s.disabled_reason ?? null);
    }
    setLastFetchedAt(new Date());
  }, []);

  useEffect(() => {
    if (!profile) return;
    void loadStatus();
    const id = window.setInterval(() => {
      void loadStatus();
    }, POLL_MS);
    const onFocus = (): void => {
      void loadStatus();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [profile, loadStatus]);

  const refreshAll = useCallback((): void => {
    void loadStatus();
    setRefreshTick((t) => t + 1);
  }, [loadStatus]);

  const activePath =
    __testActivePath ??
    (typeof window !== 'undefined' ? window.location.pathname : '/partner/dashboard');

  const ctxValue = useMemo<PartnerContextValue | null>(() => {
    if (!profile) return null;
    return {
      profile,
      connectState,
      requirements,
      disabledReason,
      refreshAll,
      lastFetchedAt,
    };
    // refreshTick is intentionally part of the dep array so memoized children re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, connectState, requirements, disabledReason, refreshAll, lastFetchedAt, refreshTick]);

  if (profileLoading) {
    return (
      <div className="max-w-[1080px] mx-auto py-8 px-4 md:px-6">
        <Skeleton className="h-10 w-64 mb-6" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (profileError || !profile) {
    return <ForbiddenState />;
  }

  return (
    <PartnerContext.Provider value={ctxValue!}>
      <div className="max-w-[1080px] mx-auto py-8 px-4 md:px-6">
        <PartnerSubNav activePath={activePath} />
        {children}
      </div>
    </PartnerContext.Provider>
  );
}

function PartnerSubNav({ activePath }: { activePath: string }): ReactNode {
  return (
    <nav aria-label="Partner sections" className="mb-6 border-b border-[var(--color-border)]">
      <ul className="flex items-center gap-1 md:gap-3 -mb-px">
        {SUB_NAV.map((item) => {
          const isActive = activePath === item.to || activePath.startsWith(`${item.to}/`);
          return (
            <li key={item.to}>
              <a
                href={item.to}
                aria-current={isActive ? 'page' : undefined}
                className={
                  isActive
                    ? 'inline-block px-3 py-2 text-sm font-semibold text-[var(--color-primary)] border-b-2 border-[var(--color-primary)]'
                    : 'inline-block px-3 py-2 text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border-b-2 border-transparent'
                }
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// Exposed for testing the poll cadence without driving real timers further out.
export const __TEST_ONLY__ = { POLL_MS };
