/**
 * Phase 9 Plan 09-03 — RoleEditorModal.
 * Phase 31 Plan 31-05 — Extended with `mode='assign'` for the 3-role
 *   assignment surface per UI-SPEC §Surface 3.
 *
 * Controlled create/edit modal for custom roles. Renders:
 *   - Role name Input (2-40 char client validation; UI-SPEC line 323).
 *   - Description Textarea (optional).
 *   - 10-checkbox permission grid iterating PERMISSION_KEYS from
 *     src/types/clinic.ts. Each row has the label + description copy
 *     verbatim from UI-SPEC §"Permission grid" lines 329-348.
 *
 * On Save:
 *   - mode="create"  → supabase.rpc('create_role', ...)
 *   - mode="edit"    → supabase.rpc('update_role', ...)
 *   - mode="assign"  → supabase.rpc('change_member_role', ...) [Phase 31]
 * All RPCs are SECURITY DEFINER, gated server-side.
 *
 * D-07 mandate: system roles (is_system=true) are NOT edited through this
 * modal in Phase 9 v1. RolesTab hides the edit affordance on system rows.
 *
 * Phase 31 assign-mode: 12-row × 3-col matrix table from ROLE_PERMISSIONS;
 * last-owner client guard with tooltip; change_member_role RPC caller.
 */

import { Check, Minus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import { _ROLE_PERMISSIONS_FOR_TEST } from '@/lib/org';
import { supabase } from '@/lib/supabase';
import { PERMISSION_KEYS, type PermissionKey, type Role } from '@/types/clinic';
import type { OrgRole } from '@/types/org';

/**
 * UI-SPEC §"Permission grid" lines 329-348 — verbatim labels + descriptions.
 * Keys MUST match PERMISSION_KEYS exactly (compile-time enforced by the
 * Record type below).
 */
export const PERMISSION_LABELS: Record<PermissionKey, { label: string; description: string }> = {
  'org.read': {
    label: 'View workspace',
    description: 'See workspace name, members, and patient roster',
  },
  'org.update': {
    label: 'Edit workspace',
    description: 'Change workspace name, URL, and logo',
  },
  'org.delete': {
    label: 'Delete workspace',
    description: 'Permanently remove the workspace and all memberships',
  },
  'members.invite': {
    label: 'Invite members',
    description: 'Send invitations to new patients',
  },
  'members.revoke': {
    label: 'Revoke members',
    description: 'End any active patient membership',
  },
  'members.list': {
    label: 'View members',
    description: 'See the list of patients and pending invitations',
  },
  'roles.manage': {
    label: 'Manage roles',
    description: 'Create, edit, and delete custom roles',
  },
  'patient_data.read': {
    label: 'View patient data',
    description: 'Read injections, weight, symptoms, and other tracked data (excluding photos)',
  },
  'patient_photos.read': {
    label: 'View patient photos',
    description: 'Read body photos that patients have shared',
  },
  'audit_log.read': {
    label: 'View audit log',
    description: 'See who accessed what, and when',
  },
};

// ---------------------------------------------------------------------------
// Phase 31: 12-key org-role matrix labels (D-03 matrix rows in canonical order)
// ---------------------------------------------------------------------------

/**
 * The 12 permission keys in the Phase 31 D-03 canonical order.
 * These map to ROLE_PERMISSIONS in src/lib/org.ts.
 */
const ORG_MATRIX_PERMISSION_KEYS: readonly string[] = [
  'members.invite',
  'members.revoke',
  'members.list',
  'members.role.edit',
  'settings.edit',
  'branding.edit',
  'onboarding.edit',
  'roster.view',
  'roster.thresholds.edit',
  'alerts.ack',
  'alerts.snooze',
  'billing.view',
];

/** Human labels for the 12-key matrix rows. */
const ORG_MATRIX_LABELS: Record<string, { label: string; description: string }> = {
  'members.invite': {
    label: 'Invite members',
    description: 'Send invitations to new team members',
  },
  'members.revoke': { label: 'Revoke members', description: 'Remove a member from the workspace' },
  'members.list': { label: 'View members', description: 'See the member list and pending invites' },
  'members.role.edit': {
    label: 'Change member roles',
    description: 'Reassign Owner, Clinician, or Staff roles',
  },
  'settings.edit': {
    label: 'Edit settings',
    description: 'Change workspace name, URL, and general settings',
  },
  'branding.edit': {
    label: 'Edit branding',
    description: 'Customize clinic logo, colors, and fonts',
  },
  'onboarding.edit': {
    label: 'Edit onboarding',
    description: 'Build and publish the patient onboarding flow',
  },
  'roster.view': { label: 'View patient roster', description: 'See the list of enrolled patients' },
  'roster.thresholds.edit': {
    label: 'Edit alert thresholds',
    description: 'Set per-patient dose and metric alert thresholds',
  },
  'alerts.ack': { label: 'Acknowledge alerts', description: 'Dismiss active clinician alerts' },
  'alerts.snooze': { label: 'Snooze alerts', description: 'Temporarily suppress an alert' },
  'billing.view': { label: 'View billing', description: 'See subscription and invoice details' },
};

const ORG_ROLES: readonly OrgRole[] = ['owner', 'clinician', 'staff'];
const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner',
  clinician: 'Clinician',
  staff: 'Staff',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RoleEditorModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * "create" → render Create form;
   * "edit"   → render Save changes form;
   * "assign" → Phase 31 3-role assignment with 12×3 matrix (ORG-12).
   */
  mode: 'create' | 'edit' | 'assign';
  /** Active org id — passed into create_role / assign mode. */
  orgId: string;
  /** Required in edit mode; pre-fills name/description/grid. Ignored in create/assign. */
  role?: Role & { permission_keys?: readonly PermissionKey[] };
  /**
   * Called after a successful save. Parent should refetch the roles list
   * to pick up server-side timestamps + member counts. The new role id is
   * provided so the parent can scroll-into-view or highlight the row.
   */
  onSaved: (role: { id: string; name: string }) => void;
  /** Phase 31 assign mode: the target member's user id. */
  userId?: string;
  /** Phase 31 assign mode: the target member's display name. */
  userName?: string;
  /** Phase 31 assign mode: the target member's current org role. */
  currentRole?: OrgRole;
}

