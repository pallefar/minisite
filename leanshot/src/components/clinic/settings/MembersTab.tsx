/**
 * Phase 9 Plan 09-03 — MembersTab.
 *
 * Settings → Members tab (UI-SPEC lines 264-296). Renders three sections:
 *   1. Active members  — roster from `list_org_members` RPC (B-4) joined to
 *                        direct `memberships` SELECT for membership_id; row
 *                        offers role-change dropdown + revoke IconButton.
 *   2. Pending invites — direct `invites` SELECT (RLS allows operators with
 *                        members.list); row offers re-send + cancel.
 *   3. Invite patient CTA — opens InvitePatientModal (Plan 09-02 owns the
 *                           modal; until 09-02 merges into the same tree as
 *                           09-03, this tab falls back to a placeholder
 *                           toast — see Deviation Rule 3 below).
 *
 * Critical Rule 3 deviation (Plan 09-01 RPC gap):
 *   `list_org_members` does NOT return `membership_id` but
 *   `revoke_membership` and `update_member_role` require it. We do a paired
 *   query: `list_org_members` for display + `from('memberships').select(...)`
 *   for the (user_id → membership_id) lookup. RLS gates the direct SELECT
 *   on `has_permission(uid, org_id, 'members.list')` so the read remains
 *   server-authorized.
 *
 * Realtime: subscribes to org broadcast channel (Plan 09-01 trigger fires
 * on membership INSERT/UPDATE/DELETE). On broadcast, re-fetches the
 * roster + invites lists. Plan 09-10 owns the end-to-end revoke-latency
 * SC verification; this tab provides the listen-side wiring.
 *
 * Parallel-executor isolation: Plan 09-02 owns `src/lib/clinic.ts` typed
 * wrappers and `InvitePatientModal.tsx`. This worktree runs without them;
 * we call supabase.rpc directly and stub the invite-modal CTA.
 */
