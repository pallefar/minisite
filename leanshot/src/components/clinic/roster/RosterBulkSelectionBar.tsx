/**
 * Phase 10 Plan 10-10 — RosterBulkSelectionBar.
 *
 * Renders a pill-shaped bar at the top-right of the roster card (or fixed-bottom
 * bar on mobile) when ≥1 patient is selected. Shows count + Clear + Actions menu.
 *
 * D-23: "X selected · Clear · Actions ▾" pill. Action menu has 3 items:
 *   1. Generate PDF
 *   2. Export as CSV
 *   3. Open all in tabs
 *
 * On action selection, the respective Flow component opens (passed as callbacks).
 *
 * PostHog: fires clinic_bulk_selected on render + clinic_bulk_action_executed
 * when an action is confirmed (fired by the Flow components; this component
 * fires clinic_bulk_selected when the action menu opens).
 */
import { useRef, useState } from 'react';

import { ChevronDown, FileSpreadsheet, FileText, X } from 'lucide-react';

import { cn } from '@/lib/helpers';
import { CLINIC_EVENTS } from '@/lib/clinic-events';

export type BulkAction = 'pdf' | 'csv' | 'tabs';

export interface RosterBulkSelectionBarProps {
  count: number;
  onClear: () => void;
  onPDF: () => void;
  onCSV: () => void;
  onOpenTabs: () => void;
}

export function RosterBulkSelectionBar({
  count,
  onClear,
  onPDF,
  onCSV,
  onOpenTabs,
}: RosterBulkSelectionBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleActionClick = (action: BulkAction) => {
    setMenuOpen(false);

    // Fire PHI-safe PostHog event
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).posthog?.capture(CLINIC_EVENTS.BULK_SELECTED, {
        count,
        action_planned: action,
      });
    } catch {
      // PostHog unavailable
    }

    if (action === 'pdf') onPDF();
    else if (action === 'csv') onCSV();
    else onOpenTabs();
  };

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-xl',
        'bg-[var(--color-primary)] text-white text-[13px] font-medium',
        'shadow-lg',
        // Mobile: fixed bottom bar
        'fixed bottom-4 left-4 right-4 md:static md:left-auto md:right-auto md:bottom-auto',
        'z-40',
      )}
      data-testid="bulk-selection-bar"
    >
      {/* Count */}
      <span className="flex-1 truncate">
        {count} selected
      </span>

      {/* Clear button */}
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[12px]',
          'hover:bg-white/20 transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
        )}
      >
        <X size={12} aria-hidden />
        Clear
      </button>

      {/* Actions menu */}
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Bulk actions menu"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          className={cn(
            'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px]',
            'bg-white/20 hover:bg-white/30 transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
          )}
        >
          Actions
          <ChevronDown size={12} aria-hidden />
        </button>

        {menuOpen && (
          <div
            className={cn(
              'absolute right-0 bottom-full mb-2 w-48',
              'bg-[var(--color-surface)] rounded-xl shadow-xl',
              'border border-[var(--color-border)]',
              'py-1 z-50',
            )}
            role="menu"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => handleActionClick('pdf')}
              className={cn(
                'flex items-center gap-2 w-full px-4 py-2.5',
                'text-left text-[13px] text-[var(--color-text)]',
                'hover:bg-[var(--color-surface-elevated)] transition-colors',
              )}
              data-testid="bulk-action-pdf"
            >
              <FileText size={14} aria-hidden />
              Generate bulk PDF
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => handleActionClick('csv')}
              className={cn(
                'flex items-center gap-2 w-full px-4 py-2.5',
                'text-left text-[13px] text-[var(--color-text)]',
                'hover:bg-[var(--color-surface-elevated)] transition-colors',
              )}
              data-testid="bulk-action-csv"
            >
              <FileSpreadsheet size={14} aria-hidden />
              Export symptoms as CSV
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => handleActionClick('tabs')}
              className={cn(
                'flex items-center gap-2 w-full px-4 py-2.5',
                'text-left text-[13px] text-[var(--color-text)]',
                'hover:bg-[var(--color-surface-elevated)] transition-colors',
              )}
              data-testid="bulk-action-tabs"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
              Open all in tabs
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
