/**
 * Phase 35 Plan 35-05 — D-10 FreezeTokenGrant admin component.
 *
 * Allows support admins to grant freeze tokens to a specific user (by email).
 * D-10 ethics: freeze tokens are NEVER for sale — admin grants only for support cases.
 * Logged in freeze_tokens_ledger with granted_by_admin_user_id for audit.
 *
 * Surface gate: admin.gamification.freeze_tokens.grant
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

interface FormState {
  email: string;
  delta: 1 | 2;
  reason_note: string;
}

const DEFAULT_FORM: FormState = { email: '', delta: 1, reason_note: '' };

export default function FreezeTokenGrant() {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const canSubmit =
    !submitting &&
    form.email.trim().includes('@') &&
    form.reason_note.trim().length >= 3;

  async function resolveUserIdByEmail(email: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .limit(1)
      .single();
    if (error || !data) return null;
    return (data as { id: string }).id;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null);
    setSubmitting(true);
    try {
      const userId = await resolveUserIdByEmail(form.email);
      if (!userId) {
        setEmailError('No user found with that email address');
        return;
      }

      const { error } = await supabase.functions.invoke('admin-grant-freeze-token', {
        body: {
          target_user_id: userId,
          delta: form.delta,
          reason_note: form.reason_note.trim(),
        },
      });

      if (error) {
        if (error.message.includes('forbidden') || error.message.includes('403')) {
          toast('You need admin access to grant freeze tokens', 'error');
        } else if (error.message.includes('cap_exceeded')) {
          toast('User is already at the maximum freeze token stockpile (3)', 'error');
        } else {
          toast(`Could not grant freeze tokens: ${error.message}`, 'error');
        }
        return;
      }

      toast(
        `Granted ${form.delta} freeze token${form.delta > 1 ? 's' : ''} to ${form.email}`,
        'success',
      );
      setForm(DEFAULT_FORM);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* D-10 ethical advisory */}
      <Card variant="flat" padding="lg" className="border-l-4 border-[var(--color-warning)] bg-[var(--color-surface-elevated)]">
        <p className="text-sm font-semibold mb-1">Ethical mechanic — not for sale</p>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Freeze tokens are a free ethical mechanic to protect user streaks.
          Admin grants are only for legitimate support cases (e.g., app outage, verified
          technical issue). Tokens are never sold, never incentivized, never used
          as a retention lever. Every grant is audit-logged with your account ID.
        </p>
      </Card>

      <Card variant="elevated" padding="lg">
        <h3 className="text-base font-semibold mb-4">Grant freeze tokens</h3>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="freeze-email" className="text-sm font-medium">
              User email
            </label>
            <input
              id="freeze-email"
              type="email"
              value={form.email}
              onChange={(e) => {
                setForm((f: FormState) => ({ ...f, email: e.target.value }));
                if (emailError) setEmailError(null);
              }}
              placeholder="user@example.com"
              aria-invalid={emailError ? 'true' : undefined}
              className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
            />
            {emailError && (
              <p className="text-xs text-[var(--color-error)]" role="alert">
                {emailError}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="freeze-delta" className="text-sm font-medium">
              Tokens to grant
            </label>
            <select
              id="freeze-delta"
              value={form.delta}
              onChange={(e) => setForm((f: FormState) => ({ ...f, delta: Number(e.target.value) as 1 | 2 }))}
              className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
            >
              <option value={1}>1 token</option>
              <option value={2}>2 tokens</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="freeze-reason" className="text-sm font-medium">
              Reason / support note
            </label>
            <textarea
              id="freeze-reason"
              value={form.reason_note}
              onChange={(e) => setForm((f: FormState) => ({ ...f, reason_note: e.target.value }))}
              placeholder="e.g. App outage on 2026-05-21 prevented user from logging"
              rows={3}
              className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm resize-y"
            />
          </div>

          <Button type="submit" disabled={!canSubmit} aria-busy={submitting}>
            {submitting ? 'Granting…' : 'Grant tokens'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
