/**
 * Phase 8 Plan 08-03 — Settings → Active shares section.
 *
 * Patient-facing surface for SHARE-01 (create share) + SHARE-05 (audit log).
 * Wires into SettingsPage NAV between Privacy and Recovery; renders empty
 * state, populated list, and a typed-confirm revoke modal that mirrors
 * Phase 7's DeleteAccountModal exactly.
 *
 * Phase 6 D-12 / Phase 7 D-06 compliance: never uses non-null-assertions
 * on the store user selector — the component reads `useStore((s) => s.user)`
 * nullable and early-returns when the user is logged out so RoH order
 * stays intact across render.
 *
 * Compliance grep (Phase 2 SC#5 carry-forward): this file must NOT contain
 * any of the CMIA-trigger terms enumerated in 08-03-PLAN <behavior> (the
 * literal terms are deliberately omitted from this comment so the
 * compliance gate stays green; see 08-03-PLAN behavior 11 + 08-UI-SPEC).
 */

import { Link2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/hooks/useToast';
import { listActiveShares, revokeShare, type ShareWithStats } from '@/lib/shares';
import { useStore } from '@/lib/store';
import { CreateShareModal } from './CreateShareModal';

/**
 * Human-readable relative time. Lightweight implementation — we deliberately
 * skip a date-fns dependency to keep the settings chunk small (Phase 5 D-19).
 */
function relTime(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = then - now;
  const abs = Math.abs(diffMs);
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (abs < min) return diffMs >= 0 ? 'in <1m' : 'just now';
  if (abs < hr) {
    const m = Math.round(abs / min);
    return diffMs >= 0 ? `in ${m}m` : `${m}m ago`;
  }
  if (abs < day) {
    const h = Math.round(abs / hr);
    return diffMs >= 0 ? `in ${h}h` : `${h}h ago`;
  }
  const d = Math.round(abs / day);
  return diffMs >= 0 ? `in ${d}d` : `${d}d ago`;
}

function expiryPillCopy(expiresAt: string): { label: string; warning: boolean } {
  const ms = new Date(expiresAt).getTime() - Date.now();
  const fourHours = 4 * 60 * 60 * 1000;
  if (ms > 0 && ms < fourHours) {
    const h = Math.floor(ms / (60 * 60 * 1000));
    const m = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    return { label: `Expires ${h}h ${m}m`, warning: true };
  }
  return { label: 'Active', warning: false };
}

interface ShareRowProps {
  share: ShareWithStats;
  onRevoke: (share: ShareWithStats) => void;
}

function ShareRow({ share, onRevoke }: ShareRowProps) {
  const pill = expiryPillCopy(share.expires_at);
  return (
    <li className="p-4 rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] flex items-start gap-3">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-semibold text-[var(--color-text)] truncate">
            {share.label}
          </span>
          <Pill
            size="sm"
            active={!pill.warning}
            className={
              pill.warning
                ? 'bg-[var(--color-warning-soft,var(--color-surface-elevated))] border-[var(--color-warning)] text-[var(--color-warning)]'
                : ''
            }
            aria-label={`Status: ${pill.label}`}
            disabled
          >
            {pill.label}
          </Pill>
        </div>
        <p className="text-[12px] text-[var(--color-text-secondary)] numerals-tabular">
          Expires {relTime(share.expires_at)} · Viewed{' '}
          <span className="numerals-tabular font-semibold">{share.view_count}</span>{' '}
          {share.view_count === 1 ? 'time' : 'times'} · Last viewed{' '}
          {relTime(share.last_viewed_at)}
        </p>
        {(share.recipient_ua_families.length > 0 ||
          share.recipient_ip_families.length > 0) && (
          <p className="text-[11px] text-[var(--color-text-tertiary)]">
            {share.recipient_ua_families.join(', ') || '—'}
            {share.recipient_ip_families.length > 0
              ? ` · ${share.recipient_ip_families.join(', ')}`
              : ''}
          </p>
        )}
      </div>
      <IconButton
        aria-label={`Revoke share for ${share.label}`}
        size="md"
        onClick={() => onRevoke(share)}
        className="shrink-0 text-[var(--color-danger)]"
      >
        <Trash2 className="size-4" />
      </IconButton>
    </li>
  );
}

interface RevokeConfirmModalProps {
  share: ShareWithStats | null;
  onClose: () => void;
  onConfirm: (share: ShareWithStats) => Promise<void>;
}

function RevokeConfirmModal({ share, onClose, onConfirm }: RevokeConfirmModalProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!share) {
      setTyped('');
      setBusy(false);
    }
  }, [share]);

  if (!share) return null;

  // Lowercase comparison — matches Phase 7 DeleteAccountModal pattern.
  const canConfirm = typed.trim().toLowerCase() === share.label.toLowerCase() && !busy;

  const close = (): void => {
    if (busy) return;
    onClose();
  };

  return (
    <Modal open={Boolean(share)} onClose={close} title="Revoke this share?" size="md">
      <div className="space-y-4">
        <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
          The doctor&apos;s open page will return an error within seconds and the share link
          will stop working. This cannot be undone, but you can always create a new share.
        </p>
        <Input
          label={`Type ${share.label} to revoke`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
          placeholder={share.label}
          disabled={busy}
        />
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={close} disabled={busy}>
            Keep share
          </Button>
          <Button
            variant="destructive"
            leadingIcon={<Trash2 className="size-4" />}
            disabled={!canConfirm}
            loading={busy}
            onClick={() => {
              if (!canConfirm) return;
              setBusy(true);
              void onConfirm(share).finally(() => setBusy(false));
            }}
          >
            Revoke share
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function ActiveSharesSection(): React.ReactElement | null {
  // Phase 6 D-12 / Phase 7 D-06: nullable selector + RoH-safe early return.
  const user = useStore((s) => s.user);
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [shares, setShares] = useState<ShareWithStats[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ShareWithStats | null>(null);

  // `useToast` returns a freshly-allocated closure on every render. Stash it in
  // a ref so the `refetch` identity stays stable across renders — otherwise
  // the `useEffect([refetch])` re-fires on every render and the share list
  // bounces between the initial fetch and the post-revoke refetch (verified
  // empirically against the GREEN test suite).
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listActiveShares();
      setShares(Array.isArray(rows) ? rows : []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      toastRef.current(`Couldn't load shares: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (!user) return null;

  const handleRevoke = async (share: ShareWithStats): Promise<void> => {
    // Optimistic remove.
    const previous = shares;
    setShares((rows) => rows.filter((r) => r.id !== share.id));
    setRevokeTarget(null);
    try {
      await revokeShare(share.id);
      toastRef.current(`Share revoked. Doctor's page is now disabled.`, 'success');
      // Reconcile with server state (drops any other expired shares too).
      void refetch();
    } catch {
      // Rollback the optimistic remove.
      setShares(previous);
      toastRef.current(`Couldn't revoke. Check your connection and try again.`, 'error');
    }
  };

  const empty = !loading && shares.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h2 className="text-[18px] font-bold tracking-tight">Active shares</h2>
          <p className="text-[13px] text-[var(--color-text-secondary)] max-w-[60ch] leading-snug">
            Generate a time-bound link plus a 6-digit code so a doctor can review your data
            in their browser. AI coach conversations are never included. Revoke any time —
            the doctor&apos;s open page becomes unusable within seconds.
          </p>
        </div>
        {!empty && (
          <Button
            leadingIcon={<Link2 className="size-4" />}
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            Create share link
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2" role="status" aria-live="polite" aria-busy>
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : empty ? (
        <Card variant="flat">
          <EmptyState
            inline
            title="No active shares"
            body="When you share your data with a doctor, the link and code will appear here so you can revoke it later."
            cta={
              <Button
                leadingIcon={<Link2 className="size-4" />}
                onClick={() => setCreateOpen(true)}
              >
                Create share link
              </Button>
            }
          />
        </Card>
      ) : (
        <ul className="space-y-2 list-none p-0">
          {shares.map((s) => (
            <ShareRow key={s.id} share={s} onRevoke={setRevokeTarget} />
          ))}
        </ul>
      )}

      <CreateShareModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          // Refresh the list so the new share row appears. We deliberately
          // do NOT prepend an optimistic synthetic row — `listActiveShares`
          // is fast (<200ms typical) and the modal lingers in success state
          // until the patient clicks Done, so there's no visual gap.
          void refetch();
        }}
      />

      <RevokeConfirmModal
        share={revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevoke}
      />
    </div>
  );
}
