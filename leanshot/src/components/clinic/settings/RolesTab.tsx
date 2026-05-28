/**
 * Phase 9 Plan 09-03 — RolesTab.
 *
 * Settings → Roles tab (UI-SPEC lines 298-362). Renders two sections:
 *   1. Default roles  — 3 system roles seeded by Plan 09-01 trigger (Owner,
 *                       Coach, View-only). Read-only in v1 per D-07; edit /
 *                       delete CTAs hidden. Tooltip explains.
 *   2. Custom roles   — RolesTab CRUD via RoleEditorModal + typed-confirm
 *                       delete. Empty state copy from UI-SPEC line 307.
 *
 * Active member-count badges per row computed from a direct memberships
 * SELECT (RLS-gated on `has_permission(uid, org_id, 'members.list')`).
 *
 * Delete custom role:
 *   - 0 members: copy "This role is not assigned to any members.";
 *     destructive submit calls `delete_role` RPC.
 *   - N members: copy "{N} members will be moved to the View-only role.";
 *     server-side `delete_role` does the reassignment and returns
 *     reassigned_count which we surface in the success toast.
 *
 * D-07 mandate: system roles (is_system=true) cannot be deleted; the
 * delete IconButton is omitted from system rows. If the user somehow
 * triggers `delete_role` on a system row (e.g., dev tools), the server
 * rejects (Plan 09-01 RPC enforces).
 *
 * Parallel-executor isolation: Plan 09-02 owns `src/lib/clinic.ts` typed
 * wrappers; we call supabase.rpc directly here.
 */
