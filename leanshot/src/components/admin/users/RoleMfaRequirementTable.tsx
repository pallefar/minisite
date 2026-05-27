/**
 * Phase 66 Plan 66-06 (AUTH-17) — Per-role MFA requirement editor.
 *
 * Route: /admin/users/security (registered via ADMIN_MODULES key 'users-security').
 *
 * Surface contract:
 *   - Table with 5 seeded rows (superadmin, admin, staff, clinic-admin, user)
 *     pulled from `mfa_role_requirements` (Phase 66-01 schema).
 *   - Required column is a checkbox. Toggling calls set_mfa_role_requirement
 *     SECDEF RPC (superadmin-only at DB layer).
 *   - Optimistic update + rollback on error (Pattern S1 dual-layer; UI also
 *     greys the checkbox out for non-superadmin viewers).
 *   - Since column renders the most-recent toggle timestamp.
 *
 * Token contract (Phase 66 known_lessons #3): only @theme tokens defined in
 * src/index.css. text-text-muted is NOT defined; we fall back to
 * --color-text-tertiary for the off/inactive surfaces. Typography ceiling
 * 11/13/18/text-heading + weights 400/600 (Phase 65 UI-checker rules).
 */
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { supabase } from '@/lib/supabase';
import type { AdminRole } from '@/lib/admin/roles';
import {
  listRoleMfaRequirements,
  setRoleMfaRequirement,
  type RoleMfaRequirement,
} from '@/lib/admin/role-mfa-config';

interface ProfileRow {
  admin_role?: AdminRole | null;
}

function formatSince(iso: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toISOString().slice(0, 10);
  } catch {
    return '—';
  }
}

export function RoleMfaRequirementTable() {
  const [rows, setRows] = useState<RoleMfaRequirement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSuperadmin, setIsSuperadmin] = useState<boolean | undefined>(
    undefined,
  );
  const [pendingRole, setPendingRole] = useState<string | null>(null);

  // Probe current admin role for the Pattern S1 UX gate. RPC re-checks
  // server-side; this just decides whether to grey out the checkbox.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) {
        if (!cancelled) setIsSuperadmin(false);
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('admin_role')
        .eq('id', uid)
        .maybeSingle();
      const p = profile as ProfileRow | null;
      if (cancelled) return;
      setIsSuperadmin(p?.admin_role === 'superadmin');
    })().catch(() => {
      if (!cancelled) setIsSuperadmin(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Initial fetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await listRoleMfaRequirements();
        if (!cancelled) setRows(r);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : 'Failed to load role requirements',
          );
          setRows([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onToggle = useCallback(
    async (role: string, next: boolean) => {
      if (!rows) return;
      // Optimistic update.
      const prev = rows;
      const optimistic = rows.map((r) =>
        r.role === role
          ? { ...r, required: next, since: new Date().toISOString() }
          : r,
      );
      setRows(optimistic);
      setPendingRole(role);
      setError(null);
      try {
        await setRoleMfaRequirement(role, next);
      } catch (e) {
        // Rollback.
        setRows(prev);
        setError(
          e instanceof Error
            ? e.message
            : 'Failed to update MFA requirement',
        );
      } finally {
        setPendingRole(null);
      }
    },
    [rows],
  );

  const canMutate = isSuperadmin === true;

  return (
    <main
      className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6"
      aria-labelledby="role-mfa-requirements-heading"
    >
      <header className="mb-6">
        <h1
          id="role-mfa-requirements-heading"
          className="text-[18px] font-semibold tracking-tight"
        >
          Role MFA requirements
        </h1>
        <p className="text-[13px] text-[var(--color-text-secondary)] mt-1">
          Toggle which roles must enable multi-factor authentication. Only
          superadmins can mutate; the RPC re-checks server-side.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--color-warning)] px-3 py-2 text-[13px]"
        >
          {error}
        </div>
      )}

      <Card variant="flat" padding="none">
        {rows === null ? (
          <div className="p-6 text-[13px] text-[var(--color-text-secondary)]">
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No role requirements configured"
            body="The mfa_role_requirements table is empty."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left" aria-label="Role MFA requirements">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th
                    scope="col"
                    className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]"
                  >
                    Role
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]"
                  >
                    Required
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]"
                  >
                    Since
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const checkboxId = `mfa-req-${r.role}`;
                  const disabled = !canMutate || pendingRole === r.role;
                  return (
                    <tr
                      key={r.role}
                      className="border-b border-[var(--color-border)] last:border-0"
                    >
                      <td className="px-4 py-3 text-[13px] font-semibold">
                        {r.role}
                      </td>
                      <td className="px-4 py-3">
                        <label
                          htmlFor={checkboxId}
                          className="inline-flex items-center gap-2 text-[13px] cursor-pointer"
                        >
                          <input
                            id={checkboxId}
                            type="checkbox"
                            checked={r.required}
                            disabled={disabled}
                            aria-label={`MFA required for ${r.role}`}
                            onChange={(e) => {
                              void onToggle(r.role, e.target.checked);
                            }}
                            className="h-4 w-4 rounded border-[var(--color-border)] disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                          <span
                            className={
                              r.required
                                ? 'text-[var(--color-success)] font-semibold'
                                : 'text-[var(--color-text-tertiary)]'
                            }
                          >
                            {r.required ? 'Required' : 'Off'}
                          </span>
                        </label>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-[var(--color-text-secondary)]">
                        {formatSince(r.since)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {isSuperadmin === false && (
        <p className="mt-4 text-[11px] text-[var(--color-text-tertiary)]">
          You are viewing this read-only. Toggling MFA requirements requires
          superadmin role.
        </p>
      )}
    </main>
  );
}

export default RoleMfaRequirementTable;
