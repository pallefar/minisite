/**
 * Phase 24 Plan 24-03 (stub) → Phase 24 Plan 24-05 (augmented) — SettingsModule.
 *
 * Settings admin module. Augmented in Plan 24-05 with:
 *   - Enrolled MFA status display (via mfa.listFactors()).
 *   - "Regenerate backup codes" button → calls admin.issue_backup_codes RPC.
 *   - "Reset 2FA" button (superadmin-only, self-reset) → calls admin.reset_totp.
 *
 * Pattern S1 (server layer): all RPCs independently check aal2 + role at DB level.
 * This component shows/hides buttons based on adminRole for UX clarity only.
 */
import { useState, useEffect } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';

interface MfaStatus {
  enrolled: boolean;
  factorCount: number;
}

interface SettingsModuleProps {
  /** Admin role of the current user — injected by AdminShell or legacy wrapper. */
  adminRole?: string | null;
}

export default function SettingsModule({ adminRole }: SettingsModuleProps) {
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // ---------------------------------------------------------------------------
  // Load MFA status
  // ---------------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error || !data) return;
      const totp = data.totp ?? [];
      setMfaStatus({ enrolled: totp.length > 0, factorCount: totp.length });
    })().catch(() => { /* best-effort */ });
  }, []);

  // ---------------------------------------------------------------------------
  // Regenerate backup codes
  // ---------------------------------------------------------------------------
  async function handleRegenerate() {
    setRegenerating(true);
    setErrorMsg('');
    setNewCodes(null);
    const { data, error } = await supabase.rpc('issue_backup_codes');
    setRegenerating(false);
    if (error || !data) {
      setErrorMsg(error?.message ?? 'Failed to regenerate backup codes.');
      return;
    }
    setNewCodes(data as string[]);
  }

  // ---------------------------------------------------------------------------
  // Self-reset 2FA (superadmin-only)
  // ---------------------------------------------------------------------------
  async function handleSelfReset() {
    if (!confirm('This will remove your 2FA factor and send you a new enrollment email. Continue?')) {
      return;
    }
    setResetPending(true);
    setErrorMsg('');
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) {
      setErrorMsg('Not authenticated.');
      setResetPending(false);
      return;
    }
    const { error } = await supabase.rpc('reset_totp', { p_target_user_id: uid });
    setResetPending(false);
    if (error) {
      setErrorMsg(error.message ?? 'Reset failed.');
      return;
    }
    setResetDone(true);
  }

  const isSuperadmin = adminRole === 'superadmin';

  return (
    <div className="space-y-6 max-w-xl">
      {/* MFA Status */}
      <Card variant="flat" padding="lg">
        <CardHeader title="Two-Factor Authentication" />

        <div className="mb-4">
          {mfaStatus === null ? (
            <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
          ) : mfaStatus.enrolled ? (
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500" aria-hidden="true" />
              <p className="text-sm text-[var(--color-text)]">
                2FA active — {mfaStatus.factorCount} TOTP factor{mfaStatus.factorCount !== 1 ? 's' : ''} enrolled
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-500" aria-hidden="true" />
              <p className="text-sm text-[var(--color-text-secondary)]">
                2FA not enrolled — you will be prompted to set it up on next access.
              </p>
            </div>
          )}
        </div>

        {errorMsg && (
          <p className="text-sm text-[var(--color-error,red)] mb-3" role="alert">{errorMsg}</p>
        )}

        {/* Regenerate backup codes */}
        {mfaStatus?.enrolled && (
          <div className="mt-4">
            <button
              type="button"
              disabled={regenerating}
              onClick={() => { void handleRegenerate(); }}
              className="text-sm font-semibold text-[var(--color-primary)] hover:underline disabled:opacity-50"
              aria-busy={regenerating}
            >
              {regenerating ? 'Generating…' : 'Regenerate backup codes'}
            </button>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1">
              Generates 10 new backup codes. Previous unused codes are invalidated.
            </p>
          </div>
        )}

        {/* Show new codes once generated */}
        {newCodes && (
          <div className="mt-4">
            <p className="text-sm font-semibold mb-2">
              Your new backup codes (save them — shown only once):
            </p>
            <div className="grid grid-cols-2 gap-1.5 font-mono text-xs">
              {newCodes.map((code) => (
                <div
                  key={code}
                  className="px-2.5 py-1.5 bg-[var(--color-surface-elevated)] border border-[var(--color-border)] rounded text-center"
                >
                  {code}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reset 2FA — superadmin self-reset */}
        {isSuperadmin && mfaStatus?.enrolled && !resetDone && (
          <div className="mt-6 pt-4 border-t border-[var(--color-border)]">
            <p className="text-xs text-[var(--color-text-secondary)] mb-2">
              <strong>Danger zone (superadmin only):</strong> Reset your own 2FA. You will be
              logged out and emailed a new enrollment link. Every reset is audit-logged.
            </p>
            <button
              type="button"
              disabled={resetPending}
              onClick={() => { void handleSelfReset(); }}
              className="text-sm font-semibold text-red-500 hover:underline disabled:opacity-50"
              aria-busy={resetPending}
            >
              {resetPending ? 'Resetting…' : 'Reset my 2FA'}
            </button>
          </div>
        )}

        {resetDone && (
          <p className="mt-4 text-sm text-green-600">
            2FA reset. Check your email for a new enrollment link.
          </p>
        )}
      </Card>
    </div>
  );
}
