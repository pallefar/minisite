/**
 * Phase 22 plan 22-11 — DSAR portal (GDPR-03, D-06).
 *
 * Patient-only self-serve entry point for GDPR Article 15 (right of access).
 * Surfaced at `/settings/privacy/dsar` (routing wiring lands in plan 22-12).
 *
 * Flow per UI-SPEC §`/settings/privacy/dsar`:
 *   1. Hero card with heading "Your data" + body explaining the bundle scope
 *      + 30-day SLA badge + "Export my data" CTA.
 *   2. CTA opens a confirmation `<Modal>` (verbatim copy lines 615-618).
 *   3. Confirm → `create_dsar_request` RPC → INSERTs `pending` row.
 *   4. Active request renders in `<DsarStatusCard>` below the hero, polling
 *      via Realtime (or 30s setInterval fallback for jsdom / blocked
 *      WebSockets) for status transitions.
 *   5. On status='completed', fetch a fresh signed URL from the
 *      `dsar-exports` bucket and surface a "Download bundle" CTA.
 *   6. Past requests render under a "Previous exports" heading.
 *
 * Server cascade is owned by `supabase/functions/dsar-export` (plan 22-04) —
 * the cron tick (plan 22-11 migration 21) picks pending rows up every 5min.
 */
import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import {
  DsarError,
  getDsarRequest,
  listDsarRequests,
  requestDsarExport,
  subscribeDsarRequests,
  type DsarRequestRow,
} from '@/lib/dsar/dsar-export-client';
import { DsarStatusCard } from './DsarStatusCard';

const STATUS_LABEL_MAP: Record<DsarRequestRow['status'], string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Ready to download',
  rejected: 'Rejected',
};

const STATUS_FALLBACK_POLL_MS = 30_000;
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour client-side download window

/**
 * Generate a fresh signed URL for the completed export. The original 7-day
 * Edge-Fn-minted URL is what's emailed to the user; the portal generates
 * its own short-lived URL when the user clicks Download from the page.
 */
