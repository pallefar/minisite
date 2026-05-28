/**
 * Phase 45 Plan 45-08 — AdminReportsDigestPage.
 *
 * Staff-only surface at /admin/community/reports. Provides:
 *   - Caller-scoped opt-in toggle for the daily admin report digest email
 *     (admin_toggle_report_digest_opt_in SECDEF RPC — D-11).
 *   - Aggregate count of open community_reports (no row-level data — full
 *     moderation queue UI ships in Phase 48 per CONTEXT D-11).
 *
 * Security:
 *   - UX layer: AdminShell minRole='staff' gates module visibility.
 *   - DB layer: admin_toggle_report_digest_opt_in RPC SECDEF + is_staff() guard
 *     (Pattern S1 dual-layer). UI MUST NOT bypass with direct profiles.update.
 *   - Aggregate count uses head:true so no row payload is exposed
 *     (T-45-09 mitigation — Information Disclosure).
 */
import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

export function AdminReportsDigestPage() {
  const toast = useToast();

  const [optedIn, setOptedIn] = useState<boolean | null>(null);
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);

      // Resolve current admin user.
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (cancelled) return;
      if (userErr || !userData?.user) {
        toast(`Failed to load profile: ${userErr?.message ?? 'no session'}`, 'error');
        setLoading(false);
        return;
      }

      const [profileRes, countRes] = await Promise.all([
        supabase.from('profiles').select('admin_digest_opt_in').eq('id', userData.user.id).single(),
        supabase
          .from('community_reports')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'open'),
      ]);
      if (cancelled) return;

      if (profileRes.error) {
        toast(`Failed to load digest preference: ${profileRes.error.message}`, 'error');
      } else {
        setOptedIn(Boolean(profileRes.data?.admin_digest_opt_in));
      }

      if (countRes.error) {
        // Non-fatal — show "—" for the count.
        setOpenCount(null);
      } else {
        setOpenCount(countRes.count ?? 0);
      }

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const handleToggle = async () => {
    if (busy || optedIn === null) return;
    const next = !optedIn;
    setBusy(true);
    setOptedIn(next); // optimistic

    const { error } = await supabase.rpc('admin_toggle_report_digest_opt_in', {
      p_enabled: next,
    });

    if (error) {
      setOptedIn(!next); // revert
      toast(`Failed to update preference: ${error.message}`, 'error');
    } else {
      toast(
        next
          ? 'You will now receive the daily admin report digest.'
          : 'You will no longer receive the daily admin report digest.',
        'success',
      );
    }
    setBusy(false);
  };

  if (loading) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        Loading report digest preferences…
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold">Report digest</h2>
        <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
          Aggregate-only view. The full moderation queue ships in Phase 48 — for now, opt in to the
          daily email digest to receive a summary of new reports grouped by target type.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <div>
          <p className="text-sm font-medium">Receive daily report digest email</p>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            Sent once per day if at least one new report was filed in the last 24 hours.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleToggle()}
          disabled={busy || optedIn === null}
          aria-pressed={optedIn === true}
          aria-busy={busy}
          aria-label={
            optedIn ? 'Disable daily report digest email' : 'Enable daily report digest email'
          }
          className={
            'inline-flex h-7 items-center rounded-full px-4 text-xs font-medium transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ' +
            (optedIn
              ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
              : 'border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)]')
          }
        >
          {busy ? '…' : optedIn ? 'On' : 'Off'}
        </button>
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
          Open reports
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {openCount === null ? '—' : openCount}
        </p>
        <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
          Total community_reports with status=&apos;open&apos; visible to your staff scope.
        </p>
      </div>
    </div>
  );
}
