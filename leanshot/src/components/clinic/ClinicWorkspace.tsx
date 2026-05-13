/**
 * Phase 9 Plan 09-02 — ClinicWorkspace.
 *
 * Operator workspace home at `/clinic/{slug}`. Composition:
 *
 *   ClinicContextBar (sticky top)
 *   Page eyebrow + heading + subhead
 *   Empty-roster shell (D-08 — "No patients yet — Invite your first")
 *   InvitePatientModal (controlled, opens via local state)
 *
 * Plan 09-02 ships the EMPTY-roster slice only. Phase 10 fills the
 * roster table with rank+drill-in. Plan 09-03 ships the actual
 * /clinic/{slug}/settings page (this file just links to it).
 *
 * Data lifecycle:
 *   - Read slug from window.location.pathname (path-based routing — App.tsx).
 *   - Query `orgs` row via supabase-js (RLS gates to owner/member).
 *   - On 401/404 / no row → route back to `/`.
 *   - When `?invite=1` query param is set (OrgCreateFlow success-state
 *     handoff), auto-open InvitePatientModal once on first hydrate.
 *
 * This file OVERWRITES the Plan 09-01 stub. App.tsx routing already
 * binds `/clinic/{slug}` → this lazy chunk (B-2 ownership).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';
import type { Org } from '@/types/clinic';
import { ClinicContextBar } from './ClinicContextBar';
import { InvitePatientModal } from './InvitePatientModal';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'hydrated'; org: Org };

function slugFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(/^\/clinic\/([^/]+)/);
  return m ? m[1] : null;
}

function shouldOpenInviteFromQuery(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('invite') === '1';
  } catch {
    return false;
  }
}

function navigateHome(): void {
  if (typeof window === 'undefined') return;
  try {
    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch {
    /* jsdom no-op */
  }
}

export function ClinicWorkspace() {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [inviteOpen, setInviteOpen] = useState<boolean>(() => shouldOpenInviteFromQuery());

  const slug = useMemo(() => slugFromLocation(), []);

  const loadOrg = useCallback(async () => {
    if (!slug) {
      navigateHome();
      return;
    }
    setLoad({ kind: 'loading' });
    try {
      const { data, error } = await supabase
        .from('orgs')
        .select('id, slug, name, description, website_url, logo_storage_path, owner_user_id, created_at')
        .eq('slug', slug)
        .maybeSingle();
      if (error) {
        // 401 or general DB error → bounce home or surface retry.
        // RLS denial for a non-member surfaces as `data:null,error:null`
        // (`maybeSingle` returns no row when filter doesn't match RLS).
        setLoad({
          kind: 'error',
          message: "Couldn't load workspace. Check your connection and try again.",
        });
        return;
      }
      if (!data) {
        // No row visible (either doesn't exist or RLS blocked) → home.
        navigateHome();
        return;
      }
      setLoad({ kind: 'hydrated', org: data as Org });
    } catch {
      setLoad({
        kind: 'error',
        message: "Couldn't load workspace. Check your connection and try again.",
      });
    }
  }, [slug]);

  useEffect(() => {
    void loadOrg();
  }, [loadOrg]);

  // ----- Loading state -----------------------------------------------
  if (load.kind === 'loading') {
    return (
      <div className="min-h-screen bg-[var(--color-bg)]" data-testid="clinic-workspace-loading">
        <header className="sticky top-0 z-20 flex items-center gap-3 px-4 md:px-6 h-14 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-4 w-40" />
        </header>
        <main className="max-w-5xl mx-auto p-6 space-y-4">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-5 w-56" />
          <div className="pt-8">
            <Skeleton className="h-40 w-full rounded-card" />
          </div>
        </main>
      </div>
    );
  }

  // ----- Error state -------------------------------------------------
  if (load.kind === 'error') {
    return (
      <div
        role="alert"
        className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-6"
        data-testid="clinic-workspace-error"
      >
        <div className="text-center space-y-4 max-w-md">
          <h2 className="text-[18px] font-bold text-[var(--color-text)]">
            Couldn&apos;t load workspace
          </h2>
          <p className="text-[14px] text-[var(--color-text-secondary)]">{load.message}</p>
          <Button variant="primary" onClick={() => void loadOrg()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // ----- Hydrated state ---------------------------------------------
  const { org } = load;
  return (
    <div className="min-h-screen bg-[var(--color-bg)]" data-testid="clinic-workspace">
      <ClinicContextBar org={org} />
      <main className="max-w-5xl mx-auto p-6 md:p-8 space-y-6">
        <header className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">
            Workspace
          </p>
          <h1 className="text-[24px] md:text-[32px] font-bold text-[var(--color-text)]">
            {org.name}
          </h1>
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            Your patients will appear here.
          </p>
        </header>

        <section
          className="rounded-card border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
          aria-label="Patient roster"
        >
          <EmptyState
            title="No patients yet"
            body="Invite your first patient by email. They'll see your workspace name and choose what data to share with you."
            cta={
              <div className="flex flex-col-reverse md:flex-row gap-2">
                <a
                  href={`/clinic/${org.slug}/settings`}
                  className="inline-flex items-center justify-center h-11 px-5 rounded-pill border border-[var(--color-border-strong)] text-[14px] font-semibold text-[var(--color-text)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
                >
                  Customize workspace
                </a>
                <Button variant="primary" onClick={() => setInviteOpen(true)}>
                  Invite patient
                </Button>
              </div>
            }
          />
        </section>
      </main>

      <InvitePatientModal
        open={inviteOpen}
        orgId={org.id}
        onClose={() => setInviteOpen(false)}
      />
    </div>
  );
}

export default ClinicWorkspace;
