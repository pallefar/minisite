/**
 * Phase 36 Plan 36-04 Task 1 — CohortPicker primitive.
 *
 * Thin wrapper over the existing `cohort_definitions` data source exposing
 * single-select behavior for admin forms. Pitfall 5 surfaced this gap:
 * UI-SPEC referenced `<CohortPicker>` but no such component existed.
 *
 * Contract:
 *  - Props: { value: string | null; onChange: (cohortId: string | null) => void; placeholder?: string }
 *  - Renders the existing cohorts (active or draft); empty → "No cohorts available".
 *  - Row click → onChange(id). Clear-selection button → onChange(null).
 *  - Selected row has data-selected="true" for visual + test affordance.
 *
 * Composition: this is NOT a fork of AdminCohortList; it reuses the same
 * Supabase data shape (id/name/status/created_at) but renders a compact
 * picker UI suitable for inline form usage.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/helpers';
import { supabase } from '@/lib/supabase';

export interface CohortPickerProps {
  value: string | null;
  onChange: (cohortId: string | null) => void;
  placeholder?: string;
}

interface CohortRow {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
  created_at: string;
}

export function CohortPicker({ value, onChange, placeholder = 'All users' }: CohortPickerProps) {
  const [rows, setRows] = useState<CohortRow[] | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('cohort_definitions')
        .select('id, name, status, created_at')
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        setErrorMessage("Couldn't load cohorts. Try refreshing.");
        setRows([]);
        return;
      }
      // Hide archived from the picker — only draft/active are useful targets.
      const visible = ((data ?? []) as CohortRow[]).filter((r) => r.status !== 'archived');
      setRows(visible);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedLabel = useMemo(() => {
    if (!value || !rows) return placeholder;
    return rows.find((r) => r.id === value)?.name ?? placeholder;
  }, [value, rows, placeholder]);

  if (rows === null) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="text-sm text-[var(--color-text-tertiary)] p-3"
      >
        Loading cohorts…
      </div>
    );
  }

  return (
    <Card variant="flat" padding="sm" className="space-y-2">
      <header className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
            Cohort filter
          </span>
          <span className="text-sm text-[var(--color-text)]">{selectedLabel}</span>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-[12px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] underline-offset-2 hover:underline"
        >
          Clear selection (all users)
        </button>
      </header>

      {errorMessage && (
        <p role="alert" className="text-xs text-[var(--color-danger)]">
          {errorMessage}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-tertiary)] py-3 text-center">
          No cohorts available yet.{' '}
          <a
            href="/admin/membership"
            className="font-semibold text-[var(--color-primary)] hover:underline"
          >
            Create one in Cohorts →
          </a>
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] max-h-56 overflow-auto">
          {rows.map((row) => {
            const selected = row.id === value;
            return (
              <li key={row.id}>
                <button
                  type="button"
                  data-testid={`cohort-picker-row-${row.id}`}
                  data-selected={selected ? 'true' : 'false'}
                  onClick={() => onChange(row.id)}
                  className={cn(
                    'w-full text-start py-2 px-2 flex items-center justify-between gap-2 rounded-md transition-colors',
                    selected
                      ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)] font-semibold'
                      : 'hover:bg-[var(--color-surface-elevated)] text-[var(--color-text)]',
                  )}
                >
                  <span>{row.name}</span>
                  <span className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                    {row.status}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
