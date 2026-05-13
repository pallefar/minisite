/**
 * Phase 9 Plan 09-02 — ClinicContextBar.
 *
 * Sticky top bar on every `/clinic/{slug}/*` route. Renders:
 *   - org logo (or monogram fallback if `logo_storage_path` is null)
 *   - org name (truncated to 32 chars with ellipsis)
 *   - WorkspaceSwitcher trigger placeholder (no-op button — the real
 *     switcher dropdown ships in Plan 09-08; this preserves the visible
 *     affordance + correct aria-label so screen readers behave the same)
 *   - settings link
 *
 * D-09 Pitfall #8 single-identity invariant: even with zero memberships
 * the switcher must show "Personal account" group; the trigger is
 * always rendered.
 */

import { Settings } from 'lucide-react';
import { useMemo } from 'react';
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
      {/* WorkspaceSwitcher trigger placeholder — Plan 09-08 wires the dropdown */}
      <button
        type="button"
        aria-label={`Switch workspace. Currently in ${org.name}.`}
        aria-haspopup="listbox"
        aria-expanded="false"
        data-testid="workspace-switcher-trigger"
        className="flex items-center gap-2.5 rounded-pill px-2 py-1 hover:bg-[var(--color-surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        onClick={() => {
          /* Plan 09-08 opens the workspace switcher dropdown here. */
        }}
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
        <span className="text-[14px] font-semibold text-[var(--color-text)]">{displayName}</span>
      </button>

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
