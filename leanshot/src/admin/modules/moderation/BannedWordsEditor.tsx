/**
 * Phase 48 Plan 48-10 — BannedWordsEditor sub-view.
 *
 * CRUD over public.banned_words via SECDEF RPCs (banned_word_upsert /
 * banned_word_remove). Inline form for add/edit; row delete with confirm.
 *
 * "Re-run sweep" button invokes the banned-words-sweep Edge Fn in a loop
 * over both community_posts and community_comments tables until each
 * returns next_cursor=null. Progress is reported per batch into the status
 * region beneath the button.
 */
import { useCallback, useEffect, useState } from 'react';
import type { BanSeverity, BannedWord } from '@/lib/moderation/types';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { bannedWordRemove, bannedWordUpsert, invokeBannedWordsSweep } from './api';

const SEVERITIES: ReadonlyArray<BanSeverity> = ['warn', 'flag', 'escalate'];

function severityClass(s: BanSeverity): string {
  switch (s) {
    case 'warn':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
    case 'flag':
      return 'bg-orange-500/15 text-orange-700 dark:text-orange-300';
    case 'escalate':
      return 'bg-rose-500/15 text-rose-700 dark:text-rose-300';
  }
}

export function BannedWordsEditor() {
  const showToast = useStore((s) => s.showToast);
  const [rows, setRows] = useState<BannedWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftWord, setDraftWord] = useState('');
  const [draftSeverity, setDraftSeverity] = useState<BanSeverity>('flag');
  const [submitting, setSubmitting] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [sweepProgress, setSweepProgress] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    const { data, error } = await supabase
      .from('banned_words')
      .select('id, word, severity, case_insensitive, created_by, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      showToast(error.message, 'error');
      setRows([]);
    } else {
      setRows((data ?? []) as BannedWord[]);
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = (): void => {
    setEditingId(null);
    setDraftWord('');
    setDraftSeverity('flag');
  };

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const trimmed = draftWord.trim();
    if (!trimmed) {
      showToast('Word is required.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await bannedWordUpsert(trimmed, draftSeverity);
      showToast(editingId ? 'Banned word updated.' : 'Banned word added.', 'success');
      resetForm();
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const onEdit = (row: BannedWord): void => {
    setEditingId(row.id);
    setDraftWord(row.word);
    setDraftSeverity(row.severity);
  };

  const onRemove = async (row: BannedWord): Promise<void> => {
    if (!window.confirm(`Remove "${row.word}" from banned words?`)) return;
    try {
      await bannedWordRemove(row.id);
      showToast('Banned word removed.', 'success');
      if (editingId === row.id) resetForm();
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      showToast(msg, 'error');
    }
  };

  const runSweep = async (): Promise<void> => {
    setSweeping(true);
    setSweepProgress('Starting sweep…');
    try {
      let totalProcessed = 0;
      let totalMatches = 0;
      for (const table of ['community_posts', 'community_comments'] as const) {
        let cursor: string | null = null;
        do {
          const batch = await invokeBannedWordsSweep(table, cursor);
          totalProcessed += batch.processed;
          totalMatches += batch.matches;
          cursor = batch.next_cursor;
          setSweepProgress(
            `Swept ${totalProcessed} rows · ${totalMatches} matches (current: ${table})`,
          );
        } while (cursor !== null);
      }
      setSweepProgress(`Sweep complete · ${totalProcessed} rows scanned · ${totalMatches} matches`);
      showToast('Sweep complete.', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sweep failed';
      showToast(msg, 'error');
      setSweepProgress(`Sweep aborted: ${msg}`);
    } finally {
      setSweeping(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Banned words</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={sweeping}
            onClick={() => void runSweep()}
            className="inline-flex h-8 items-center rounded-full bg-[var(--color-surface-elevated)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-50"
          >
            {sweeping ? 'Sweeping…' : 'Re-run sweep'}
          </button>
        </div>
      </header>

      {sweepProgress && (
        <p role="status" aria-live="polite" className="text-xs text-[var(--color-text-secondary)]">
          {sweepProgress}
        </p>
      )}

      <form
        onSubmit={onSubmit}
        className="space-y-3 rounded-md border border-[var(--color-border)] p-4"
      >
        <h3 className="text-sm font-semibold">
          {editingId ? 'Edit banned word' : 'Add banned word'}
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs text-[var(--color-text-secondary)]">
            Word
            <input
              type="text"
              required
              value={draftWord}
              onChange={(e) => setDraftWord(e.target.value)}
              className="mt-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col text-xs text-[var(--color-text-secondary)]">
            Severity
            <select
              value={draftSeverity}
              onChange={(e) => setDraftSeverity(e.target.value as BanSeverity)}
              className="mt-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-sm"
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-8 items-center rounded-full bg-[var(--color-primary)] px-4 text-xs font-semibold text-[var(--color-primary-foreground)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-50"
          >
            {submitting ? 'Saving…' : editingId ? 'Update' : 'Add'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="text-xs text-[var(--color-text-secondary)] hover:underline focus-visible:outline-none"
            >
              Cancel edit
            </button>
          )}
        </div>
      </form>

      {loading && (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading banned words…</p>
      )}

      {!loading && rows.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No banned words configured yet.
        </p>
      )}

      {!loading && rows.length > 0 && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="py-2 text-start font-medium text-[var(--color-text-secondary)]">
                Word
              </th>
              <th className="py-2 text-start font-medium text-[var(--color-text-secondary)]">
                Severity
              </th>
              <th className="py-2 text-start font-medium text-[var(--color-text-secondary)]">
                Added
              </th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-elevated)]"
              >
                <td className="py-2 font-mono">{row.word}</td>
                <td className="py-2">
                  <span
                    className={
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ' +
                      severityClass(row.severity)
                    }
                  >
                    {row.severity}
                  </span>
                </td>
                <td className="py-2 text-xs text-[var(--color-text-secondary)]">
                  {new Date(row.created_at).toLocaleDateString()}
                </td>
                <td className="py-2 text-end">
                  <div className="inline-flex gap-2">
                    <button
                      type="button"
                      onClick={() => onEdit(row)}
                      className="text-xs font-medium text-[var(--color-primary)] hover:underline focus-visible:outline-none"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void onRemove(row)}
                      className="text-xs font-medium text-rose-600 hover:underline focus-visible:outline-none"
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default BannedWordsEditor;
