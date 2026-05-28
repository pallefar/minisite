/**
 * Phase 15 Plan 09 — VersionHistoryPanel (D-07).
 *
 * Surface for browsing the append-only `landing_page_revisions` list +
 * restoring a prior revision. The D-07 invariant — "restore re-points
 * the pointer; the revision row is NEVER mutated" — is enforced by
 * routing restore through the page-publish Edge Function (15-04). This
 * component therefore does NOT issue any UPDATE/DELETE against
 * landing_page_revisions; it POSTs `{ pageId, revisionId }` to
 * `page-publish`, which atomically re-points
 * `landing_pages.published_revision_id`.
 *
 * Restore-with-confirm:
 *   • Clicking the row's "Restore" sets a `confirmRevisionId` and opens a
 *     confirmation Modal — the network call only fires on the Modal's
 *     own "Restore" button (UI-SPEC copy).
 *
 * Invariant guard (T-15-09-04): the panel only ever submits a revisionId
 * drawn from this page's own `revisions` prop. The page-publish function
 * additionally re-verifies `revision.page_id === pageId` server-side (15-04
 * owns that check) — defence in depth against a forged revisionId.
 *
 * `restoreFn` is the injectable seam for tests; production code defaults
 * to the real `supabase.functions.invoke('page-publish', ...)` POST.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Sheet } from '@/components/ui/Sheet';
import { supabase } from '@/lib/supabase';

export interface VersionHistoryRevision {
  id: string;
  created_at: string;
  created_by_email: string;
}

export interface RestoreArgs {
  pageId: string;
  revisionId: string;
}

export interface VersionHistoryPanelProps {
  open: boolean;
  onClose: () => void;
  pageId: string;
  revisions: VersionHistoryRevision[];
  /** Called after a successful restore (UI may refresh state). */
  onRestored?: () => void;
  /**
   * Injectable seam for tests. Defaults to the page-publish Edge Function
   * POST. Production code never passes this.
   */
  restoreFn?: (args: RestoreArgs) => Promise<void>;
}

/**
 * Default restore implementation — POST {pageId, revisionId} to
 * page-publish. supabase-js attaches the user's session JWT automatically
 * (matches the 15-04 page-api.ts pattern).
 */
async function defaultRestoreFn(args: RestoreArgs): Promise<void> {
  const { error } = await supabase.functions.invoke('page-publish', {
    body: { pageId: args.pageId, revisionId: args.revisionId },
  });
  if (error) {
    throw new Error(error.message ?? 'restore_failed');
  }
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function VersionHistoryPanel({
  open,
  onClose,
  pageId,
  revisions,
  onRestored,
  restoreFn = defaultRestoreFn,
}: VersionHistoryPanelProps) {
  const [confirmRevisionId, setConfirmRevisionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Sort newest-first. Pure computation — never mutates the prop.
  const sorted = useMemo(() => {
    return [...revisions].sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return tb - ta;
    });
  }, [revisions]);

  // Invariant guard (T-15-09-04): the confirm dialog can only fire against
  // an id that is currently in our own `revisions` prop. We capture that
  // set here so a stale state value cannot leak through.
  const allowedIds = useMemo(() => new Set(revisions.map((r) => r.id)), [revisions]);

  async function handleConfirm(): Promise<void> {
    if (!confirmRevisionId) return;
    if (!allowedIds.has(confirmRevisionId)) {
      // Should be unreachable given the click handlers, but the guard is
      // the explicit project invariant — never trust a free-floating id.
      setConfirmRevisionId(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await restoreFn({ pageId, revisionId: confirmRevisionId });
      setStatus('Restored');
      setConfirmRevisionId(null);
      onRestored?.();
    } catch {
      setError("Couldn't restore this version. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Version history">
        {sorted.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            No saved versions yet. Changes are saved automatically.
          </p>
        ) : (
          <ul className="flex flex-col gap-0">
            {sorted.map((rev) => (
              <li
                key={rev.id}
                className="flex items-center justify-between gap-3 py-3 border-b border-[var(--color-border)] last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold font-mono truncate">
                    {formatTimestamp(rev.created_at)}
                  </p>
                  <p className="text-[13px] text-[var(--color-text-secondary)] truncate">
                    {rev.created_by_email}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setStatus(null);
                    setConfirmRevisionId(rev.id);
                  }}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
        {status && (
          <p
            role="status"
            aria-live="polite"
            className="text-[13px] mt-3 text-[var(--color-success)]"
          >
            {status}
          </p>
        )}
      </Sheet>

      <Modal
        open={confirmRevisionId !== null}
        onClose={() => (busy ? undefined : setConfirmRevisionId(null))}
        title="Restore this version?"
        size="sm"
        hideClose
        dismissible={!busy}
      >
        <p className="text-[14px] text-[var(--color-text-secondary)] mb-4">
          The page will revert to this revision. Any unpublished changes will be preserved in
          history.
        </p>
        {error && (
          <p role="alert" className="text-[13px] text-[var(--color-danger)] mb-3">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmRevisionId(null)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleConfirm()}
            loading={busy}
            aria-busy={busy || undefined}
          >
            Restore
          </Button>
        </div>
      </Modal>
    </>
  );
}
