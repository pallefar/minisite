/**
 * Phase 48 Plan 48-10 — UserBansRoster sub-view.
 *
 * Lists users with non-active moderation state (muted/banned/temp_suspended).
 * Data fetched via public.list_user_moderation_roster SECDEF RPC which JOINs
 * auth.users (email) + public.profiles (display_name, handle); profiles has
 * no email column (per memory reference_profiles_email_vs_auth_users_email).
 *
 * Row click → opens ApplyModerationForm at /admin/moderation/bans/:userId
 * (handled by ModerationLayout's resolveView dispatch).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UserModerationRosterRow } from '@/lib/moderation/types';
import { useStore } from '@/lib/store';
import { listUserModerationRoster } from './api';

interface UserBansRosterProps {
  onSelectUser: (userId: string) => void;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'banned':
      return 'bg-rose-500/15 text-rose-700 dark:text-rose-300';
    case 'temp_suspended':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
    case 'muted':
      return 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300';
    default:
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
  }
}

function relativeFromNow(iso: string | null): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  const past = ms < 0;
  const abs = Math.abs(ms);
  const min = Math.floor(abs / 60_000);
  if (min < 60) return past ? `${min}m ago` : `in ${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return past ? `${hr}h ago` : `in ${hr}h`;
  const day = Math.floor(hr / 24);
  return past ? `${day}d ago` : `in ${day}d`;
}

export function UserBansRoster({ onSelectUser }: UserBansRosterProps) {
  const showToast = useStore((s) => s.showToast);
  const [rows, setRows] = useState<UserModerationRosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const data = await listUserModerationRoster(debouncedSearch || null);
      setRows(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Load failed';
      showToast(msg, 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => rows.filter((r) => r.status !== 'active'),
    [rows],
  );

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold">User moderation</h2>
        <input
          type="search"
          placeholder="Search handle or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search user moderation roster"
          className="rounded border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm"
        />
      </header>

      {loading && (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading roster…</p>
      )}

      {!loading && filtered.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No users currently muted, banned, or temp-suspended.
        </p>
      )}

      {!loading && filtered.length > 0 && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">User</th>
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">Status</th>
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">Expires</th>
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">Reason</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.user_id}
                className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-elevated)]"
              >
                <td className="py-2">
                  <div className="font-medium">
                    {row.display_name ?? row.handle ?? '(no name)'}
                  </div>
                  <div className="text-xs text-[var(--color-text-secondary)]">
                    {row.email ?? row.user_id.slice(0, 8) + '…'}
                  </div>
                </td>
                <td className="py-2">
                  <span
                    className={
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ' +
                      statusBadgeClass(row.status)
                    }
                  >
                    {row.status}
                  </span>
                </td>
                <td className="py-2 text-xs text-[var(--color-text-secondary)]">
                  {row.status === 'temp_suspended' ? relativeFromNow(row.expires_at) : '—'}
                </td>
                <td className="py-2 text-xs text-[var(--color-text-secondary)]">
                  {row.reason ?? '—'}
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onSelectUser(row.user_id)}
                    className="text-xs font-medium text-[var(--color-primary)] hover:underline focus-visible:outline-none"
                  >
                    Apply / change
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default UserBansRoster;
