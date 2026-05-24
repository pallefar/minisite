/**
 * Phase 48 Plan 11 — AccountSuspended consumer blocker.
 *
 * Rendered by App.tsx top-level view selector when
 * useStore((s) => s.userModerationStatus) in ('banned','temp_suspended').
 *
 * Appeal path: mailto:support@leanshot.app.
 */
import { Card } from '@/components/ui/Card';
import { useStore } from '@/lib/store';

export default function AccountSuspended() {
  const status = useStore((s) => s.userModerationStatus);
  const expires = useStore((s) => s.userModerationExpiresAt);
  const reason = useStore((s) => s.userModerationReason);

  const heading =
    status === 'temp_suspended' && expires
      ? `Account suspended until ${new Date(expires).toLocaleString()}`
      : 'Account suspended';

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="account-suspended-heading"
      className="min-h-screen flex items-center justify-center p-4"
    >
      <Card variant="elevated" className="max-w-md w-full">
        <h1 id="account-suspended-heading" className="text-2xl font-semibold mb-3">
          {heading}
        </h1>
        {reason ? (
          <p className="text-secondary mb-4">{reason}</p>
        ) : (
          <p className="text-secondary mb-4">
            Your account access has been restricted by community moderators.
          </p>
        )}
        <p className="text-sm text-secondary">
          Questions? Contact{' '}
          <a
            href="mailto:support@leanshot.app"
            className="text-accent underline focus:outline-none focus:ring-2 focus:ring-accent"
          >
            support@leanshot.app
          </a>
        </p>
      </Card>
    </div>
  );
}