async function generateDownloadUrl(exportPath: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from('dsar-exports')
      .createSignedUrl(exportPath, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

export function DsarPortalPage() {
  const signedIn = useStore((s) => s.signedIn);
  const userId = signedIn?.user?.id ?? null;
  const toast = useToast();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeRequest, setActiveRequest] = useState<DsarRequestRow | null>(null);
  const [history, setHistory] = useState<DsarRequestRow[]>([]);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);

  /**
   * Load history on mount + whenever a new request is created. The newest
   * non-terminal row becomes the active request; the rest seed history.
   */
  const refresh = useCallback(async (): Promise<void> => {
    setLoadingHistory(true);
    try {
      const rows = await listDsarRequests();
      const liveRow = rows.find((r) => r.status === 'pending' || r.status === 'in_progress');
      const completedOrRejected = rows.filter((r) => r !== liveRow);
      // If no live row but the most recent is completed/rejected within the
      // session, surface it as the active card so the user sees their result.
      const mostRecentNonLive = rows.find((r) => r.status === 'completed' || r.status === 'rejected');
      const active = liveRow ?? mostRecentNonLive ?? null;
      setActiveRequest(active);
      setHistory(active ? completedOrRejected.filter((r) => r.id !== active.id) : rows);

      // Pre-fetch signed URL when active row is already completed.
      if (active?.status === 'completed' && active.export_path) {
        const url = await generateDownloadUrl(active.export_path);
        setDownloadUrl(url);
      }
    } catch (e) {
      console.error('[dsar-portal] listDsarRequests failed', e);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Realtime subscription for live status transitions. Falls back to a 30s
   * setInterval poll when Realtime isn't available (jsdom + tests + blocked
   * WebSockets in restrictive networks).
   */
  useEffect(() => {
    if (!userId || !activeRequest) return;
    if (activeRequest.status === 'completed' || activeRequest.status === 'rejected') return;

    let unsubscribe: (() => void) | null = null;
    try {
      const sub = subscribeDsarRequests(userId, (row) => {
        if (row.id === activeRequest.id) {
          setActiveRequest(row);
          if (row.status === 'completed' && row.export_path) {
            void generateDownloadUrl(row.export_path).then(setDownloadUrl);
          }
        }
      });
      unsubscribe = sub.unsubscribe;
    } catch (e) {
      console.warn('[dsar-portal] Realtime subscribe failed; falling back to poll', e);
    }

    // Always run the fallback poll alongside Realtime; the poll is cheap and
    // protects against stuck-subscription scenarios. The status check inside
    // the poll handler is idempotent (setActiveRequest with same row is a
    // React no-op for object identity, and we only call setState when the
    // row actually changed).
    const pollId = window.setInterval(() => {
      void (async () => {
        const fresh = await getDsarRequest(activeRequest.id);
        if (fresh && fresh.status !== activeRequest.status) {
          setActiveRequest(fresh);
          if (fresh.status === 'completed' && fresh.export_path) {
            const url = await generateDownloadUrl(fresh.export_path);
            setDownloadUrl(url);
          }
        }
      })();
    }, STATUS_FALLBACK_POLL_MS);

    return () => {
      if (unsubscribe) unsubscribe();
      window.clearInterval(pollId);
    };
  }, [userId, activeRequest]);

  const handleConfirmExport = useCallback(async (): Promise<void> => {
    setSubmitting(true);
    try {
      const requestId = await requestDsarExport();
      // Build a synthetic pending row immediately so the status card renders
      // without waiting for the refresh round-trip.
      const synthetic: DsarRequestRow = {
        id: requestId,
        user_id: userId ?? '',
        requested_at: new Date().toISOString(),
        completed_at: null,
        status: 'pending',
        rejection_reason: null,
        export_path: null,
        export_signed_url_expires_at: null,
      };
      setActiveRequest(synthetic);
      setConfirmOpen(false);
      toast("Export started. We'll email you when it's ready.", 'success');
      // Reconcile from the server (catches the audit_logs row + canonical
      // requested_at timestamp).
      void refresh();
    } catch (e) {
      const err = e instanceof DsarError ? e : new DsarError('unknown');
      if (err.code === 'already_pending') {
        toast("You already have an active export. We'll email you when it's ready.", 'info');
        void refresh();
        setConfirmOpen(false);
      } else {
        toast("Couldn't start your export. Try again or contact support.", 'error');
      }
    } finally {
      setSubmitting(false);
    }
  }, [refresh, toast, userId]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 space-y-6">
      {/* Hero card */}
      <Card padding="lg">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="size-10 rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)] inline-flex items-center justify-center">
              <ShieldCheck className="size-5" aria-hidden />
            </span>
            <h1 className="text-2xl font-bold tracking-tight">Your data</h1>
            <Badge tone="neutral">30-day SLA</Badge>
          </div>
          <p className="text-base text-[var(--color-text-secondary)] leading-relaxed">
            You have the right to request a copy of all the data we hold about you. We&apos;ll
            prepare a download bundle including your injections, photos, weight logs, AI history,
            billing records, sharing history, and consent records. Some shared data (your
            doctor&apos;s notes, other clinic members&apos; records) is excluded.
          </p>
          <Button
            variant="primary"
            onClick={() => setConfirmOpen(true)}
            disabled={
              activeRequest?.status === 'pending' || activeRequest?.status === 'in_progress'
            }
          >
            Export my data
          </Button>
        </div>
      </Card>

      {/* Active request status */}
      {activeRequest && <DsarStatusCard request={activeRequest} downloadUrl={downloadUrl} />}

      {/* History */}
      {!loadingHistory && history.length > 0 && (
        <Card padding="md">
          <h2 className="text-[16px] font-semibold mb-3">Previous exports</h2>
          <ul className="space-y-2">
            {history.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between text-[13px]"
                data-testid="dsar-history-row"
              >
                <span className="text-[var(--color-text-secondary)]">
                  {new Date(row.requested_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                <span className="text-[var(--color-text-tertiary)]">
                  {STATUS_LABEL_MAP[row.status]}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Confirmation modal */}
      <Modal
        open={confirmOpen}
        onClose={() => {
          if (!submitting) setConfirmOpen(false);
        }}
        title="Start your data export?"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
            We&apos;ll prepare your data and email you when it&apos;s ready — typically within 24
            hours, up to 30 days. You can request another export later.
          </p>
          <div className="flex gap-2 justify-end">
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
            >
              Not now
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              onClick={() => {
                void handleConfirmExport();
              }}
            >
              Start export
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
