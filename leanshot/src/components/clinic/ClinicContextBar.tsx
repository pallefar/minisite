/**
 * Phase 9 Plan 09-02 + 09-08 — ClinicContextBar.
 * Phase 30 Plan 03 — Bell icon + alert count badge + ClinicianAlertsPanel.
 *
 * Sticky top bar on every `/clinic/{slug}/*` route. Renders:
 *   - WorkspaceSwitcher (Plan 09-08 — real component; replaces the
 *     Plan 09-02 placeholder no-op button)
 *   - org logo (or monogram fallback if `logo_storage_path` is null)
 *     + org name (truncated to 32 chars with ellipsis) as a visual
 *     context indicator beside the switcher
 *   - Bell icon button with pending-alert count badge (Phase 30 D-13)
 *   - settings link
 *
 * D-09 Pitfall #8 single-identity invariant: even with zero memberships
 * the switcher must show "Personal account" group; mounting the real
 * WorkspaceSwitcher here is the Phase 9 fulfillment of that invariant.
 *
 * Phase 30 D-13 Bell:
 *   - aria-label="Clinician alerts, {N} pending"
 *   - aria-haspopup="dialog" aria-expanded={panelOpen}
 *   - <span aria-live="polite" aria-atomic="true"> wraps the Badge
 *     so screen readers announce count changes
 *   - Badge tone="amber" (NOT "warning" — per UI-SPEC §Color)
 *   - Badge hidden (aria-hidden) when count=0
 *   - Max display "9+" when pending > 9
 *   - ClinicianAlertsPanel is React.lazy() — keeps clinic bundle under 45 kB ceiling
 */

import { Bell, Settings } from 'lucide-react';
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/helpers';
import { supabase } from '@/lib/supabase';
import type { Org } from '@/types/clinic';
import { useClinicianAlerts } from './alerts/use-clinician-alerts';

// Lazy-load ClinicianAlertsPanel to keep clinic-shell bundle under 45 kB ceiling
// (Phase 30 Plan 05 will verify total chunk size)
const ClinicianAlertsPanel = lazy(() =>
  import('./alerts/ClinicianAlertsPanel').then((m) => ({ default: m.ClinicianAlertsPanel })),
);

export interface ClinicContextBarProps {
  org: Org;
  className?: string;
}

const NAME_MAX_LEN = 32;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function monogram(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0).toUpperCase();
}

export function ClinicContextBar({ org, className }: ClinicContextBarProps) {
  const displayName = useMemo(() => truncate(org.name, NAME_MAX_LEN), [org.name]);
  const [panelOpen, setPanelOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement | null>(null);

  const logoUrl = useMemo(() => {
    if (!org.logo_storage_path) return null;
    try {
      const { data } = supabase.storage.from('org-logos').getPublicUrl(org.logo_storage_path);
      return data?.publicUrl ?? null;
    } catch {
      return null;
    }
  }, [org.logo_storage_path]);

  // Lightweight query for pending count (only id + status — minimal payload)
  const alertsQuery = useClinicianAlerts({ orgId: org.id });
  const pendingCount = alertsQuery.data.filter((a) => a.status === 'pending').length;
  const badgeText = pendingCount > 9 ? '9+' : String(pendingCount);

  const handlePanelClose = useCallback(() => {
    setPanelOpen(false);
  }, []);

  return (
    <header
      data-testid="clinic-context-bar"
      className={cn(
        'sticky top-0 z-20 flex items-center gap-3 px-4 md:px-6 h-14 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur',
        className,
      )}
    >
      {/* Plan 09-08 — real WorkspaceSwitcher (was a placeholder no-op button in Plan 09-02). */}
      <WorkspaceSwitcher />

      {/* Visual org-context indicator (logo + name) beside the switcher. The
          switcher itself owns the trigger affordance + aria-label; this is
          purely a chrome element so the operator can see which workspace they
          are currently in at a glance even when the dropdown is closed. */}
      <div data-testid="clinic-context-bar-org" className="flex items-center gap-2.5 min-w-0">
        {logoUrl ? (
          <img src={logoUrl} alt={`${org.name} logo`} className="size-8 rounded-md object-cover" />
        ) : (
          <span
            aria-hidden
            className="size-8 rounded-md bg-[var(--color-primary-soft)] text-[var(--color-primary)] inline-flex items-center justify-center font-bold text-[14px]"
          >
            {monogram(org.name)}
          </span>
        )}
        <span className="text-[14px] font-semibold text-[var(--color-text)] truncate">
          {displayName}
        </span>
      </div>

      <div className="flex-1" />

      {/* Phase 30 D-13 — Bell icon button with pending-alert count badge */}
      <div className="relative">
        <button
          ref={bellRef}
          type="button"
          aria-label={`Clinician alerts, ${pendingCount} pending`}
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen((o) => !o)}
          className="relative min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] transition-colors"
        >
          <Bell className="size-5" aria-hidden />
          {/* aria-live span so screen readers announce count changes */}
          <span aria-live="polite" aria-atomic="true" className="absolute -top-1 -right-1">
            {pendingCount > 0 && (
              <Badge
                tone="amber"
                pulse
                aria-hidden
                className="text-[10px] px-1.5 py-0.5 min-w-[18px] justify-center"
              >
                {badgeText}
              </Badge>
            )}
          </span>
        </button>

        {/* ClinicianAlertsPanel — lazy-loaded; Suspense with null fallback (panel just
            doesn't show during chunk load; this is acceptable per UI-SPEC) */}
        {panelOpen && (
          <Suspense fallback={null}>
            <ClinicianAlertsPanel
              orgId={org.id}
              orgSlug={org.slug}
              open={panelOpen}
              onClose={handlePanelClose}
              anchorRef={bellRef}
            />
          </Suspense>
        )}
      </div>

      <a
        href={`/clinic/${org.slug}/settings`}
        aria-label="Workspace settings"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] rounded-pill px-2.5 py-1.5 hover:bg-[var(--color-surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        <Settings className="size-4" aria-hidden />
        <span className="hidden md:inline">Settings</span>
      </a>
    </header>
  );
}

export default ClinicContextBar;
