// Phase 16 Plan 16-02 Task 4 — BiometricGate full-screen overlay (UI-SPEC
// Surface 2b + 2c).
//
// Mounts BEFORE app content paints when biometric unlock is enabled. On mount
// the OS biometric prompt is invoked immediately. On success → onUnlock().
// On failure → reveals manual CTA ("Use Face ID" iOS / "Use Fingerprint"
// Android) + "Use Password" link. After 3 consecutive biometric failures →
// auto-switches to password mode (Sub-surface 2c).
//
// CTA labels are NOUN-QUALIFIED per UI-SPEC §"Copywriting Contract":
//   - [Use Face ID] (iOS) / [Use Fingerprint] (Android)
//   - [Use Password] (fallback link)
//   - [Unlock App] (password submit)
// Bare single-word CTA labels are banned by the gate-grep in the Task 4
// done criteria — see the BiometricGate.test.tsx noun-qualified test case.
// (Surface 2d [Keep Biometrics] / [Disable Biometrics] belong to the
// Settings toggle — out of scope for this plan but documented for the
// downstream SettingsPage executor.)

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { HeroOrbital } from '@/illustrations/HeroOrbital';
import { authenticateWithBiometric } from '@/lib/native/biometric';
import { detectPlatform } from '@/lib/native/platform';

export interface BiometricGateProps {
  /** Called when biometric (or password) auth succeeds. Caller flips the gate-active boolean. */
  onUnlock: () => void;
  /** Caller wires this to Supabase signInWithPassword. Resolves on success, throws on wrong-password. */
  onPasswordSubmit: (password: string) => Promise<void>;
}

const MAX_BIOMETRIC_ATTEMPTS = 3;

// UI-SPEC §"Copywriting Contract" — noun-qualified CTA labels. Kept as
// module-level string literals so the plan's gate grep (`'Use Face ID'|...`)
// finds all four label sources in this file.
const LABEL_USE_FACE_ID = 'Use Face ID';
const LABEL_USE_FINGERPRINT = 'Use Fingerprint';
const LABEL_USE_PASSWORD = 'Use Password';
const LABEL_UNLOCK_APP = 'Unlock App';

function biometricCtaLabel(): string {
  const p = detectPlatform();
  if (p === 'android') return LABEL_USE_FINGERPRINT;
  // iOS + capacitor-web + web default to the iOS label per plan Task 4 spec.
  return LABEL_USE_FACE_ID;
}

export function BiometricGate({ onUnlock, onPasswordSubmit }: BiometricGateProps) {
  const [mode, setMode] = useState<'biometric' | 'password'>('biometric');
  // attempt counter is written via setter and read inside the setter callback;
  // we don't reference the value directly so the lint flags it. Prefix
  // intentionally unused to silence the rule while preserving state semantics.
  const [, setAttemptCount] = useState(0);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triedOnMountRef = useRef(false);

  // Auto-trigger biometric on first mount (UI-SPEC Surface 2b "Immediately
  // triggers OS biometric prompt on render").
  useEffect(() => {
    if (triedOnMountRef.current) return;
    triedOnMountRef.current = true;
    void runBiometric();
    // We intentionally exclude runBiometric from the dep array — it captures
    // setState identities that React guarantees stable, and we only want this
    // to fire ONCE per mount (not per state change). eslint-disable below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runBiometric() {
    const ok = await authenticateWithBiometric('Unlock LeanShot');
    if (ok) {
      onUnlock();
      return;
    }
    setAttemptCount((c) => {
      const next = c + 1;
      if (next >= MAX_BIOMETRIC_ATTEMPTS) {
        setMode('password');
      }
      return next;
    });
  }

  async function handlePasswordSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError(null);
    try {
      await onPasswordSubmit(password);
      onUnlock();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect password. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Unlock LeanShot"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[var(--color-bg)] px-6"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0)',
        paddingBottom: 'env(safe-area-inset-bottom, 0)',
      }}
    >
      <div className="flex flex-col items-center gap-6 max-w-sm w-full">
        <HeroOrbital className="h-12 w-12" staticOnly />
        <h1 className="text-[var(--text-xl)] font-bold text-[var(--color-text)] text-center">
          Unlock LeanShot
        </h1>

        {mode === 'biometric' ? (
          <div className="flex flex-col items-center gap-4 w-full">
            <Button
              variant="primary"
              block
              onClick={() => {
                void runBiometric();
              }}
            >
              {biometricCtaLabel()}
            </Button>
            <button
              type="button"
              onClick={() => setMode('password')}
              className="text-[var(--text-sm)] font-normal text-[var(--color-text-secondary)] min-h-[44px] px-2"
            >
              {LABEL_USE_PASSWORD}
            </button>
          </div>
        ) : (
          <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4 w-full">
            <Input
              type="password"
              label="Password"
              // UI-SPEC Surface 2c §"Focal point: Auto-focused password input
              // field" — autoFocus is intentional here as the gate is a
              // blocking full-screen unlock surface (role=dialog aria-modal),
              // so initial focus on the only actionable input matches user
              // intent and screen-reader expectation.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={error ?? undefined}
              autoComplete="current-password"
            />
            <Button type="submit" variant="primary" block loading={loading} aria-busy={loading}>
              {LABEL_UNLOCK_APP}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