import { Edit2, Plus, Shield, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';
import type { PermissionKey, Role } from '@/types/clinic';
import { RoleEditorModal } from './RoleEditorModal';

export interface RolesTabProps {
  orgId: string;
}

interface RoleRow extends Role {
  /** Computed from memberships count; null while pending. */
  memberCount: number | null;
  /** Computed from role_permissions; passed into RoleEditorModal in edit mode. */
  permission_keys: readonly PermissionKey[];
}

export function RolesTab({ orgId }: RolesTabProps) {
  const toast = useToast();

  const [rows, setRows] = useState<RoleRow[] | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editorRole, setEditorRole] = useState<RoleRow | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  const fetchRoles = useCallback(async (): Promise<void> => {
    const [{ data: rolesData, error: rolesErr }, { data: rpData }, { data: memData }] =
      await Promise.all([
        supabase
          .from('roles')
          .select('id, org_id, name, description, is_system, created_at')
          .eq('org_id', orgId)
          .order('is_system', { ascending: false })
          .order('created_at', { ascending: true }),
        supabase.from('role_permissions').select('role_id, permission_key'),
        supabase.from('memberships').select('role_id, revoked_at').eq('org_id', orgId),
      ]);

    if (rolesErr) {
      toast("Couldn't load roles. Check your connection and try again.", 'error');
      setRows([]);
      return;
    }

    const permsByRole = new Map<string, PermissionKey[]>();
    ((rpData ?? []) as { role_id: string; permission_key: PermissionKey }[]).forEach((r) => {
      const cur = permsByRole.get(r.role_id) ?? [];
      cur.push(r.permission_key);
      permsByRole.set(r.role_id, cur);
    });

    const countByRole = new Map<string, number>();
    ((memData ?? []) as { role_id: string; revoked_at: string | null }[])
      .filter((m) => m.revoked_at === null)
      .forEach((m) => {
        countByRole.set(m.role_id, (countByRole.get(m.role_id) ?? 0) + 1);
      });

    const next: RoleRow[] = ((rolesData ?? []) as Role[]).map((r) => ({
      ...r,
      memberCount: countByRole.get(r.id) ?? 0,
      permission_keys: permsByRole.get(r.id) ?? [],
    }));
    setRows(next);
  }, [orgId, toast]);

  useEffect(() => {
    void fetchRoles();
  }, [fetchRoles]);

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    if (deleteTarget.is_system) return;
    if (deleteTyped !== deleteTarget.name) return;
    setDeleteBusy(true);
    try {
      const { data, error } = await supabase.rpc('delete_role', {
        p_role_id: deleteTarget.id,
      });
      if (error) {
        toast("Couldn't delete the role. Check your connection and try again.", 'error');
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      const reassigned =
        row && typeof row === 'object' && 'reassigned_count' in row
          ? Number((row as { reassigned_count: unknown }).reassigned_count) || 0
          : 0;
      toast(
        `Role "${deleteTarget.name}" deleted. ${reassigned} members moved to View-only.`,
        'success',
      );
      setDeleteTarget(null);
      setDeleteTyped('');
      void fetchRoles();
    } finally {
      setDeleteBusy(false);
    }
  };

  const openCreate = (): void => {
    setEditorMode('create');
    setEditorRole(null);
    setEditorOpen(true);
  };

  const openEdit = (row: RoleRow): void => {
    setEditorMode('edit');
    setEditorRole(row);
    setEditorOpen(true);
  };

  const systemRows = (rows ?? []).filter((r) => r.is_system);
  const customRows = (rows ?? []).filter((r) => !r.is_system);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight">Roles and permissions</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Default roles cover most workspaces. Create custom roles for finer-grained access.
          </p>
        </div>
        <Button leadingIcon={<Plus className="size-4" />} onClick={openCreate}>
          Create role
        </Button>
      </header>

      <section aria-labelledby="system-roles-heading" className="space-y-3">
        <h2 id="system-roles-heading" className="text-[16px] font-semibold">
          Default roles
        </h2>
        <ul className="space-y-2">
          {systemRows.map((r) => (
            <li key={r.id}>
              <Card variant="flat">
                <div className="flex items-center gap-3 flex-wrap">
                  <Shield className="size-5 text-[var(--color-text-tertiary)]" aria-hidden />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold">
                      {r.name}
                      <span className="text-[12px] font-normal text-[var(--color-text-secondary)]">
                        {' · '}
                        {r.memberCount ?? 0} members
                      </span>
                    </p>
                    {r.description && (
                      <p className="text-[12px] text-[var(--color-text-secondary)]">
                        {r.description}
                      </p>
                    )}
                  </div>
                  <Badge tone="neutral">Default</Badge>
                  <span
                    className="text-[11px] text-[var(--color-text-tertiary)]"
                    title="System roles can't be edited yet"
                  >
                    Read-only
                  </span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="custom-roles-heading" className="space-y-3">
        <h2 id="custom-roles-heading" className="text-[16px] font-semibold">
          Custom roles
        </h2>
        {customRows.length === 0 ? (
          <EmptyState
            illustration={<Shield className="size-6" aria-hidden />}
            title="No custom roles."
            body="Default roles work for most workspaces."
            inline
          />
        ) : (
          <ul className="space-y-2">
            {customRows.map((r) => (
              <li key={r.id}>
                <Card variant="flat">
                  <div className="flex items-center gap-3 flex-wrap">
                    <Shield className="size-5 text-[var(--color-primary)]" aria-hidden />
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold">
                        {r.name}
                        <span className="text-[12px] font-normal text-[var(--color-text-secondary)]">
                          {' · '}
                          {r.memberCount ?? 0} members
                        </span>
                      </p>
                      {r.description && (
                        <p className="text-[12px] text-[var(--color-text-secondary)]">
                          {r.description}
                        </p>
                      )}
                    </div>
                    <IconButton aria-label={`Edit role ${r.name}`} onClick={() => openEdit(r)}>
                      <Edit2 className="size-4" />
                    </IconButton>
                    <IconButton
                      aria-label={`Delete role ${r.name}`}
                      onClick={() => {
                        setDeleteTyped('');
                        setDeleteTarget(r);
                      }}
                    >
                      <Trash2 className="size-4 text-[var(--color-danger)]" />
                    </IconButton>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RoleEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        mode={editorMode}
        orgId={orgId}
        role={editorRole ?? undefined}
        onSaved={() => {
          void fetchRoles();
        }}
      />

      {/* Delete role typed-confirm modal */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          if (deleteBusy) return;
          setDeleteTarget(null);
          setDeleteTyped('');
        }}
        title={deleteTarget ? `Delete role "${deleteTarget.name}"?` : 'Delete role?'}
        size="md"
      >
        {deleteTarget && (
          <div className="space-y-4">
            <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
              {deleteTarget.memberCount && deleteTarget.memberCount > 0
                ? `${deleteTarget.memberCount} members will be moved to the View-only role. Deleting cannot be undone.`
                : 'This role is not assigned to any members. Deleting it cannot be undone.'}
            </p>
            <Input
              label={`Type ${deleteTarget.name} to delete`}
              value={deleteTyped}
              onChange={(e) => setDeleteTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label="Type role name to confirm delete"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteTyped('');
                }}
                disabled={deleteBusy}
              >
                Keep role
              </Button>
              <Button
                variant="destructive"
                loading={deleteBusy}
                disabled={deleteTyped !== deleteTarget.name || deleteBusy}
                onClick={() => {
                  void handleDelete();
                }}
              >
                Delete role
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default RolesTab;
