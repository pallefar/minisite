/**
 * Phase 24 Plan 24-05 — SetupTotpPage.
 * Phase 66 Plan 66-03 — Refactored to thin wrapper around
 * `<TotpEnrollFlow mode="admin">`.
 *
 * D-06: On first admin request where profiles.has_totp is false, AdminLayout
 * renders this page instead of the admin shell. No grace window.
 *
 * D-07: TOTP via Supabase Auth mfa.enroll/challenge/verify.
 * D-08: 10 HMAC-hashed backup codes issued + shown ONCE after enrollment.
 *
 * All flow logic + UI now lives in `@/components/auth/TotpEnrollFlow`. This
 * file owns ONLY the admin-surface chrome (`<main>` background, centring,
 * `onComplete` adapter to the legacy `onComplete()` prop AdminLayout still
 * passes us).
 *
 * SPA routing: LeanShot uses hash routing (no react-router). SetupTotpPage
 * is rendered inline by AdminLayout — no hash route navigation needed here.
 * AdminLayout passes `onComplete` which triggers the re-render to AdminShell.
 */
import TotpEnrollFlow from '@/components/auth/TotpEnrollFlow';

interface SetupTotpPageProps {
  /** Called by AdminLayout after setup completes so the gate re-renders to AdminShell. */
  onComplete: () => void;
}

export default function SetupTotpPage({ onComplete }: SetupTotpPageProps) {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center p-6">
      <TotpEnrollFlow mode="admin" onSuccess={onComplete} />
    </main>
  );
}
