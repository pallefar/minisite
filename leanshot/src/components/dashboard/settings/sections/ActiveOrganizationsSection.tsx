/**
 * Phase 9 Plan 09-05 — Settings → Active organizations section.
 *
 * Patient-facing surface for D-15 ("Active organizations" tab is the canonical
 * post-acceptance scope-edit + revoke affordance) and CLINIC-03 (consent-edit
 * + revoke usable post-acceptance). Mirrors Phase 8's `ActiveSharesSection`
 * pattern: empty state, populated list, typed-confirm revoke modal, refetch
 * after mutation, Realtime cross-context broadcast.
 *
 * Overwrites the Plan 09-01 stub. Plan 09-01 already wired the SettingsPage
 * NAV entry (`'organizations'` between `'shares'` and `'recovery'`) + the
 * lazy section import — this file does NOT touch SettingsPage.tsx (B-2).
 *
 * Realtime: subscribes to `user:{user_id}` private channel via the Plan
 * 09-02 `subscribeToUserChannel` helper. Operator-side revokes (Plan 09-10
 * cross-context drill) and scope-edits broadcast to this channel and the
 * row updates without a manual refresh — D-10 Layer 1 verified end-to-end
 * from the patient direction.
 *
 * Audit (CLINIC-07): every Save and every Revoke writes a row to
 * `audit_logs` server-side via the SECURITY DEFINER RPCs in Plan 09-01.
 * The patient never inserts to `audit_logs` directly — that's how the
 * cross-tenant Plan 09-09 impersonation test catches missing capture.
 *
 * No `s.user!` non-null assertions anywhere in this file.
 */

