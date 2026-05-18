/**
 * Phase 28 Plan 06 — ORG-07 route guard for /clinic/:slug/* routes.
 *
 * Wraps route trees mounted at /clinic/{slug}/*. On mount:
 *   1. Calls resolve_clinic_slug SECDEF RPC with the slug from props.
 *   2. Branches on the returned state:
 *      - 'member'         → injects org into Zustand org slice; renders children.
 *      - 'pending_invite' → renders <OrgInviteAcceptance> (inline — org-level invite).
 *      - 'not_found'      → renders generic not-found surface (does NOT reveal slug existence).
 *
 * MFA gate composition (CONTEXT D-10 + Phase 25):
 *   <RouteOrgGuard> is rendered INSIDE the /clinic/* route tree which already enforces
 *   MFA (aal2) via Vercel Routing Middleware (Phase 25). This component does NOT re-check
 *   aal2; the path-level gate upstream is more reliable and avoids a race condition between
 *   the middleware check and this component's async RPC resolution.
 *
 * PHI access logging (Phase 25 D-07 integration seam):
 *   PatientDetailDrawer does NOT already call log_phi_access (verified during Plan 06 execution:
 *   grep -rn 'log_phi_access' src/ returned 0 results). Therefore this component adds a
 *   usePhiAccessLogger hook that fires when the current pathname matches /clinic/:slug/patients/:id.
 *
 * Stale org slice protection (T-28-06-05):
 *   useEffect cleanup calls clearCurrentOrg() on unmount so the next route mount re-resolves.
 *
 * Anti-enumeration (T-28-06-01):
 *   The resolve_clinic_slug RPC returns identical {state:'not_found'} for both non-existent
 *   slugs AND existing-slug-with-no-relationship. This component renders the same generic
 *   not-found surface for both cases, providing zero information about slug existence.
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import type { OrgContext, OrgRole } from '@/types/org';

// ---------------------------------------------------------------------------
// Type — matches SECDEF RPC response (CONTEXT D-19).
// ---------------------------------------------------------------------------

type ResolveSlugResult =
  | { state: 'member'; org_summary: { id: string; slug: string; name: string; role: OrgRole } }
  | { state: 'pending_invite'; invite_summary: { invite_id: string; role: OrgRole; expires_at: string } }
  | { state: 'not_found' };

// ---------------------------------------------------------------------------
// usePhiAccessLogger — Phase 25 D-07 integration seam.
// Fires log_phi_access when pathname matches /clinic/:slug/patients/:patientId.
// Fire-and-forget: errors are not surfaced to the UI (audit logging is best-effort).
// ---------------------------------------------------------------------------

function usePhiAccessLogger(orgId: string | null, currentPath: string): void {
  const lastLoggedRef = useRef<string>('');

  useEffect(() => {
    if (!orgId) return;
    const m = currentPath.match(/^\/clinic\/[^/]+\/patients\/([^/?#]+)/);
    if (!m) return;
    const patientId = m[1];
    const logKey = `${orgId}:${patientId}:${currentPath}`;
    if (lastLoggedRef.current === logKey) return; // Avoid duplicate logs on re-renders.
    lastLoggedRef.current = logKey;

    // Fire-and-forget: log_phi_access RPC is best-effort (T-28-06-03 mitigation).
    void supabase.rpc('log_phi_access', {
      p_patient_id: patientId,
      p_org_id: orgId,
      p_route: currentPath,
    });
  }, [orgId, currentPath]);
}

// ---------------------------------------------------------------------------
// OrgInviteAcceptance — inline component for pending org-member invites.
// Rendered when resolve_clinic_slug returns state='pending_invite'.
// This is an org-level membership invite (different from the patient-level
// ClinicInvitePage which handles token-based patient data sharing invites).
// ---------------------------------------------------------------------------

interface OrgInviteAcceptanceProps {
  inviteId: string;
  role: OrgRole;
  expiresAt: string;
  slug: string;
  onAccepted: () => void;
}

function OrgInviteAcceptance({ inviteId, role, expiresAt, slug, onAccepted }: OrgInviteAcceptanceProps): ReactElement {
  const [accepting, setAccepting] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roleLabel: Record<OrgRole, string> = {
    owner: 'Administrator',
    clinician: 'Clinician',
    staff: 'Staff',
  };

  const expiry = new Date(expiresAt);
  const expiresDisplay = expiry.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  async function handleAccept(): Promise<void> {
    setAccepting(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('accept_org_invite', {
        p_invite_id: inviteId,
      });
      if (rpcErr) {
        setError(rpcErr.message ?? 'Failed to accept invitation. Please try again.');
        return;
      }
      // Re-resolve org membership now that invite is accepted.
      onAccepted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error. Please try again.');
    } finally {
      setAccepting(false);
    }
  }

  if (declined) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] px-5 py-10"
        data-testid="org-invite-acceptance"
      >
        <Card variant="elevated" padding="lg" className="max-w-[480px] w-full text-center">
          <p className="text-[16px] text-[var(--color-text-secondary)]">
            You have declined the invitation to join this clinic.
          </p>
          <Button variant="ghost" className="mt-6" onClick={() => (window.location.href = '/')}>
            Go to LeanShot
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] px-5 py-10"
      data-testid="org-invite-acceptance"
    >
      <Card variant="elevated" padding="lg" className="max-w-[480px] w-full">
        <h1 className="text-[22px] font-bold tracking-tight text-[var(--color-text)]">
          You have been invited to join a clinic
        </h1>
        <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
          You have been invited as <strong>{roleLabel[role]}</strong> to the clinic at{' '}
          <code className="text-[13px] bg-[var(--color-bg-secondary)] px-1 rounded">{slug}</code>.
          This invitation expires on <strong>{expiresDisplay}</strong>.
        </p>

        {error && (
          <p role="alert" className="mt-4 text-[13px] text-[var(--color-danger)]">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button
            variant="primary"
            loading={accepting}
            aria-label="Accept invitation"
            onClick={() => void handleAccept()}
          >
            Accept invitation
          </Button>
          <Button
            variant="ghost"
            disabled={accepting}
            aria-label="Decline invitation"
            onClick={() => setDeclined(true)}
          >
            Decline
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OrgNotFound — generic not-found surface. Does NOT reveal slug existence.
// Used for BOTH non-existent slug AND existing-slug-with-no-membership cases.
// (Anti-enumeration: identical render for both per T-28-06-01 + T5.)
// ---------------------------------------------------------------------------

function OrgNotFound(): ReactElement {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] px-5 py-10"
      data-testid="org-not-found"
    >
      <Card variant="elevated" padding="lg" className="max-w-[480px] w-full text-center">
        <h1 className="text-[22px] font-bold tracking-tight text-[var(--color-text)]">
          Page not found
        </h1>
        <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
          This page does not exist or you do not have access. If you received an invitation, check
          your email for the invitation link.
        </p>
        <Button variant="ghost" className="mt-6" onClick={() => (window.location.href = '/')}>
          Go to LeanShot
        </Button>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RouteOrgGuard — main export.
// ---------------------------------------------------------------------------

export interface RouteOrgGuardProps {
  /** Clinic slug from the URL path segment /clinic/{slug}/*. */
  slug: string;
  children: ReactNode;
  /**
   * Current pathname — used by usePhiAccessLogger to detect patient routes.
   * Defaults to window.location.pathname when not provided.
   */
  currentPath?: string;
}

