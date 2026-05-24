/**
 * Phase 45 Plan 45-08 — AdminCliniciansPage.
 *
 * Staff-only surface at /admin/community/profiles. Lists profiles with a
 * verified-clinician toggle that routes through the admin_set_clinician_verified
 * SECDEF RPC (is_staff() guard inside the function body — migration
 * supabase/migrations/20270727000003_p45_secdef_rpcs.sql).
 *
 * Security:
 *   - UX layer: AdminShell minRole='staff' gates module visibility (modules.ts).
 *   - DB layer: admin_set_clinician_verified RPC SECDEF + is_staff() guard
 *     (Pattern S1 dual-layer). UI MUST NOT bypass with direct profiles.update.
 *
 * Implementation notes:
 *   - Profile list is fetched with a basic select() — RLS on profiles allows
 *     staff to read via is_staff()-based policies; non-staff would see only
 *     their own row. The plan accepts simple ad-hoc paging for v1 (limit 100).
 *   - Optimistic local update on toggle; on RPC error we revert and toast.
 */
import { useCallback, useEffect, useState } from 'react';

import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

interface ProfileRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  is_clinician_verified: boolean;
}

export function AdminCliniciansPage() {
  const toast = useToast();

  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Fetch profiles. Debounced ad-hoc search on handle/display_name.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      let q = supabase
        .from('profiles')
        .select('id, handle, display_name, is_clinician_verified')
        .order('handle', { ascending: true, nullsFirst: false })
        .limit(100);

      const trimmed = search.trim();
      if (trimmed.length >= 2) {
        // ilike OR across handle + display_name. PostgREST `or` filter syntax.
        const escaped = trimmed.replace(/[%_,()]/g, '');
        q = q.or(`handle.ilike.%${escaped}%,display_name.ilike.%${escaped}%`);
      }

      const { data, error } = await q;
      if (cancelled) return;

      if (error) {
        toast(`Failed to load profiles: ${error.message}`, 'error');
        setRows([]);
      } else {
        setRows((data ?? []) as ProfileRow[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [search, toast]);

  const handleToggle = useCallback(
    async (row: ProfileRow) => {
      if (busyId) return;
      const nextValue = !row.is_clinician_verified;
      setBusyId(row.id);

      // Optimistic local update.
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id ? { ...r, is_clinician_verified: nextValue } : r,
        ),
      );

      const { error } = await supabase.rpc('admin_set_clinician_verified', {
        p_user_id: row.id,
        p_verified: nextValue,
      });

      if (error) {
        // Revert.
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id
              ? { ...r, is_clinician_verified: row.is_clinician_verified }
              : r,
          ),
        );
        toast(`Failed to update verified status: ${error.message}`, 'error');
      } else {
        toast(
          nextValue
            ? 'Clinician verified badge granted.'
            : 'Clinician verified badge revoked.',
          'success',
        );
      }
      setBusyId(null);
    },
    [busyId, toast],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">Clinician verification</h2>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            Grant or revoke the verified-clinician badge. Verified clinicians
            bypass DM rate limits and surface a badge on their public profile.
          </p>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search handle or name…"
          aria-label="Search profiles"
          className="h-8 w-60 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        />
      </div>

      {loading && (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading profiles…</p>
      )}

      {!loading && rows.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No profiles match the current search.
        </p>
      )}

      {!loading && rows.length > 0 && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Handle
              </th>
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Name
              </th>
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Verified
              </th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const verified = row.is_clinician_verified;
              const isBusy = busyId === row.id;
              return (
                <tr
                  key={row.id}
                  className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-elevated)]"
                >
                  <td className="py-2 font-mono text-xs">
                    {row.handle ? `@${row.handle}` : '—'}
                  </td>
                  <td className="py-2">{row.display_name ?? '—'}</td>
                  <td className="py-2">
                    <span
                      className={
                        verified
                          ? 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-[var(--color-success-soft)] text-[var(--color-success)]'
                          : 'inline-flex items-center rounded-full px-2 py-0.5 text-xs text-[var(--color-text-secondary)]'
                      }
                    >
                      {verified ? 'Verified' : 'Unverified'}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void handleToggle(row)}
                      disabled={isBusy}
                      aria-pressed={verified}
                      aria-label={
                        verified
                          ? `Revoke verified badge from ${row.handle ?? row.id}`
                          : `Grant verified badge to ${row.handle ?? row.id}`
                      }
                      aria-busy={isBusy}
                      className="inline-flex h-7 items-center rounded-full border border-[var(--color-border)] px-3 text-xs font-medium hover:bg-[var(--color-surface-elevated)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                    >
                      {isBusy ? '…' : verified ? 'Revoke' : 'Verify'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