import { Activity, Building2, Pencil, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/hooks/useToast';
import { revokeMembership } from '@/lib/clinic';
import { subscribeToUserChannel } from '@/lib/clinic-realtime';
import { supabase } from '@/lib/supabase';
import {
  DATA_TYPE_KEYS,
  DATA_TYPE_LABELS,
  type ConsentScope,
  type Membership,
  type Org,
  type Role,
} from '@/types/clinic';
import { EditConsentScopeModal, type MembershipWithOrg } from '../EditConsentScopeModal';
import { PatientActivityModal } from '../PatientActivityModal';

type Row = Membership & {
  orgs: Pick<Org, 'id' | 'name' | 'logo_storage_path'>;
  roles: Pick<Role, 'name'> | null;
};

interface RealtimePayload {
  eventType?: 'INSERT' | 'UPDATE' | 'DELETE';
  new?: Partial<Membership> & { id?: string };
  old?: Partial<Membership> & { id?: string };
}

interface RealtimeChannelLike {
  unsubscribe: () => void | Promise<void>;
}

/** Lightweight relative-time formatter (matches ActiveSharesSection.relTime). */
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

/**
 * Count canonical-key trues only (Pitfall #8 — extra keys on a drifted blob
 * must NOT inflate the share count, missing keys must NOT show as shared).
 */
function countEnabled(scope: Record<string, unknown> | null | undefined): number {
  if (!scope) return 0;
  return DATA_TYPE_KEYS.filter((k) => (scope as Record<string, unknown>)[k] === true).length;
}

function logoPublicUrl(path: string | null): string | null {
  if (!path) return null;
  try {
    const { data } = supabase.storage.from('org-logos').getPublicUrl(path);
    return data.publicUrl || null;
  } catch {
    return null;
  }
}

interface OrgRowProps {
  row: Row;
  onEdit: (row: Row) => void;
  onRevoke: (row: Row) => void;
  onViewActivity: (row: Row) => void;
  exiting: boolean;
}

function OrgRow({ row, onEdit, onRevoke, onViewActivity, exiting }: OrgRowProps) {
  const orgName = row.orgs.name;
  const role = row.roles?.name ?? 'Member';
  const enabled = countEnabled(row.consent_scope);
  const logo = logoPublicUrl(row.orgs.logo_storage_path);

  return (
    <li
      data-testid={`org-row-${row.id}`}
      data-exiting={exiting ? 'true' : 'false'}
      className={
        'p-4 rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] flex items-start gap-3 transition-[opacity,transform] duration-200 ' +
        (exiting ? 'opacity-0 -translate-x-2 pointer-events-none' : 'opacity-100')
      }
    >
      <div className="size-10 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center overflow-hidden shrink-0">
        {logo ? (
          <img
            src={logo}
            alt={orgName}
            className="size-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <Building2 className="size-5 text-[var(--color-text-secondary)]" aria-hidden />
        )}
      </div>

      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-semibold text-[var(--color-text)] truncate">
            {orgName}
          </span>
          <Pill size="sm" disabled aria-label={`Role: ${role}`}>
            {role}
          </Pill>
        </div>
        <p className="text-[12px] text-[var(--color-text-secondary)]">
          Joined {relTime(row.joined_at)} · Role: {role}
        </p>
        <p className="text-[12px] text-[var(--color-text-secondary)]">
          Sharing {enabled} of {DATA_TYPE_KEYS.length} data types
        </p>
      </div>

      <div className="flex flex-col gap-2 shrink-0">
        <IconButton
          aria-label={`View activity from ${orgName}`}
          size="md"
          onClick={() => onViewActivity(row)}
        >
          <Activity className="size-4" />
        </IconButton>
        <IconButton
          aria-label={`Edit what you share with ${orgName}`}
          size="md"
          onClick={() => onEdit(row)}
        >
          <Pencil className="size-4" />
        </IconButton>
        <IconButton
          aria-label={`Revoke membership with ${orgName}`}
          size="md"
          onClick={() => onRevoke(row)}
          className="text-[var(--color-danger)]"
        >
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    </li>
  );
}

interface RevokeConfirmModalProps {
  row: Row | null;
  onClose: () => void;
  onConfirm: (row: Row) => Promise<void>;
}

function RevokeConfirmModal({ row, onClose, onConfirm }: RevokeConfirmModalProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!row) {
      setTyped('');
      setBusy(false);
    }
  }, [row]);

  if (!row) return null;
  const orgName = row.orgs.name;
  const canConfirm = typed.trim().toLowerCase() === orgName.toLowerCase() && !busy;

  const close = () => {
    if (busy) return;
    onClose();
  };

  return (
    <Modal open onClose={close} title={`Revoke membership with ${orgName}?`} size="md">
      <div className="space-y-4">
        <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
          Your data will become invisible to {orgName} within seconds. This cannot be undone,
          but they can invite you again later.
        </p>
        <Input
          label={`Type ${orgName} to revoke`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
          placeholder={orgName}
          disabled={busy}
        />
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={close} disabled={busy}>
            Keep membership
          </Button>
          <Button
            variant="destructive"
            leadingIcon={<Trash2 className="size-4" />}
            disabled={!canConfirm}
            loading={busy}
            onClick={() => {
              if (!canConfirm) return;
              setBusy(true);
              void onConfirm(row).finally(() => setBusy(false));
            }}
          >
            Revoke membership
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function ActiveOrganizationsSection(): React.ReactElement {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [editTarget, setEditTarget] = useState<Row | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Row | null>(null);
  const [activityTarget, setActivityTarget] = useState<Row | null>(null);
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());

  // Ref map for "View activity" buttons — used to return focus on modal close.
  const activityButtonRefs = useRef<Map<string, React.RefObject<HTMLElement | null>>>(new Map());

  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Keep a live ref to rows so the Realtime callback can resolve org names
  // for the broadcast toast without re-binding the subscription per render.
  const rowsRef = useRef<Row[]>([]);
  rowsRef.current = rows;

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchErr } = await supabase
      .from('memberships')
      .select(
        'id, user_id, org_id, role_id, consent_scope, invited_from_invite_id, joined_at, accepted_at, revoked_at, last_scope_changed_at, orgs(id, name, logo_storage_path), roles(name)',
      )
      .is('revoked_at', null)
      .order('joined_at', { ascending: false });
    if (fetchErr) {
      setError(fetchErr.message || 'fetch_failed');
      setRows([]);
    } else {
      // supabase-js sometimes types embedded joins as arrays; normalize to single.
      const normalized: Row[] = (data ?? []).map((r) => {
        const raw = r as unknown as Record<string, unknown>;
        const orgsField = raw.orgs;
        const rolesField = raw.roles;
        return {
          ...(raw as unknown as Membership),
          orgs: (Array.isArray(orgsField) ? orgsField[0] : orgsField) as Row['orgs'],
          roles: (Array.isArray(rolesField) ? rolesField[0] : rolesField) as Row['roles'],
        };
      });
      setRows(normalized);
    }
    setLoading(false);
  }, []);

  // Initial fetch.
  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Realtime — subscribe to user-channel for cross-context updates.
  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannelLike | null = null;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      if (!user || cancelled) return;
      try {
        channel = (await subscribeToUserChannel(user.id, (raw: unknown) => {
          if (!raw || cancelled) return;
          const payload = raw as RealtimePayload;
          const newRow = payload.new;
          const oldRow = payload.old;
          const id = newRow?.id ?? oldRow?.id;
          if (!id) {
            void refetch();
            return;
          }
          if (payload.eventType === 'UPDATE' && newRow?.revoked_at && !oldRow?.revoked_at) {
            // Operator-side revoke broadcast.
            const local = rowsRef.current.find((r) => r.id === id);
            const orgName = local?.orgs.name ?? 'A clinic';
            setExitingIds((prev) => {
              const next = new Set(prev);
              next.add(id);
              return next;
            });
            window.setTimeout(() => {
              void refetch();
              setExitingIds((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
            }, 240);
            toastRef.current(`${orgName} ended your membership.`, 'info');
            return;
          }
          // Otherwise — scope change, insert, etc. — just refetch.
          void refetch();
        })) as RealtimeChannelLike | null;
      } catch {
        // Realtime failure is non-fatal — the section still works without it.
      }
    })();
    return () => {
      cancelled = true;
      if (channel) {
        try {
          void channel.unsubscribe();
        } catch {
          /* noop */
        }
      }
    };
  }, [refetch]);

  const handleRevoke = async (row: Row): Promise<void> => {
    setRevokeTarget(null);
    setExitingIds((prev) => {
      const next = new Set(prev);
      next.add(row.id);
      return next;
    });
    const res = await revokeMembership({ membership_id: row.id });
    if (res.ok) {
      toastRef.current(`Membership revoked. ${row.orgs.name} no longer has access.`, 'success');
      // Let the exit animation play, then refetch.
      window.setTimeout(() => {
        void refetch();
        setExitingIds((prev) => {
          const next = new Set(prev);
          next.delete(row.id);
          return next;
        });
      }, 240);
    } else {
      // Rollback the exit animation.
      setExitingIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      toastRef.current(`Couldn't revoke. Check your connection and try again.`, 'error');
    }
  };

  const handleSaved = (rowId: string, next: ConsentScope) => {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, consent_scope: next } : r)),
    );
    const orgName = rows.find((r) => r.id === rowId)?.orgs.name ?? '';
    toastRef.current(`Updated. ${orgName} now sees your selected data.`, 'success');
    setEditTarget(null);
    void refetch();
  };

  const empty = !loading && !error && rows.length === 0;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-[18px] font-bold tracking-tight">Active organizations</h2>
        <p className="text-[13px] text-[var(--color-text-secondary)] max-w-[60ch] leading-snug">
          Clinics and coaches you&apos;ve shared data with. Change what you share or revoke
          access any time.
        </p>
      </div>

      {loading ? (
        <div className="space-y-2" role="status" aria-live="polite" aria-busy>
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : error ? (
        <Card variant="flat">
          <div className="py-6 px-4 text-center space-y-3">
            <p className="text-[14px] text-[var(--color-text-secondary)]">
              Couldn&apos;t load your memberships. Check your connection and try again.
            </p>
            <Button onClick={() => void refetch()} size="sm">
              Retry
            </Button>
          </div>
        </Card>
      ) : empty ? (
        <Card variant="flat">
          <EmptyState
            inline
            title="No active memberships"
            body="When a clinic or coach invites you, you'll see them here after you accept."
          />
        </Card>
      ) : (
        <ul className="space-y-2 list-none p-0">
          {rows.map((row) => {
            // Lazy-create a stable ref for each row's "View activity" button.
            if (!activityButtonRefs.current.has(row.id)) {
              activityButtonRefs.current.set(row.id, React.createRef<HTMLElement>());
            }
            return (
              <OrgRow
                key={row.id}
                row={row}
                exiting={exitingIds.has(row.id)}
                onEdit={setEditTarget}
                onRevoke={setRevokeTarget}
                onViewActivity={setActivityTarget}
              />
            );
          })}
        </ul>
      )}

      {editTarget && (
        <EditConsentScopeModal
          membership={editTarget as unknown as MembershipWithOrg}
          onSaved={(scope) => handleSaved(editTarget.id, scope)}
          onClose={() => setEditTarget(null)}
        />
      )}

      <RevokeConfirmModal
        row={revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevoke}
      />

      {activityTarget && (
        <PatientActivityModal
          orgId={activityTarget.org_id}
          orgName={activityTarget.orgs.name}
          onClose={() => setActivityTarget(null)}
          triggerRef={activityButtonRefs.current.get(activityTarget.id)}
        />
      )}
    </div>
  );
}

export default ActiveOrganizationsSection;

// Silence "unused imports" while keeping label catalogs greppable for any
// future planner who searches this file for scope-label coverage.
void DATA_TYPE_LABELS;
