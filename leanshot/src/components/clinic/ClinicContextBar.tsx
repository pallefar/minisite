/**
 * Phase 9 Plan 09-02 + 09-08 — ClinicContextBar.
 *
 * Sticky top bar on every `/clinic/{slug}/*` route. Renders:
 *   - WorkspaceSwitcher (Plan 09-08 — real component; replaces the
 *     Plan 09-02 placeholder no-op button)
 *   - org logo (or monogram fallback if `logo_storage_path` is null)
 *     + org name (truncated to 32 chars with ellipsis) as a visual
 *     context indicator beside the switcher
 *   - settings link
 *
 * D-09 Pitfall #8 single-identity invariant: even with zero memberships
 * the switcher must show "Personal account" group; mounting the real
 * WorkspaceSwitcher here is the Phase 9 fulfillment of that invariant.
 */

import { Settings } from 'lucide-react';
import { useMemo } from 'react';
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher';
import { cn } from '@/lib/helpers';
import { supabase } from '@/lib/supabase';
import type { Org } from '@/types/clinic';

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

  const logoUrl = useMemo(() => {
    if (!org.logo_storage_path) return null;
    try {
      const { data } = supabase.storage.from('org-logos').getPublicUrl(org.logo_storage_path);
      return data?.publicUrl ?? null;
    } catch {
      return null;
    }
  }, [org.logo_storage_path]);

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
      <div
        data-testid="clinic-context-bar-org"
        className="flex items-center gap-2.5 min-w-0"
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={`${org.name} logo`}
            className="size-8 rounded-md object-cover"
          />
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