const NAME_MIN = 2;
const NAME_MAX = 40;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RoleEditorModal({
  open,
  onClose,
  mode,
  orgId,
  role,
  onSaved,
  userId,
  userName,
  currentRole,
}: RoleEditorModalProps) {
  const toast = useToast();

  // ---------------------------------------------------------------------------
  // create/edit mode state
  // ---------------------------------------------------------------------------
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [granted, setGranted] = useState<Set<PermissionKey>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // assign mode state (Phase 31)
  // ---------------------------------------------------------------------------
  const [selectedRole, setSelectedRole] = useState<OrgRole>('clinician');
  const [ownerCount, setOwnerCount] = useState<number>(2); // Default ≥2 (conservative)

  // Reset / pre-fill on (re)open. `open` is the gate; modal mounts with
  // empty state in create mode and pre-filled state in edit mode.
  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && role) {
      setName(role.name);
      setDescription(role.description ?? '');
      setGranted(new Set(role.permission_keys ?? []));
    } else if (mode === 'assign') {
      // Start selected role at current role (or 'clinician' fallback)
      setSelectedRole(currentRole ?? 'clinician');
      // Fetch owner count for last-owner guard
      void (async () => {
        const { data, error } = await supabase
          .from('org_members')
          .select('user_id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('role', 'owner');
        if (!error) {
          setOwnerCount(data === null ? 0 : ((data as unknown as { count: number }).count ?? 0));
        }
      })();
      // Separately fetch count using count mode
      void (async () => {
        const { count, error } = await supabase
          .from('org_members')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('role', 'owner');
        if (!error && count !== null) {
          setOwnerCount(count);
        }
      })();
    } else {
      setName('');
      setDescription('');
      setGranted(new Set());
    }
    setNameError(null);
    setSubmitting(false);
  }, [open, mode, role, orgId, currentRole]);

  // ---------------------------------------------------------------------------
  // create/edit mode handlers
  // ---------------------------------------------------------------------------

  const togglePermission = (key: PermissionKey): void => {
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const validateName = (n: string): string | null => {
    const trimmed = n.trim();
    if (trimmed.length < NAME_MIN) {
      return `Role name must be at least ${NAME_MIN} characters.`;
    }
    if (trimmed.length > NAME_MAX) {
      return `Role name can be at most ${NAME_MAX} characters.`;
    }
    return null;
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const err = validateName(name);
    if (err) {
      setNameError(err);
      return;
    }
    setNameError(null);
    setSubmitting(true);
    try {
      const permissionKeys = Array.from(granted);
      if (mode === 'create') {
        const { data, error } = await supabase.rpc('create_role', {
          p_org_id: orgId,
          p_name: name.trim(),
          p_description: description.trim() || null,
          p_permission_keys: permissionKeys,
        });
        if (error) {
          toast("Couldn't save the role. Check your connection and try again.", 'error');
          return;
        }
        const row = Array.isArray(data) ? data[0] : data;
        const newId =
          row && typeof row === 'object' && 'role_id' in row
            ? (row as { role_id: string }).role_id
            : typeof row === 'string'
              ? row
              : '';
        toast(`Role "${name.trim()}" created.`, 'success');
        onSaved({ id: newId, name: name.trim() });
        onClose();
      } else {
        if (!role) {
          toast("Couldn't save the role. Check your connection and try again.", 'error');
          return;
        }
        const { error } = await supabase.rpc('update_role', {
          p_role_id: role.id,
          p_name: name.trim(),
          p_description: description.trim() || null,
          p_permission_keys: permissionKeys,
        });
        if (error) {
          toast("Couldn't save the role. Check your connection and try again.", 'error');
          return;
        }
        toast(`Role "${name.trim()}" updated.`, 'success');
        onSaved({ id: role.id, name: name.trim() });
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // assign mode handler (Phase 31)
  // ---------------------------------------------------------------------------

  /**
   * Last-owner guard: disabled when demoting the final owner.
   * Server SECDEF is the floor (T-31-05-01); this is UX sugar.
   */
  const isLastOwnerDemote =
    mode === 'assign' && currentRole === 'owner' && selectedRole !== 'owner' && ownerCount <= 1;

  const handleAssignSubmit = async (): Promise<void> => {
    if (!userId) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('change_member_role', {
        p_org_id: orgId,
        p_user_id: userId,
        p_role: selectedRole,
      });
      if (error) {
        if (error.message.includes('LAST_OWNER_DEMOTE_DENIED')) {
          toast('An organization must have at least one owner.', 'error');
        } else {
          toast("Couldn't change role. Check your connection and try again.", 'error');
        }
        return;
      }
      const selectedRoleLabel = ORG_ROLE_LABELS[selectedRole];
      toast(`${userName ?? 'Member'}'s role changed to ${selectedRoleLabel}.`, 'success');
      onSaved({ id: userId, name: userName ?? '' });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render: assign mode (Phase 31 UI-SPEC §Surface 3)
  // ---------------------------------------------------------------------------

  if (mode === 'assign') {
    const selectedRoleLabel = ORG_ROLE_LABELS[selectedRole];
    return (
      <Modal
        open={open}
        onClose={() => {
          if (submitting) return;
          onClose();
        }}
        title={`Change role${userName ? ` for ${userName}` : ''}`}
        size="lg"
        mobileFullscreen
      >
        <div className="space-y-5">
          {/* Role selector */}
          <div>
            <p className="text-[13px] font-semibold text-[var(--color-text)] mb-2">New role</p>
            <div className="flex gap-2">
              {ORG_ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSelectedRole(r)}
                  aria-pressed={selectedRole === r}
                  className={[
                    'flex-1 px-3 py-2 rounded-xl border text-[13px] font-semibold transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
                    selectedRole === r
                      ? 'bg-[var(--color-primary-soft)] border-[var(--color-primary)] text-[var(--color-primary)]'
                      : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]',
                  ].join(' ')}
                >
                  {ORG_ROLE_LABELS[r]}
                </button>
              ))}
            </div>
          </div>

          {/* 12×3 matrix table */}
          <div>
            <p className="text-[13px] font-semibold text-[var(--color-text)] mb-2">
              Role permissions
            </p>
            <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
              <table className="w-full text-[12px]" aria-label="Role permissions matrix">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="text-start px-3 py-2 text-[var(--color-text-secondary)] font-semibold w-auto">
                      Permission
                    </th>
                    {ORG_ROLES.map((r) => (
                      <th
                        key={r}
                        className={[
                          'px-3 py-2 text-center font-semibold w-24',
                          selectedRole === r
                            ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]'
                            : 'text-[var(--color-text-secondary)]',
                        ].join(' ')}
                      >
                        {ORG_ROLE_LABELS[r]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ORG_MATRIX_PERMISSION_KEYS.map((permKey) => {
                    const meta = ORG_MATRIX_LABELS[permKey];
                    return (
                      <tr
                        key={permKey}
                        className="border-b border-[var(--color-border)] last:border-0"
                      >
                        <td className="px-3 py-2">
                          <p className="font-semibold text-[var(--color-text)]">
                            {meta?.label ?? permKey}
                          </p>
                          <p className="text-[var(--color-text-tertiary)] text-[11px]">
                            {meta?.description ?? ''}
                          </p>
                        </td>
                        {ORG_ROLES.map((r) => {
                          const granted = _ROLE_PERMISSIONS_FOR_TEST[r].has(permKey);
                          return (
                            <td
                              key={r}
                              className={[
                                'px-3 py-2 text-center',
                                selectedRole === r ? 'bg-[var(--color-primary-soft)]' : '',
                              ].join(' ')}
                            >
                              {granted ? (
                                <Check
                                  size={14}
                                  aria-hidden
                                  className="inline text-[var(--color-success)]"
                                />
                              ) : (
                                <Minus
                                  size={14}
                                  aria-hidden
                                  className="inline text-[var(--color-text-tertiary)]"
                                />
                              )}
                              <span className="sr-only">{granted ? 'Granted' : 'Not granted'}</span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Audit note */}
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Changes are logged to your workspace audit log.
          </p>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            {isLastOwnerDemote ? (
              <span
                title="An organization must have at least one owner."
                aria-label="An organization must have at least one owner."
              >
                <Button type="button" variant="primary" disabled aria-busy={false}>
                  Change to {selectedRoleLabel}
                </Button>
              </span>
            ) : (
              <Button
                type="button"
                variant="primary"
                loading={submitting}
                disabled={submitting}
                onClick={() => void handleAssignSubmit()}
              >
                Change to {selectedRoleLabel}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: create / edit mode (Phase 9 original)
  // ---------------------------------------------------------------------------

  return (
    <Modal
      open={open}
      onClose={() => {
        if (submitting) return;
        onClose();
      }}
      title={mode === 'create' ? 'Create role' : 'Edit role'}
      size="lg"
      mobileFullscreen
    >
      <form className="space-y-5" onSubmit={submit} noValidate>
        <Input
          label="Role name"
          placeholder="e.g. Nurse practitioner"
          hint="2–40 characters. Visible to your members."
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(validateName(e.target.value));
          }}
          error={nameError ?? undefined}
          required
          maxLength={NAME_MAX}
          autoComplete="off"
          aria-label="Role name"
        />

        <Textarea
          label="Description"
          placeholder="What this role can do (optional)."
          hint="Helps your team understand the role's purpose."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={200}
        />

        <fieldset className="space-y-3">
          <legend>
            <h3 className="text-[14px] font-semibold">Permissions</h3>
            <p className="text-[12px] text-[var(--color-text-secondary)]">
              Check the actions this role can perform.
            </p>
          </legend>
          <ul className="space-y-2" aria-label="Permission grid">
            {PERMISSION_KEYS.map((k) => {
              const meta = PERMISSION_LABELS[k];
              const checked = granted.has(k);
              return (
                <li key={k}>
                  <label
                    className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] p-3 cursor-pointer hover:border-[var(--color-primary)]"
                    htmlFor={`perm-${k}`}
                  >
                    <input
                      type="checkbox"
                      id={`perm-${k}`}
                      checked={checked}
                      onChange={() => togglePermission(k)}
                      className="mt-1 size-4 accent-[var(--color-primary)]"
                      aria-label={meta.label}
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[13px] font-semibold">{meta.label}</span>
                      <span className="text-[12px] text-[var(--color-text-secondary)]">
                        {meta.description}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting} disabled={submitting}>
            {mode === 'create' ? 'Create role' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default RoleEditorModal;
