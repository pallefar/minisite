/**
 * Phase 22 Plan 22-05 — SoftDeleteCountdownBanner (DEL-01 post-delete).
 *
 * Sticky top banner that mounts at AppShell root when the current user has a
 * `pending_account_deletions` row. Counts down to the day-8 hard-delete cron
 * (cron is 7 days per plan 22-01 File 01).
 *
 * Priority rule (per 22-UI-SPEC line 317): if the impersonation banner is
 * visible, the soft-delete banner is NOT mounted (only one global banner can
 * show; impersonation wins). We detect impersonation by reading the current
 * session's `app_metadata.impersonator_id` field — set by plan 22-04's
 * `admin.updateUserById` flow. If `app_metadata.impersonator_id` is non-null
 * we render null. This avoids a hard dependency on the (Wave 2)
 * useImpersonation hook that ships in plan 22-04.
 *
 * Cancel handler: prefer a `?cancel_token=` query param (lifecycle-transactional
 * email link sometimes lands users on the dashboard with the token attached)
 * → calls `cancel_account_deletion` RPC directly. If absent, navigates to
 * `/cancel-deletion` which has the help text + resend-email CTA (Task 4).
 *
 * Mount integration note for plan 22-12: this banner must be mounted at the
 * top of `AppShell` ABOVE the topbar so its `sticky top-0 z-[60]` slot is the
 * first child of the scroll container. AppShell.tsx currently does not mount
 * it (this plan only ships the component); plan 22-12 wires it.
 */
import { AlertTriangle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

const GRACE_DAYS = 7;
const MS_PER_DAY = 86_400_000;

interface PendingRow {
  initiated_at: string;
}

export function SoftDeleteCountdownBanner() {
  const toast = useToast();
  const [row, setRow] = useState<PendingRow | null>(null);
  const [impersonating, setImpersonating] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Load the pending row (if any) for the current user. Also detect
  // impersonation via the current session's app_metadata — impersonation
  // wins per UI-SPEC priority and we hide this banner entirely.
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) {
        if (!cancelled) setRow(null);
        return;
      }
      // Impersonation check (plan 22-04 contract): non-null
      // app_metadata.impersonator_id means an admin is impersonating this
      // user. The soft-delete banner must yield.
      const appMeta = session.user?.app_metadata ?? {};
      const isImp = Boolean((appMeta as Record<string, unknown>).impersonator_id);
      if (!cancelled) setImpersonating(isImp);
      if (isImp) {
        if (!cancelled) setRow(null);
        return;
      }

      const { data, error } = await supabase
        .from('pending_account_deletions')
        .select('initiated_at')
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        // Table may not be readable due to RLS in some edge cases (e.g.,
        // the deletion already finalized between session load and SELECT).
        // Treat as "no pending row" — the banner stays hidden.
        setRow(null);
        return;
      }
      setRow(data ?? null);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCancel = useCallback(async (): Promise<void> => {
    if (cancelling) return;
    // Prefer a token from the URL query (e.g., user arrived via the cancel
    // email link and the banner is still visible). If no token, route to
    // /cancel-deletion which has the help-text fallback.
    const params = new URLSearchParams(window.location.search);
    const token = params.get('cancel_token') ?? params.get('token');
    if (!token) {
      window.history.pushState({}, '', '/cancel-deletion');
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    setCancelling(true);
    try {
      const { error } = await supabase.rpc('cancel_account_deletion', { p_token: token });
      if (error) {
        toast(
          'That cancel link is no longer valid. Try the email link or contact support.',
          'error',
        );
        return;
      }
      toast('Deletion canceled. Welcome back!', 'success');
      setRow(null);
    } finally {
      setCancelling(false);
    }
  }, [cancelling, toast]);

  if (impersonating) return null;
  if (!row) return null;

  const initiatedMs = new Date(row.initiated_at).getTime();
  if (!Number.isFinite(initiatedMs)) return null;
  const deadlineMs = initiatedMs + GRACE_DAYS * MS_PER_DAY;
  const daysRemaining = Math.ceil((deadlineMs - Date.now()) / MS_PER_DAY);
  if (daysRemaining <= 0) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="soft-delete-countdown-banner"
      className="sticky top-0 z-[60] flex items-center justify-between gap-3 px-4 h-12 bg-[var(--color-danger-soft)] text-[var(--color-danger)] border-b border-[var(--color-danger)]"
    >
      <span className="flex items-center gap-2 min-w-0">
        <AlertTriangle aria-hidden className="size-4 shrink-0" />
        <span className="text-[13px] font-medium truncate">
          Account scheduled for deletion in {daysRemaining} days.
        </span>
      </span>
      <button
        type="button"
        onClick={() => {
          void handleCancel();
        }}
        disabled={cancelling}
        className="bg-[var(--color-danger)] text-white hover:opacity-90 h-8 px-3 rounded-pill text-[13px] font-semibold disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-danger)]"
      >
        Cancel deletion
      </button>
    </div>
  );
}

export default SoftDeleteCountdownBanner;
