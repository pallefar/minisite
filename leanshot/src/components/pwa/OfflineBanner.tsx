/**
 * Phase 42 Plan 04 (D-13) — Offline banner.
 *
 * Renders a top-fixed banner with the verbatim D-13 copy when
 * `navigator.onLine === false`. Logging surfaces (Wave 3) read
 * `disableLogging()` from offline-store.ts to gate their submit buttons.
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
      You&rsquo;re offline &mdash; logging resumes when reconnected.
    </div>
  );
}
