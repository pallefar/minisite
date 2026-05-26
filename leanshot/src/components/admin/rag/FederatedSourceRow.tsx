/**
 * Phase 60 Plan 60-09 — FederatedSourceRow.
 *
 * Per-source admin row: display name, sync cadence, last-sync relative time,
 * last-error pill (when non-null), and enabled/disabled toggle switch.
 *
 * Option D resolution (orchestrator decision 2026-05-26):
 *   "Pull full history" button is rendered DISABLED with a tooltip.
 *   The 60-07 service-role-gated architecture finding and Option D deferral:
 *     - The historical pull Fn (rag-federated-*) invoked via admin browser call
 *       requires an admin-action-token auth mechanism that is deferred to 60-15.
 *     - Until 60-15 ships the admin-action-token pattern, the button must remain
 *       disabled to prevent unauthenticated/under-authorized historical pulls.
 *     - When 60-15 lands: remove disabled + title attributes, wire onTriggerPull.
 *   Carry-over: "ship admin-action-token mechanism + wire Pull-history button".
 *
 * A11y:
 *   - Toggle: role="switch" + aria-checked + aria-label per UI-SPEC §2.
 *   - Last-sync text: role="status" + aria-live="polite" per UI-SPEC §2.
 *   - Error pill: React auto-escape (no dangerouslySetInnerHTML).
 *
 * Typography: 11/13/18 only — no text-base or text-md.
 */

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SOURCE_META, type FederatedSource } from '@/lib/admin/rag/federated-api';

// ─── Relative time ────────────────────────────────────────────────────────────

/** Returns a human-readable relative time string using Intl.RelativeTimeFormat. */
function formatRelative(iso: string | null): string {
  if (!iso) return 'Never synced';
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const diffSec = diffMs / 1000;

  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) {
    const mins = Math.floor(diffSec / 60);
    return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  }
  if (diffSec < 86400) {
    const hrs = Math.floor(diffSec / 3600);
    return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(diffSec / 86400);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Truncate a string to maxLen chars, appending ellipsis if truncated. */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…';
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface FederatedSourceRowProps {
  source: FederatedSource;
  onToggle: (enabled: boolean) => void;
  onTriggerPull: () => void;
  isToggleBusy: boolean;
  isPullBusy: boolean;
}

export function FederatedSourceRow({
  source,
  onToggle,
  isToggleBusy,
}: FederatedSourceRowProps) {
  const meta = SOURCE_META[source.name];
  const relativeTime = formatRelative(source.last_sync_at);

  const handleToggle = (): void => {
    onToggle(!source.enabled);
  };

  return (
    <Card variant="default">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-6">

        {/* Left: source identity */}
        <div className="flex-1 min-w-0">
          <h3 className="text-[18px] font-semibold leading-tight truncate">
            {meta.display_name}
          </h3>
          <p className="mt-0.5 text-[13px] text-[var(--color-text-secondary)]">
            {meta.sync_cadence_label}
          </p>
        </div>

        {/* Center: sync status + last error */}
        <div className="flex flex-col gap-1.5">
          {/* Last-sync: aria-live so screen readers announce updates after toggle/pull */}
          <p
            role="status"
            aria-live="polite"
            className="text-[13px] text-[var(--color-text-secondary)]"
          >
            Last sync: {relativeTime}
          </p>

          {source.last_error && (
            <Badge tone="warning" className="self-start">
              {/* Last error: prefix + truncated message; React auto-escapes the string */}
              Last error: {truncate(source.last_error, 80)}
            </Badge>
          )}
        </div>

        {/* Right: toggle switch */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={source.enabled}
            aria-label={`Enable ${meta.display_name} sync`}
            disabled={isToggleBusy}
            onClick={handleToggle}
            className={[
              'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
              'transition-colors duration-200 ease-in-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2',
              'disabled:pointer-events-none disabled:opacity-50',
              source.enabled
                ? 'bg-[var(--color-primary)]'
                : 'bg-[var(--color-surface-elevated)] border border-[var(--color-border)]',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className={[
                'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0',
                'transition duration-200 ease-in-out',
                source.enabled ? 'translate-x-5' : 'translate-x-0',
              ].join(' ')}
            />
          </button>

          <span className="text-[13px] text-[var(--color-text-secondary)]">
            {source.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      </div>

      {/* Footer: Pull full history (Option D: disabled — deferred to 60-15) */}
      <div className="px-4 pb-4 pt-0">
        {/*
         * OPTION D DEFERRAL (2026-05-26):
         * This button is intentionally DISABLED pending the admin-action-token
         * auth mechanism planned for 60-15 (phase close-out).
         *
         * Background (60-07 architecture finding):
         *   The rag-federated-{pubmed,openfda,dailymed} Edge Fns were designed
         *   for cron invocation with service-role auth. A browser-initiated
         *   historical pull requires an additional auth layer (admin-action-token)
         *   that validates the request is from an authenticated staff member with
         *   explicit intent — not just a JWT bearer.
         *
         * When 60-15 ships the admin-action-token mechanism:
         *   1. Remove `disabled` and `title` attributes from this button.
         *   2. Wire the `onClick` to call `onTriggerPull()`.
         *   3. Add a PullHistoryConfirmDialog for cost-warning confirmation.
         */}
        <Button
          variant="ghost"
          size="sm"
          disabled
          title="Coming soon — admin-token auth deferred to phase close-out (60-15)"
          aria-disabled="true"
        >
          Pull full history
        </Button>
      </div>
    </Card>
  );
}
