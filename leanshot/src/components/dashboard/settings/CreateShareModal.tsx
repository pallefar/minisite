/**
 * Phase 8 Plan 08-03 Task 2 — CreateShareModal.
 *
 * Two-step modal: form (label + expiry radio + disclosure) → in-place
 * transition to post-creation state (raw link + raw 6-digit code with
 * Copy buttons). Replaces the Task 1 placeholder of the same name.
 *
 * Threat T-08-I4 mitigation: `handleClose` explicitly zeroes raw_token,
 * raw_code, label, expiry. No localStorage persistence; modal state lives
 * in component scope only. Re-opening the modal shows a fresh empty form;
 * the raw secrets cannot be retrieved after close per Plan 08-01 RESEARCH
 * anti-pattern.
 *
 * Compliance grep (Phase 2 SC#5 carry-forward): zero CMIA-trigger term
 * matches enforced by the verify gate.
 *
 * Phase 6 D-12 / Phase 7 D-06 compliance: no non-null assertions on store
 * selectors. The modal does not read `s.user` directly — it's gated by the
 * parent ActiveSharesSection which already early-returns for null users.
 */

import { Link2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import { createShare, shareLinkFor } from '@/lib/shares';

export interface CreateShareModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (shareId: string) => void;
}

type ModalStep = 'form' | 'submitting' | 'success';

interface PostCreationData {
  raw_token: string;
  raw_code: string;
}

// Expiry options in seconds (24h / 7d / 30d). The default (7 days) matches
// 08-UI-SPEC §"Patient-side: Create share modal".
const EXPIRY_OPTIONS: Array<{ id: '24h' | '7d' | '30d'; label: string; seconds: number }> = [
  { id: '24h', label: '24 hours', seconds: 24 * 60 * 60 },
  { id: '7d', label: '7 days', seconds: 7 * 24 * 60 * 60 },
  { id: '30d', label: '30 days', seconds: 30 * 24 * 60 * 60 },
];
const DEFAULT_EXPIRY: (typeof EXPIRY_OPTIONS)[number]['id'] = '7d';

export function CreateShareModal({ open, onClose, onCreated }: CreateShareModalProps) {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [step, setStep] = useState<ModalStep>('form');
  const [label, setLabel] = useState('');
  const [expiryId, setExpiryId] = useState<typeof DEFAULT_EXPIRY>(DEFAULT_EXPIRY);
  const [postData, setPostData] = useState<PostCreationData | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the label input when the modal opens (form state).
  useEffect(() => {
    if (!open || step !== 'form') return;
    inputRef.current?.focus();
  }, [open, step]);

  // Reset all state when the modal closes (T-08-I4: zero raw_token + raw_code).
  function discardState(): void {
    setPostData(null);
    setLabel('');
    setExpiryId(DEFAULT_EXPIRY);
    setStep('form');
  }

  function handleClose(): void {
    discardState();
    onClose();
  }

  async function handleSubmit(): Promise<void> {
    if (!label.trim() || step === 'submitting') return;
    setStep('submitting');
    try {
      const opt = EXPIRY_OPTIONS.find((o) => o.id === expiryId) ?? EXPIRY_OPTIONS[1];
      const expires_at = new Date(Date.now() + opt.seconds * 1000).toISOString();
      const resp = await createShare({ label: label.trim(), expires_at });
      setPostData({ raw_token: resp.raw_token, raw_code: resp.raw_code });
      setStep('success');
      onCreated?.(resp.share_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      toastRef.current(`Couldn't create share: ${msg}`, 'error');
      // Retain the form — DO NOT clear label/expiry on error so the patient
      // can retry without re-typing.
      setStep('form');
    }
  }

  async function copyToClipboard(text: string, toastMsg: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toastRef.current(toastMsg, 'success');
    } catch {
      toastRef.current(`Couldn't copy. Long-press to select manually.`, 'error');
    }
  }

  const canSubmit = label.trim().length > 0 && step !== 'submitting';
  const submitting = step === 'submitting';

  return (
    <Modal open={open} onClose={handleClose} title="Create a share link" size="md">
      {step !== 'success' ? (
        <div className="space-y-4">
          <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
            Generate a private read-only link for a doctor. They&apos;ll need both the link and a
            6-digit code to open it.
          </p>

          <Input
            ref={inputRef}
            label="Who is this for?"
            placeholder="e.g. Dr. Smith — Q2 review"
            hint="Just for you — helps you remember which doctor this share is for."
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
            autoComplete="off"
            disabled={submitting}
          />

          <fieldset className="space-y-2" disabled={submitting}>
            <legend className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
              Expires
            </legend>
            <div className="flex flex-wrap gap-2">
              {EXPIRY_OPTIONS.map((opt) => {
                const active = expiryId === opt.id;
                return (
                  <label
                    key={opt.id}
                    className={`inline-flex items-center gap-2 rounded-pill border px-3 h-9 text-[13px] cursor-pointer ${
                      active
                        ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                        : 'bg-[var(--color-surface-elevated)] border-[var(--color-border)] text-[var(--color-text)]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="share-expiry"
                      value={opt.id}
                      checked={active}
                      onChange={() => setExpiryId(opt.id)}
                      className="sr-only"
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
            <p className="text-[12px] text-[var(--color-text-tertiary)] leading-snug">
              The doctor&apos;s access ends automatically when the share expires. You can also
              revoke at any time.
            </p>
          </fieldset>

          <details className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-3">
            <summary className="cursor-pointer text-[13px] font-semibold text-[var(--color-primary)]">
              What can the doctor see?
            </summary>
            <p className="mt-2 text-[12px] text-[var(--color-text-secondary)] leading-relaxed">
              Drug-level chart, your recent injections, symptoms, photos, weight log, and the doctor
              report. The doctor cannot see AI coach conversations, account settings, or anything
              you delete.
            </p>
          </details>

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                void handleSubmit();
              }}
              disabled={!canSubmit}
              loading={submitting}
              leadingIcon={<Link2 className="size-4" />}
            >
              Generate share
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-[18px] font-bold tracking-tight">Share ready</h2>
            <p className="text-[13px] text-[var(--color-text-secondary)] leading-snug">
              Send the doctor the link and the 6-digit code over different channels (e.g. link by
              email, code by text). The doctor needs both to open the share.
            </p>
          </div>

          <div className="rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-3 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
              Share link
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate text-[13px] font-mono text-[var(--color-text)]">
                {postData ? shareLinkFor(postData.raw_token) : ''}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (!postData) return;
                  void copyToClipboard(shareLinkFor(postData.raw_token), 'Link copied');
                }}
                aria-label="Copy link"
              >
                Copy link
              </Button>
            </div>
          </div>

          <div className="rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] p-3 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
              Access code
            </div>
            <div className="flex items-center gap-3">
              <div
                className="flex-1 text-[28px] font-mono numerals-tabular tracking-[0.25em] text-[var(--color-text)]"
                aria-label={`6-digit access code: ${postData?.raw_code ?? ''}`}
              >
                {postData?.raw_code ?? ''}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (!postData) return;
                  void copyToClipboard(postData.raw_code, 'Code copied');
                }}
                aria-label="Copy code"
              >
                Copy code
              </Button>
            </div>
          </div>

          <p className="text-[12px] text-[var(--color-text-tertiary)] leading-snug">
            The code can be used only once. If the doctor doesn&apos;t open the share in time, you
            can revoke this share and create a new one.
          </p>

          <div className="flex justify-end pt-2">
            <Button onClick={handleClose}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
