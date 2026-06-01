/**
 * Phase 42 Plan 04 (D-13) — Offline banner.
 *
 * Renders a top-fixed banner when `navigator.onLine === false`. LeanShot is
 * local-first (CLAUDE.md: "Users without an account, or offline, must still be
 * able to log and view their data"), so the copy reassures the user that
 * logging keeps working on-device and syncs once the connection returns —
 * it does NOT imply logging is paused or disabled.
 *
 * a11y: role="status" + aria-live="polite" so a screen reader announces the
 * state change without interrupting the user. Wrap with sr-only / DS tokens
 * matching the project's existing toast pattern (src/components/ui/Toast.tsx).
 */
import { useOfflineState } from '@/hooks/useOfflineState';

export function OfflineBanner() {
  const { isOffline } = useOfflineState();
  if (!isOffline) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      className="fixed top-0 inset-x-0 z-[80] bg-[var(--color-warn-bg,#FEF3C7)] text-[var(--color-warn-fg,#7C2D12)] text-sm font-medium px-4 py-2 text-center shadow-sm"
    >
      You&rsquo;re offline &mdash; your data is saved on this device and will sync when you&rsquo;re
      back online.
    </div>
  );
}
