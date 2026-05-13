/**
 * Phase 9 Plan 09-03 — RoleEditorModal.
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
 * Both RPCs are SECURITY DEFINER, gated on `has_permission(uid, org_id,
 * 'roles.manage')` server-side (Plan 09-01). The role_permissions update
 * is atomic (DELETE+INSERT in the RPC body) so a partial grid mid-flight
 * never lands.
 *
 * D-07 mandate: system roles (is_system=true) are NOT edited through this
 * modal in Phase 9 v1. RolesTab hides the edit affordance on system rows.
 *
 * Deviation Rule 3 (parallel-executor isolation): Plan 09-02 owns
 * `src/lib/clinic.ts` typed wrappers but is running in the parallel
 * worktree; we call supabase.rpc directly here. When 09-02 merges, a
 * follow-up plan can refactor to its typed wrappers.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';
import { PERMISSION_KEYS, type PermissionKey, type Role } from '@/types/clinic';

/**
 * UI-SPEC §"Permission grid" lines 329-348 — verbatim labels + descriptions.
 * Keys MUST match PERMISSION_KEYS exactly (compile-time enforced by the
 * Record type below).
 */
export const PERMISSION_LABELS: Record<
  PermissionKey,
  { label: string; description: string }
> = {
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
    description:
      'Read injections, weight, symptoms, and other tracked data (excluding photos)',
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

export interface RoleEditorModalProps {
  open: boolean;
  onClose: () => void;
  /** "create" → render Create form; "edit" → render Save changes form. */
  mode: 'create' | 'edit';
  /** Active org id — passed into create_role. */
  orgId: string;
  /** Required in edit mode; pre-fills name/description/grid. Ignored in create. */
  role?: Role & { permission_keys?: readonly PermissionKey[] };
  /**
   * Called after a successful save. Parent should refetch the roles list
   * to pick up server-side timestamps + member counts. The new role id is
   * provided so the parent can scroll-into-view or highlight the row.
   */
  onSaved: (role: { id: string; name: string }) => void;
}

const NAME_MIN = 2;
const NAME_MAX = 40;

export function RoleEditorModal({
  open,
  onClose,
  mode,
  orgId,
  role,
  onSaved,
}: RoleEditorModalProps) {
  const toast = useToast();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [granted, setGranted] = useState<Set<PermissionKey>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Reset / pre-fill on (re)open. `open` is the gate; modal mounts with
  // empty state in create mode and pre-filled state in edit mode.
  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && role) {
      setName(role.name);
      setDescription(role.description ?? '');
      setGranted(new Set(role.permission_keys ?? []));
    } else {
      setName('');
      setDescription('');
      setGranted(new Set());
    }
    setNameError(null);
    setSubmitting(false);
  }, [open, mode, role]);

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
          toast(
            "Couldn't save the role. Check your connection and try again.",
            'error',
          );
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
          toast(
            "Couldn't save the role. Check your connection and try again.",
            'error',
          );
          return;
        }
        const { error } = await supabase.rpc('update_role', {
          p_role_id: role.id,
          p_name: name.trim(),
          p_description: description.trim() || null,
          p_permission_keys: permissionKeys,
        });
        if (error) {
          toast(
            "Couldn't save the role. Check your connection and try again.",
            'error',
          );
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
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
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
