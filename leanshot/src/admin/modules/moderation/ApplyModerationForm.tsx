/**
 * Phase 48 Plan 48-10 — ApplyModerationForm sub-view.
 *
 * Modal-style form that calls apply_user_moderation SECDEF RPC. The RPC
 * (migration 20270901000006) handles enforcement Fn invocation server-side
 * via pg_net for status='banned' (T-48-13 mitigation), so this client only
 * submits the row mutation.
 *
 * Field contract:
 *   - status        : enum (active | muted | banned | temp_suspended)
 *   - reason        : required text
 *   - expires_at    : ISO timestamp; REQUIRED iff status='temp_suspended',
 *                     otherwise sent as null (CHECK constraint enforces this).
 */
import { useState } from 'react';
import { useStore } from '@/lib/store';
import type { ModerationStatus } from '@/lib/moderation/types';
import { applyUserModeration } from './api';

const STATUSES: ReadonlyArray<{ value: ModerationStatus; label: string }> = [
  { value: 'active', label: 'Active (lift restriction)' },
  { value: 'muted', label: 'Muted' },
  { value: 'temp_suspended', label: 'Temp suspended' },
  { value: 'banned', label: 'Banned' },
];

const REASON_MAX = 500;

interface ApplyModerationFormProps {
  userId: string;
}

export function ApplyModerationForm({ userId }: ApplyModerationFormProps) {
  const showToast = useStore((s) => s.showToast);
  const [status, setStatus] = useState<ModerationStatus>('muted');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsExpires = status === 'temp_suspended';

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError('Reason is required.');
      return;
    }
    if (needsExpires && !expiresAt) {
      setError('Expires-at is required for temp_suspended.');
      return;
    }

    setSubmitting(true);
    try {
      await applyUserModeration({
        userId,
        status,
        reason: trimmedReason,
        expiresAt: needsExpires ? new Date(expiresAt).toISOString() : null,
      });
      showToast(`Moderation applied: ${status}`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Apply failed';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="max-w-lg space-y-4 rounded-md border border-[var(--color-border)] p-4"
    >
      <h2 className="text-base font-semibold">Apply moderation</h2>
      <p className="text-xs text-[var(--color-text-secondary)]">
        User ID: <span className="font-mono">{userId}</span>
      </p>

      <label className="flex flex-col text-xs text-[var(--color-text-secondary)]">
        Status
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ModerationStatus)}
          className="mt-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-sm"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      {needsExpires && (
        <label className="flex flex-col text-xs text-[var(--color-text-secondary)]">
          Expires at
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            required
            className="mt-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-sm"
          />
        </label>
      )}

      <label className="flex flex-col text-xs text-[var(--color-text-secondary)]">
        Reason
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
          required
          rows={4}
          maxLength={REASON_MAX}
          className="mt-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-sm"
        />
        <span className="mt-1 text-right text-xs text-[var(--color-text-secondary)]">
          {reason.length}/{REASON_MAX}
        </span>
      </label>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-300"
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex h-9 items-center rounded-full bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-primary-foreground)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-50"
      >
        {submitting ? 'Applying…' : 'Apply moderation'}
      </button>
    </form>
  );
}

export default ApplyModerationForm;