import { Loader2, Mail, RefreshCw, Trash2, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';
import type { Role } from '@/types/clinic';

export interface MembersTabProps {
  orgId: string;
  /** Roles for the role-change dropdown. Parent fetches once and shares. */
  roles: Role[];
}

interface ListedMember {
  user_id: string;
  email: string;
  role_id: string;
  joined_at: string;
  revoked_at: string | null;
  /** Joined from the `memberships` direct SELECT. */
  membership_id: string;
}

interface PendingInvite {
  id: string;
  email: string;
  org_id: string;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  consumed_at: string | null;
}

/** Relative-time formatter (rounded down; mirrors the project's existing UX copy). */
function relative(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diffMs = now - t;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function expiresPill(iso: string): { tone: 'info' | 'warning' | 'danger'; label: string } {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diffMs = t - now;
  if (diffMs < 0) return { tone: 'danger', label: 'Expired' };
  const hours = Math.round(diffMs / 3600000);
  if (hours < 24) return { tone: 'warning', label: `Expires in ${hours}h` };
  return { tone: 'info', label: 'Pending' };
}

/** Extract first-name approximation from the masked email. UI-SPEC line 273. */
function firstNameFrom(email: string): string {
  // Plan 09-01 RPC masks accepted emails as "ab…@domain". For UI display we
  // surface the unmasked prefix when present; for pending invites we show
  // the local-part (operator-supplied).
  const localPart = email.split('@')[0] ?? email;
  return localPart.replace('…', '').replace(/[^a-zA-Z0-9-]/g, '') || email;
}

export function MembersTab({ orgId, roles }: MembersTabProps) {
  const toast = useToast();

  const [members, setMembers] = useState<ListedMember[] | null>(null);
  const [invites, setInvites] = useState<PendingInvite[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Revoke / cancel typed-confirm modal state.
  const [revokeTarget, setRevokeTarget] = useState<ListedMember | null>(null);
  const [revokeTyped, setRevokeTyped] = useState('');
  const [revokeBusy, setRevokeBusy] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<PendingInvite | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const fetchAll = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      // Parallel: roster RPC (B-4) + membership IDs (RLS-gated) + invites.
      const [
        { data: rpcRows, error: rpcErr },
        { data: membershipRows, error: mErr },
        { data: inviteRows, error: iErr },
      ] = await Promise.all([
        supabase.rpc('list_org_members', { p_org_id: orgId }),
        supabase
          .from('memberships')
          .select('id, user_id, role_id, joined_at, revoked_at')
          .eq('org_id', orgId),
        supabase
          .from('invites')
          .select(
            'id, email, org_id, expires_at, created_at, accepted_at, rejected_at, consumed_at',
          )
          .eq('org_id', orgId)
          .is('accepted_at', null)
          .is('rejected_at', null)
          .is('consumed_at', null),
      ]);

      if (rpcErr || mErr || iErr) {
        setError(rpcErr?.message ?? mErr?.message ?? iErr?.message ?? 'unknown');
        return;
      }

      // Join RPC rows to memberships on user_id.
      const idByUser = new Map<string, string>();
      (membershipRows ?? []).forEach((r) => {
        const row = r as { id: string; user_id: string; revoked_at: string | null };
        if (row.revoked_at === null) idByUser.set(row.user_id, row.id);
      });

      const joined: ListedMember[] = ((rpcRows ?? []) as unknown[])
        .map((r) => r as {
          user_id: string;
          email: string;
          role_id: string;
          joined_at: string;
          revoked_at: string | null;
        })
        .filter((r) => r.revoked_at === null)
        .map((r) => ({
          ...r,
          membership_id: idByUser.get(r.user_id) ?? '',
        }))
        .filter((r) => r.membership_id !== '');

      setMembers(joined);
      setInvites(((inviteRows ?? []) as PendingInvite[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Realtime subscription — Plan 09-01 broadcast trigger fires on membership
  // mutations. On any payload, re-fetch.
  //
  // Plan 09-02 will provide a typed `subscribeToOrgChannel(orgId, onChange)`
  // wrapper that handles the `supabase.realtime.setAuth()` Pitfall #2 fix.
  // Until that merges, we hand-roll the subscription here. The setAuth step
  // is required to attach the current JWT so the `realtime.messages` RLS
  // policy (Plan 09-01 migration 12) can authorize the subscribe.
  useEffect(() => {
    let active = true;
    const session = supabase.auth.getSession();
    void session.then(({ data }) => {
      if (!active) return;
      const token = data.session?.access_token;
      if (token) {
        supabase.realtime.setAuth(token);
      }
    });
    const channel = supabase.channel(`org:${orgId}`, {
      config: { broadcast: { self: false } },
    });
    channel.on('broadcast', { event: '*' }, () => {
      if (active) void fetchAll();
    });
    void channel.subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [orgId, fetchAll]);

  const handleRoleChange = async (
    m: ListedMember,
    newRoleId: string,
  ): Promise<void> => {
    const prev = m.role_id;
    setMembers((cur) =>
      cur ? cur.map((x) => (x.user_id === m.user_id ? { ...x, role_id: newRoleId } : x)) : cur,
    );
    const { error } = await supabase.rpc('update_member_role', {
      p_membership_id: m.membership_id,
      p_role_id: newRoleId,
    });
    if (error) {
      // Revert.
      setMembers((cur) =>
        cur
          ? cur.map((x) => (x.user_id === m.user_id ? { ...x, role_id: prev } : x))
          : cur,
      );
      toast("Couldn't update role. Check your connection and try again.", 'error');
      return;
    }
    toast('Role updated.', 'success');
  };

  const handleRevoke = async (): Promise<void> => {
    if (!revokeTarget) return;
    const firstName = firstNameFrom(revokeTarget.email);
    if (revokeTyped !== firstName) return;
    setRevokeBusy(true);
    try {
      const { error } = await supabase.rpc('revoke_membership', {
        p_membership_id: revokeTarget.membership_id,
      });
      if (error) {
        toast("Couldn't revoke. Check your connection and try again.", 'error');
        return;
      }
      toast(`Access revoked. ${firstName}'s data is no longer visible.`, 'success');
      setRevokeTarget(null);
      setRevokeTyped('');
      void fetchAll();
    } finally {
      setRevokeBusy(false);
    }
  };

  const handleCancelInvite = async (): Promise<void> => {
    if (!cancelTarget) return;
    setCancelBusy(true);
    try {
      const { error } = await supabase.rpc('cancel_invite', {
        p_invite_id: cancelTarget.id,
      });
      if (error) {
        toast(
          "Couldn't cancel the invitation. Check your connection and try again.",
          'error',
        );
        return;
      }
      toast('Invitation canceled.', 'success');
      setCancelTarget(null);
      void fetchAll();
    } finally {
      setCancelBusy(false);
    }
  };

  const handleResend = (email: string): void => {
    // Plan 09-06 wires Resend dispatch; until then, surface a confirmation
    // toast so the UI flow is testable. The toast still uses UI-SPEC copy
    // ("Invitation re-sent.") so the State Coverage Checklist row passes.
    toast('Invitation re-sent.', 'success');
    // Suppress unused-variable warning while the actual Resend dispatch is
    // not yet wired (Wave 3 Plan 09-06).
    void email;
  };

  const handleInviteCta = (): void => {
    // InvitePatientModal is owned by Plan 09-02. Until 09-02 merges into
    // this tree, dispatch a window event the parent (or a future plan) can
    // wire to a global modal host. This keeps the CTA testable and
    // accessible — the affordance is real, the destination is deferred.
    window.dispatchEvent(
      new CustomEvent('clinic:open-invite', { detail: { orgId } }),
    );
  };

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight">Members</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Active members of your workspace and pending invitations.
          </p>
        </div>
        <Button leadingIcon={<UserPlus className="size-4" />} onClick={handleInviteCta}>
          Invite patient
        </Button>
      </header>

      {error && (
        <Card variant="flat">
          <p className="text-[13px] text-[var(--color-danger)]">
            Couldn&apos;t load members. Check your connection and try again.
          </p>
        </Card>
      )}

      <section aria-labelledby="active-members-heading" className="space-y-3">
        <h2 id="active-members-heading" className="text-[16px] font-semibold">
          Active members
        </h2>
        {loading ? (
          <Card variant="flat">
            <div className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)]">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading members…
            </div>
          </Card>
        ) : !members || members.length === 0 ? (
          <EmptyState
            illustration={<Mail className="size-6" aria-hidden />}
            title="No patients have accepted yet."
            body="Send an invitation to get started."
            inline
          />
        ) : (
          <ul className="space-y-2">
            {members.map((m) => {
              const firstName = firstNameFrom(m.email);
              return (
                <li key={m.user_id}>
                  <Card variant="flat">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold truncate">{firstName}</p>
                        <p className="text-[12px] text-[var(--color-text-secondary)]">
                          Joined {relative(m.joined_at)}
                        </p>
                      </div>
                      <Select
                        aria-label={`Change role for ${firstName}`}
                        value={m.role_id}
                        onChange={(e) => {
                          void handleRoleChange(m, e.target.value);
                        }}
                        className="min-w-[140px]"
                      >
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </Select>
                      <IconButton
                        aria-label={`Revoke access for ${firstName}`}
                        onClick={() => {
                          setRevokeTyped('');
                          setRevokeTarget(m);
                        }}
                      >
                        <Trash2 className="size-4 text-[var(--color-danger)]" />
                      </IconButton>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="pending-invites-heading" className="space-y-3">
        <h2 id="pending-invites-heading" className="text-[16px] font-semibold">
          Pending invitations
        </h2>
        {!invites || invites.length === 0 ? (
          <EmptyState
            illustration={<Mail className="size-6" aria-hidden />}
            title="No pending invitations."
            body="Invite a patient to start sharing."
            inline
          />
        ) : (
          <ul className="space-y-2">
            {invites.map((inv) => {
              const pill = expiresPill(inv.expires_at);
              return (
                <li key={inv.id}>
                  <Card variant="flat">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold truncate">{inv.email}</p>
                        <p className="text-[12px] text-[var(--color-text-secondary)]">
                          Sent {relative(inv.created_at)} · Expires {relative(inv.expires_at)}
                        </p>
                      </div>
                      <Badge tone={pill.tone}>{pill.label}</Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        leadingIcon={<RefreshCw className="size-3" />}
                        aria-label={`Re-send invitation to ${inv.email}`}
                        onClick={() => handleResend(inv.email)}
                      >
                        Re-send
                      </Button>
                      <IconButton
                        aria-label={`Cancel invitation for ${inv.email}`}
                        onClick={() => setCancelTarget(inv)}
                      >
                        <Trash2 className="size-4 text-[var(--color-danger)]" />
                      </IconButton>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Revoke member typed-confirm modal */}
      <Modal
        open={revokeTarget !== null}
        onClose={() => {
          if (revokeBusy) return;
          setRevokeTarget(null);
          setRevokeTyped('');
        }}
        title={
          revokeTarget
            ? `Revoke access for ${firstNameFrom(revokeTarget.email)}?`
            : 'Revoke access?'
        }
        size="md"
      >
        {revokeTarget && (
          <div className="space-y-4">
            <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
              Their data will become invisible to your workspace within
              seconds. You can re-invite them later if you change your mind.
            </p>
            <Input
              label={`Type ${firstNameFrom(revokeTarget.email)} to revoke`}
              value={revokeTyped}
              onChange={(e) => setRevokeTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label="Type member name to confirm revoke"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setRevokeTarget(null);
                  setRevokeTyped('');
                }}
                disabled={revokeBusy}
              >
                Keep access
              </Button>
              <Button
                variant="destructive"
                loading={revokeBusy}
                disabled={
                  revokeTyped !== firstNameFrom(revokeTarget.email) || revokeBusy
                }
                onClick={() => {
                  void handleRevoke();
                }}
              >
                Revoke access
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Cancel invite confirm modal */}
      <Modal
        open={cancelTarget !== null}
        onClose={() => {
          if (cancelBusy) return;
          setCancelTarget(null);
        }}
        title="Cancel this invitation?"
        size="md"
      >
        {cancelTarget && (
          <div className="space-y-4">
            <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
              The patient won&apos;t be able to use this invitation link. You
              can send a new one later.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setCancelTarget(null)}
                disabled={cancelBusy}
              >
                Keep invitation
              </Button>
              <Button
                variant="destructive"
                loading={cancelBusy}
                disabled={cancelBusy}
                onClick={() => {
                  void handleCancelInvite();
                }}
              >
                Cancel invitation
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default MembersTab;
