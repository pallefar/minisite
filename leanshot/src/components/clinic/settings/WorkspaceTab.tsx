/**
 * Phase 9 Plan 09-03 — WorkspaceTab.
 *
 * Settings → Workspace tab. Renders three blocks (UI-SPEC lines 244-263):
 *   1. Identity   — name (editable), slug (read-only in v1; URL changes break
 *                   bookmarks), logo (display only — Plan 09-08 owns upload).
 *   2. Save / Discard CTAs.
 *   3. Danger zone (Owner-only) — Delete workspace via typed-confirm modal.
 *
 * Owner-only gating uses Plan 09-03's useHasPermission hook with
 * 'org.delete'. The hook is a UX hint; the server (Plan 09-01's
 * `delete_org` RPC gated by has_permission) is the security floor.
 *
 * Deviation Rule 3 (parallel-executor isolation): Plan 09-02 owns
 * `src/lib/clinic.ts` typed wrappers; we call supabase.rpc directly here.
 */
import { Building2, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import { useHasPermission } from '@/lib/clinic-permissions';
import { supabase } from '@/lib/supabase';
import type { Org } from '@/types/clinic';

export interface WorkspaceTabProps {
  org: Org;
  /** Called after the user successfully saves a name change. */
  onOrgUpdated: (next: Org) => void;
}

export function WorkspaceTab({ org, onOrgUpdated }: WorkspaceTabProps) {
  const toast = useToast();
  const canDelete = useHasPermission(org.id, 'org.delete');

  const [name, setName] = useState(org.name);
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Reset dirty state when the org prop changes (e.g., after a re-fetch).
  useEffect(() => {
    setName(org.name);
  }, [org.name]);

  const dirty = name.trim() !== org.name.trim() && name.trim().length > 0;

  const handleSave = async (): Promise<void> => {
    if (!dirty) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('update_org', {
        p_org_id: org.id,
        p_name: name.trim(),
      });
      if (error) {
        toast(
          "Couldn't save changes. Check your connection and try again.",
          'error',
        );
        return;
      }
      toast('Workspace updated.', 'success');
      onOrgUpdated({ ...org, name: name.trim() });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDiscard = (): void => {
    setName(org.name);
  };

  const handleDelete = async (): Promise<void> => {
    if (typed !== org.slug) return;
    setDeleteBusy(true);
    try {
      const { error } = await supabase.rpc('delete_org', { p_org_id: org.id });
      if (error) {
        toast(
          "Couldn't delete the workspace. Check your connection and try again.",
          'error',
        );
        return;
      }
      toast('Workspace deleted.', 'success');
      // Route back to the home view. window.location.assign reloads so the
      // user starts from a clean state with no stale clinic context.
      window.location.assign('/');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[20px] font-bold tracking-tight">Workspace settings</h1>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Update your workspace name, URL, and logo. Patients see these changes
          immediately.
        </p>
      </header>

      <section className="space-y-3" aria-labelledby="identity-heading">
        <h2 id="identity-heading" className="text-[16px] font-semibold">
          Identity
        </h2>
        <Input
          label="Workspace name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
          autoComplete="off"
          aria-label="Workspace name"
        />
        <Input
          label="Workspace URL"
          value={`leanshot.app/clinic/${org.slug}`}
          readOnly
          disabled
          hint="Change URL? Contact support."
          aria-label="Workspace URL (read-only)"
        />
        <div className="flex items-center gap-3">
          <div
            className="size-16 rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-tertiary)]"
            aria-label="Workspace logo"
          >
            {org.logo_storage_path ? (
              <span className="text-[11px]">Logo</span>
            ) : (
              <Building2 className="size-7" aria-hidden />
            )}
          </div>
          <p className="text-[12px] text-[var(--color-text-secondary)]">
            Logo upload available in a future release.
          </p>
        </div>

        <div className="flex gap-2 pt-1">
          <Button onClick={handleSave} loading={submitting} disabled={!dirty || submitting}>
            Save changes
          </Button>
          <Button variant="ghost" onClick={handleDiscard} disabled={!dirty || submitting}>
            Discard
          </Button>
        </div>
      </section>

      {canDelete && (
        <section
          className="space-y-3 border-t border-[var(--color-border)] pt-6"
          aria-labelledby="danger-zone-heading"
        >
          <h2
            id="danger-zone-heading"
            className="text-[16px] font-semibold text-[var(--color-danger)]"
          >
            Danger zone
          </h2>
          <Card variant="flat">
            <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
              Deleting the workspace removes all members and ends all access
              immediately. Patients keep their personal data. This cannot be
              undone.
            </p>
            <div className="mt-3">
              <Button
                variant="destructive"
                size="sm"
                leadingIcon={<Trash2 className="size-4" />}
                onClick={() => {
                  setTyped('');
                  setDeleteOpen(true);
                }}
              >
                Delete workspace
              </Button>
            </div>
          </Card>
        </section>
      )}

      <Modal
        open={deleteOpen}
        onClose={() => {
          if (deleteBusy) return;
          setDeleteOpen(false);
        }}
        title="Delete this workspace?"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
            All members will lose access immediately. Patients keep their
            personal data. This cannot be undone.
          </p>
          <Input
            label={`Type ${org.slug} to delete`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="Type workspace slug to confirm deletion"
          />
          <div className="flex gap-2 justify-end">
            <Button
              variant="ghost"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteBusy}
            >
              Keep workspace
            </Button>
            <Button
              variant="destructive"
              disabled={typed !== org.slug || deleteBusy}
              loading={deleteBusy}
              onClick={() => {
                void handleDelete();
              }}
            >
              Delete workspace
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default WorkspaceTab;