export function RouteOrgGuard({
  slug,
  children,
  currentPath,
}: RouteOrgGuardProps): ReactElement {
  const [result, setResult] = useState<ResolveSlugResult | null>(null);
  const resolvedOrgId = result?.state === 'member' ? result.org_summary.id : null;
  const path = currentPath ?? (typeof window !== 'undefined' ? window.location.pathname : '');

  // PHI access logging — fires when patient route is mounted (Phase 25 D-07).
  usePhiAccessLogger(resolvedOrgId, path);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { data, error } = await supabase.rpc('resolve_clinic_slug', { p_slug: slug });
      if (cancelled) return;

      if (error || !data) {
        setResult({ state: 'not_found' });
        return;
      }

      const resolved = data as ResolveSlugResult;
      setResult(resolved);

      if (resolved.state === 'member') {
        const org: OrgContext = {
          id: resolved.org_summary.id,
          slug: resolved.org_summary.slug,
          name: resolved.org_summary.name,
        };
        useStore.getState().setCurrentOrg(org, resolved.org_summary.role);
      }
    })();

    return () => {
      cancelled = true;
      // T-28-06-05 — clear org slice on unmount so stale context doesn't bleed
      // across route transitions. Next mount re-resolves from scratch.
      useStore.getState().clearCurrentOrg();
    };
  }, [slug]);

  // Loading state.
  if (result === null) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]"
        data-testid="route-org-guard-loading"
      >
        <Spinner size="lg" label="Resolving clinic…" />
      </div>
    );
  }

  // Member state — render clinic surface.
  if (result.state === 'member') {
    return <>{children}</>;
  }

  // Pending invite — render org invite acceptance UI.
  if (result.state === 'pending_invite') {
    return (
      <OrgInviteAcceptance
        inviteId={result.invite_summary.invite_id}
        role={result.invite_summary.role}
        expiresAt={result.invite_summary.expires_at}
        slug={slug}
        onAccepted={() => {
          // Re-resolve org membership after accept.
          setResult(null);
        }}
      />
    );
  }

  // Not found — generic surface (anti-enumeration: same for non-existent AND no-relationship).
  return <OrgNotFound />;
}

export default RouteOrgGuard;
