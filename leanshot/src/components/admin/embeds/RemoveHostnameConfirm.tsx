/**
 * Phase 41 Plan 41-06 — RemoveHostnameConfirm.
 *
 * DSv2 Modal-based confirm dialog with two body variants by reference count
 * per UI-SPEC §Surface E + §Copywriting Contract.
 *
 * 0 references → safe-to-remove copy, neutral.
 * ≥1 references → in-use warning with --color-danger-soft banner.
 *
 * Calls `removeHostname` from `@/lib/admin/iframe-allowlist` (Plan 41-02
 * wrapper). On success, surfaces a useToast success message + closes.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import { removeHostname } from '@/lib/admin/iframe-allowlist';
import { supabase } from '@/lib/supabase';

export interface RemoveHostnameConfirmProps {
  open: boolean;
  hostname: string;
  hostnameId: string;
  /**
   * Binary in-use signal. WR-04 fix (41-REVIEW.md): the previous
   * `referenceCount: number` prop always received 0 or 1 because the
   * upstream synthesized it from `last_used_at IS NULL` — making the
   * "{N} pages currently embed this hostname" copy lie about cardinality.
   * Until v1.4 ships a full JSONB scan, we surface only the boolean.
   */
  inUse: boolean;
  onClose: () => void;
  onRemoved: () => void;
}

export function RemoveHostnameConfirm({
  open,
  hostname,
  hostnameId,
  inUse,
  onClose,
  onRemoved,
}: RemoveHostnameConfirmProps) {
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const title = `Remove ${hostname} from allowlist?`;
  const unused = !inUse;

  async function handleConfirm(): Promise<void> {
    setSubmitting(true);
    try {
      await removeHostname(supabase, hostnameId);
      toast(`Removed ${hostname} from allowlist`, 'success');
      onRemoved();
      onClose();
    } catch (err) {
      const e = err as { message?: string };
      toast(e?.message ?? 'Failed to remove hostname', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" hideClose>
      {unused ? (
        <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
          This hostname is not in use on any page. Removing it stops future embeds —
          existing pages are unaffected because no page references it.
        </p>
      ) : (
        <div
          className="rounded-lg p-4 text-[14px] leading-relaxed"
          style={{
            backgroundColor: 'var(--color-danger-soft)',
            color: 'var(--color-text)',
          }}
        >
          This hostname is currently in use on at least one page. Removing it
          will break those embeds — visitors will see a &lsquo;Hostname not on
          allowlist&rsquo; error on those pages. Confirm only if you have already
          updated those pages. (Exact reference count ships in v1.4.)
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
          Keep on allowlist
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleConfirm}
          loading={submitting}
          disabled={submitting}
        >
          Remove hostname
        </Button>
      </div>
    </Modal>
  );
}
