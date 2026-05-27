/**
 * Phase 24 Plan 24-06 — Admin AuditFilterBar.
 *
 * Filter bar for the admin AuditLogModule. Adapted from the clinic-settings
 * AuditFilterBar (Phase 10) for the admin context.
 *
 * Inputs:
 *   - date range (from, to) via text inputs
 *   - actor email (free-text match)
 *   - target email (free-text match)
 *   - table_name (select from D-14 list)
 *   - action_name (free text)
 *
 * Emits onChange(filters) debounced 300ms.
 *
 * PHI contract: filter inputs are admin-only context; debounce avoids
 * over-firing but no PostHog events from this surface (superadmin only).
 */

import { useEffect, useRef } from 'react';

// ── D-14 table list ────────────────────────────────────────────────────────────

const PHI_TABLES: { value: string; label: string }[] = [
  { value: 'injections', label: 'injections' },
  { value: 'weights', label: 'weights' },
  { value: 'meals', label: 'meals' },
  { value: 'workouts', label: 'workouts' },
  { value: 'vials', label: 'vials' },
  { value: 'costs', label: 'costs' },
  { value: 'mood_logs', label: 'mood_logs' },
  { value: 'sleep_logs', label: 'sleep_logs' },
  { value: 'photos', label: 'photos' },
  { value: 'doctor_shares', label: 'doctor_shares' },
  { value: 'clinic_patients', label: 'clinic_patients' },
  { value: 'conversations', label: 'conversations' },
  { value: 'profiles', label: 'profiles' },
  { value: 'affiliate_payouts', label: 'affiliate_payouts' },
  { value: 'audit_logs', label: 'audit_logs' },
];

// ── Filter state ──────────────────────────────────────────────────────────────

export interface AdminAuditFilters {
  actorEmail: string;
  targetEmail: string;
  tableName: string;
  actionName: string;
  fromDate: string;
  toDate: string;
}

export const DEFAULT_ADMIN_AUDIT_FILTERS: AdminAuditFilters = {
  actorEmail: '',
  targetEmail: '',
  tableName: '',
  actionName: '',
  fromDate: '',
  toDate: '',
};

export interface AdminAuditFilterBarProps {
  value: AdminAuditFilters;
  onChange: (filters: AdminAuditFilters) => void;
  onClear: () => void;
}

const DEBOUNCE_MS = 300;

export function AdminAuditFilterBar({ value, onChange, onClear }: AdminAuditFilterBarProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<AdminAuditFilters>(value);

  // Debounced emit
  const scheduleEmit = (next: AdminAuditFilters): void => {
    pendingRef.current = next;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(pendingRef.current), DEBOUNCE_MS);
  };

  // Cleanup on unmount
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const handleField =
    (field: keyof AdminAuditFilters) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => {
      scheduleEmit({ ...value, [field]: e.target.value });
    };

  const isFiltered = Object.values(value).some((v) => v !== '');

  return (
    <div className="flex flex-wrap gap-3 items-end">
      {/* Actor email */}
      <div className="flex flex-col gap-1 min-w-[180px]">
        <label
          className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]"
          htmlFor="audit-filter-actor"
        >
          Actor email
        </label>
        <input
          id="audit-filter-actor"
          type="text"
          placeholder="actor email"
          defaultValue={value.actorEmail}
          onChange={handleField('actorEmail')}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-1.5 text-[13px] text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
      </div>

      {/* Target email */}
      <div className="flex flex-col gap-1 min-w-[180px]">
        <label
          className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]"
          htmlFor="audit-filter-target"
        >
          Target email
        </label>
        <input
          id="audit-filter-target"
          type="text"
          placeholder="target email"
          defaultValue={value.targetEmail}
          onChange={handleField('targetEmail')}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-1.5 text-[13px] text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
      </div>

      {/* Table name */}
      <div className="flex flex-col gap-1 min-w-[160px]">
        <label
          className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]"
          htmlFor="audit-filter-table"
        >
          Table
        </label>
        <select
          id="audit-filter-table"
          value={value.tableName}
          onChange={handleField('tableName')}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-1.5 text-[13px] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        >
          <option value="">All tables</option>
          {PHI_TABLES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* Action name */}
      <div className="flex flex-col gap-1 min-w-[160px]">
        <label
          className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]"
          htmlFor="audit-filter-action"
        >
          Action
        </label>
        <input
          id="audit-filter-action"
          type="text"
          placeholder="action name"
          defaultValue={value.actionName}
          onChange={handleField('actionName')}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-1.5 text-[13px] text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
      </div>

      {/* Date range */}
      <div className="flex flex-col gap-1 min-w-[130px]">
        <label
          className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]"
          htmlFor="audit-filter-from"
        >
          From
        </label>
        <input
          id="audit-filter-from"
          type="date"
          value={value.fromDate}
          onChange={handleField('fromDate')}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-1.5 text-[13px] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
      </div>

      <div className="flex flex-col gap-1 min-w-[130px]">
        <label
          className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]"
          htmlFor="audit-filter-to"
        >
          To
        </label>
        <input
          id="audit-filter-to"
          type="date"
          value={value.toDate}
          onChange={handleField('toDate')}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-1.5 text-[13px] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
      </div>

      {/* Clear */}
      {isFiltered && (
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-danger)] hover:border-[var(--color-danger)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-colors"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
