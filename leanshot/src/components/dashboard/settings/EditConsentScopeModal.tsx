/**
 * Phase 9 Plan 09-05 — Edit-consent-scope modal.
 *
 * Patient-facing modal that lets a member toggle the 10 canonical data-type
 * checkboxes for a given org (D-06 — consent scope editable post-acceptance,
 * D-15 — Active organizations is the canonical revocation/scope-edit surface).
 *
 * Defensive scope-init (Pitfall #8 — jsonb drift defense; mirrors Plan 09-04
 * ConsentDialog W-5 fix). The initial checkbox state is ALWAYS derived from
 * the canonical DATA_TYPE_KEYS tuple. We never spread `membership.consent_scope`
 * directly — that would silently honor any extra keys (or silently drop keys
 * the row is missing), and the resulting payload would fail the server-side
 * `_validate_consent_scope` shape check anyway. By iterating DATA_TYPE_KEYS
 * we always render exactly 10 checkboxes regardless of what the row contains.
 *
 * On Save: calls `updateConsentScope({membership_id, consent_scope})` (Plan
 * 09-02 typed wrapper → `supabase.rpc('update_consent_scope', ...)`). Server
 * writes the `membership_scope_updated` audit_logs row (CLINIC-07 capture
 * half). Toast on success/failure is owned by the parent (the section needs
 * to coordinate the row's visual update with the toast).
 *
 * No `s.user!` non-null assertions anywhere in this file.
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { updateConsentScope } from '@/lib/clinic';
import {
  DATA_TYPE_KEYS,
  DATA_TYPE_LABELS,
  type ConsentScope,
  type Membership,
  type Org,
} from '@/types/clinic';

export type MembershipWithOrg = Membership & { organizations: Pick<Org, 'id' | 'name'> };

export interface EditConsentScopeModalProps {
  membership: MembershipWithOrg;
  onSaved: (consent_scope: ConsentScope) => void;
  onClose: () => void;
}

/**
 * Build a strict-shape ConsentScope from a (possibly drift-affected) jsonb
 * blob. Always iterates DATA_TYPE_KEYS so the result has exactly the 10
 * canonical keys, in canonical order, with boolean values.
 *
 * Missing keys default to `false` (silent under-share is safer than silent
 * over-share). Extra keys on the input are ignored. Non-boolean values are
 * coerced via `=== true` (a string `"true"` reads as false — Pitfall #8
 * mitigation).
 */
function buildInitialScope(raw: Partial<ConsentScope> | Record<string, unknown>): ConsentScope {
  return DATA_TYPE_KEYS.reduce(
    (acc, k) => ({ ...acc, [k]: (raw as Record<string, unknown>)[k] === true }),
    {} as ConsentScope,
  );
}

export function EditConsentScopeModal({
  membership,
  onSaved,
  onClose,
}: EditConsentScopeModalProps): React.ReactElement {
  const [scope, setScope] = useState<ConsentScope>(() => buildInitialScope(membership.consent_scope));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when membership changes (modal reused for a different row).
  useEffect(() => {
    setScope(buildInitialScope(membership.consent_scope));
    setError(null);
  }, [membership.id, membership.consent_scope]);

  const orgName = membership.organizations.name;

  const toggle = (key: (typeof DATA_TYPE_KEYS)[number]) => {
    setScope((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const res = await updateConsentScope({
      membership_id: membership.id,
      consent_scope: scope,
    });
    setBusy(false);
    if (res.ok) {
      onSaved(scope);
      onClose();
    } else {
      setError(res.error || 'unknown');
    }
  };

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={`What you share with ${orgName}`}
      size="md"
      mobileFullscreen
    >
      <div className="space-y-4">
        <p className="text-[13px] text-[var(--color-text-secondary)] leading-snug">
          Check or uncheck data types. Changes apply immediately.
        </p>

        <ul className="space-y-2 list-none p-0">
          {DATA_TYPE_KEYS.map((key) => {
            const meta = DATA_TYPE_LABELS[key];
            const checked = scope[key];
            return (
              <li key={key} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-[var(--color-primary)] cursor-pointer"
                    checked={checked}
                    onChange={() => toggle(key)}
                    disabled={busy}
                    aria-label={meta.label}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-semibold text-[var(--color-text)]">
                      {meta.label}
                    </span>
                    <span className="block text-[12px] text-[var(--color-text-secondary)] leading-snug">
                      {meta.description}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {error && (
          <p role="alert" className="text-[13px] text-[var(--color-danger)]">
            Couldn&apos;t save. Check your connection and try again.
          </p>
        )}

        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} loading={busy} disabled={busy}>
            Save changes
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default EditConsentScopeModal;
