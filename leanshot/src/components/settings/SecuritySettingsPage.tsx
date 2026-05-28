/**
 * Phase 66 Plan 66-03 — Consumer security settings surface (AUTH-12).
 *
 * Route: `/settings/security`.
 *
 * Sections (per UI-SPEC §66-03):
 *   1. Two-factor authentication — wraps <TotpEnrollFlow mode="consumer"> when
 *      not enrolled; shows "On since <date>" badge + Re-enroll + View backup
 *      codes when enrolled.
 *   2. Trusted devices — Phase 70 stub (empty state only).
 *   3. Active sessions — best-effort listing; gracefully degrades when the
 *      Supabase API for session listing isn't exposed to client.
 *
 * Auth gate: caller (App.tsx) routes anonymous users to /auth before
 * landing here. This component assumes a signed-in user.
 */
import { useCallback, useEffect, useState } from 'react';
import TotpEnrollFlow from '@/components/auth/TotpEnrollFlow';
import { Card, CardHeader } from '@/components/ui/Card';
import { listEnrolledFactors, unenrollFactor, type MfaFactor } from '@/lib/auth/totp-shared';

type LoadState = 'loading' | 'ready' | 'error';

export default function SecuritySettingsPage() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [reEnrollPending, setReEnrollPending] = useState(false);

  const refresh = useCallback(async () => {
    setLoadState('loading');
    setErrorMsg('');
    try {
      const result = await listEnrolledFactors();
      setFactors(result);
      setLoadState('ready');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Could not load MFA status.');
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enrolled = factors.length > 0 && !reEnrollPending;
  const primaryFactor = factors[0];

  async function handleReEnroll() {
    if (!primaryFactor) return;
    setReEnrollPending(true);
    try {
      await unenrollFactor(primaryFactor.id);
      setFactors([]);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Could not start re-enrollment.');
      setReEnrollPending(false);
    }
  }

  function handleEnrollSuccess() {
    setReEnrollPending(false);
    void refresh();
  }

  return (
    <main
      className="min-h-screen bg-[var(--color-bg)] py-8 px-4 sm:px-6 lg:px-8"
      data-testid="security-settings-page"
    >
      <div className="max-w-2xl mx-auto">
        <h1 className="text-heading font-display font-semibold text-text mb-6">Security</h1>

        {loadState === 'loading' && (
          <Card variant="flat" padding="lg" className="mb-4">
            <p className="text-sm text-text-secondary" role="status">
              Loading security settings…
            </p>
          </Card>
        )}

        {loadState === 'error' && (
          <Card variant="flat" padding="lg" className="mb-4">
            <p className="text-sm text-danger" role="alert">
              {errorMsg}
            </p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-3 py-2 px-4 rounded-lg bg-primary text-primary-foreground font-semibold text-sm"
            >
              Try again
            </button>
          </Card>
        )}

        {loadState === 'ready' && (
          <>
            {/* Section 1: Two-factor authentication */}
            <section className="mb-6" aria-labelledby="mfa-heading">
              <Card variant="flat" padding="lg">
                <CardHeader title="Two-factor authentication" />
                <p className="text-sm text-text-secondary mb-4" id="mfa-heading-help">
                  Add a second step to sign-in using a code from your phone&apos;s authenticator
                  app. Protects against compromised passwords.
                </p>

                {enrolled ? (
                  <MfaEnrolledPanel
                    factor={primaryFactor!}
                    onReEnroll={() => void handleReEnroll()}
                  />
                ) : (
                  <TotpEnrollFlow mode="consumer" onSuccess={handleEnrollSuccess} />
                )}
              </Card>
            </section>

            {/* Section 2: Trusted devices (Phase 70 stub) */}
            {enrolled && (
              <section className="mb-6" aria-labelledby="trusted-devices-heading">
                <Card variant="flat" padding="lg">
                  <CardHeader title="Trusted devices" />
                  <p className="text-sm text-text-secondary" id="trusted-devices-empty">
                    No trusted devices yet.
                  </p>
                </Card>
              </section>
            )}

            {/* Section 3: Active sessions (best-effort stub) */}
            <section aria-labelledby="active-sessions-heading">
              <Card variant="flat" padding="lg">
                <CardHeader title="Active sessions" />
                <p className="text-sm text-text-secondary">
                  Session management is coming in a future release. Sign out from individual devices
                  using the device&apos;s own browser controls for now.
                </p>
              </Card>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// MFA enrolled panel — green badge + Re-enroll + View backup codes CTAs.
// ---------------------------------------------------------------------------

interface MfaEnrolledPanelProps {
  factor: MfaFactor;
  onReEnroll: () => void;
}

function MfaEnrolledPanel({ factor, onReEnroll }: MfaEnrolledPanelProps) {
  const [confirmReEnroll, setConfirmReEnroll] = useState(false);

  // Phase 66 D-02: display the date the factor was created (verified).
  const since = factor.created_at ? formatSince(factor.created_at) : null;
  const badgeText = since ? `On since ${since}` : 'On';

  return (
    <div>
      <div className="flex items-center gap-3 mb-4" data-testid="mfa-enrolled-badge">
        <span className="inline-flex items-center px-3 py-1 rounded-full bg-success-soft text-success text-sm font-semibold">
          {badgeText}
        </span>
      </div>

      {!confirmReEnroll ? (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setConfirmReEnroll(true)}
            className="py-2.5 px-4 rounded-lg border border-border text-text font-semibold text-sm"
          >
            Re-enroll
          </button>
        </div>
      ) : (
        <div
          className="rounded-lg border border-border bg-surface-soft p-4"
          role="alertdialog"
          aria-labelledby="re-enroll-confirm-heading"
        >
          <p id="re-enroll-confirm-heading" className="text-sm font-semibold mb-2">
            Re-enroll 2FA?
          </p>
          <p className="text-sm text-text-secondary mb-3">
            This removes your current authenticator factor and any existing backup codes. You will
            need to scan a new QR code and save a fresh set of backup codes.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onReEnroll}
              className="py-2 px-4 rounded-lg bg-primary text-primary-foreground font-semibold text-sm"
            >
              Yes, re-enroll
            </button>
            <button
              type="button"
              onClick={() => setConfirmReEnroll(false)}
              className="py-2 px-4 rounded-lg border border-border text-text font-semibold text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatSince(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}
