/**
 * Phase 10 Plan 10-08 — AuditFilterBar.
 *
 * Renders three filter triggers:
 *   1. Member dropdown (queries org members via list_org_members RPC)
 *   2. Action-type dropdown (16-value enum from UI-SPEC)
 *   3. Time-range picker (24h / 7d / 30d / Custom)
 *
 * Apply button fires debounced PostHog `clinic_audit_filter_applied` event
 * with booleans only (no member uuid, no action value, no date strings).
 *
 * PHI contract (10-EVENTS.md §7):
 *   FORBIDDEN: actual member uuid, actual action enum value, actual date range.
 *   ALLOWED: filter_type enum, boolean presence flags.
 */

import posthog from 'posthog-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CLINIC_EVENTS } from '@/lib/clinic-events';
import { supabase } from '@/lib/supabase';
import { AuditCustomRangeModal } from './AuditCustomRangeModal';
import type { TimeRangePreset, CustomRange } from './use-audit-events';

// ── Action enum (16 values from UI-SPEC) ─────────────────────────────────────

export const AUDIT_ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: 'member.invite', label: 'Invited a patient' },
  { value: 'member.accept', label: 'Patient accepted invitation' },
  { value: 'member.decline', label: 'Patient declined invitation' },
  { value: 'member.revoke', label: 'Revoked patient access' },
  { value: 'role.create', label: 'Created role' },
  { value: 'role.update', label: 'Updated role' },
  { value: 'role.delete', label: 'Deleted role' },
  { value: 'role.assign', label: 'Assigned role to member' },
  { value: 'patient_data.read', label: 'Viewed patient data' },
  { value: 'patient_photos.read', label: 'Viewed patient photos' },
  { value: 'section_view', label: 'Viewed section' },
  { value: 'rank_computed', label: 'System recomputed roster ranking' },
  { value: 'rank_threshold_crossed', label: 'Score crossed needs-attention threshold' },
  { value: 'bulk_pdf_export', label: 'Included in bulk PDF export' },
  { value: 'bulk_csv_export', label: 'Included in bulk CSV symptom export' },
];

// ── Time-range options ─────────────────────────────────────────────────────────

const TIME_RANGE_OPTIONS: { value: TimeRangePreset; label: string }[] = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range' },
];

function timeRangeLabel(preset: TimeRangePreset, customRange: CustomRange | null): string {
  if (preset === 'custom' && customRange) {
    return `${customRange.from} – ${customRange.to}`;
  }
  return TIME_RANGE_OPTIONS.find((o) => o.value === preset)?.label ?? 'Last 7 days';
}

// ── OrgMember shape ────────────────────────────────────────────────────────────

interface OrgMember {
  user_id: string;
  display_name: string | null;
  email: string | null;
}

// ── Simple dropdown component ──────────────────────────────────────────────────

interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  id: string;
  label: string;
  options: DropdownOption[];
  value: string | null;
  allLabel: string;
  onSelect: (value: string | null) => void;
  headingLabel?: string;
}

function Dropdown({ id, label, options, value, allLabel, onSelect, headingLabel }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const selectedLabel = value ? (options.find((o) => o.value === value)?.label ?? value) : allLabel;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${selectedLabel}`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2 text-[13px] font-medium text-[var(--color-text)] hover:border-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] transition-colors"
      >
        <span className="truncate max-w-[140px]">{selectedLabel}</span>
        {value && (
          <button
            type="button"
            aria-label={`Clear ${label} filter`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(null);
              setOpen(false);
            }}
            className="ms-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] focus-visible:outline-none"
          >
            ✕
          </button>
        )}
        {!value && (
          <span aria-hidden className="text-[var(--color-text-tertiary)] text-[10px]">
            ▾
          </span>
        )}
      </button>

      {open && (
        <div
          role="listbox"
          aria-labelledby={id}
          className="absolute top-full left-0 mt-1 z-10 min-w-[200px] max-w-[280px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-[var(--shadow)] overflow-hidden"
        >
          {headingLabel && (
            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] border-b border-[var(--color-border)]">
              {headingLabel}
            </div>
          )}
          <ul className="max-h-64 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={value === null}
                onClick={() => {
                  onSelect(null);
                  setOpen(false);
                }}
                className="w-full text-start px-3 py-2 text-[13px] text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)] focus-visible:outline-none focus-visible:bg-[var(--color-surface-elevated)]"
              >
                {allLabel}
              </button>
            </li>
            {options.map((opt) => (
              <li key={opt.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === opt.value}
                  onClick={() => {
                    onSelect(opt.value);
                    setOpen(false);
                  }}
                  className="w-full text-start px-3 py-2 text-[13px] text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)] focus-visible:outline-none focus-visible:bg-[var(--color-surface-elevated)]"
                >
                  {opt.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── AuditFilterBar ─────────────────────────────────────────────────────────────

export interface FilterState {
  memberFilter: string | null;
  actionFilter: string | null;
  timeRangeFilter: TimeRangePreset;
  customRange: CustomRange | null;
}

export interface AuditFilterBarProps {
  orgId: string;
  value: FilterState;
  onChange: (next: FilterState) => void;
  onClear: () => void;
}

const DEFAULT_FILTER_STATE: FilterState = {
  memberFilter: null,
  actionFilter: null,
  timeRangeFilter: '7d',
  customRange: null,
};

export function AuditFilterBar({ orgId, value, onChange, onClear }: AuditFilterBarProps) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [customRangeOpen, setCustomRangeOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load members for the member dropdown
  useEffect(() => {
    if (!orgId) return;
    void (async () => {
      const { data, error } = await supabase.rpc('list_org_members', { p_org_id: orgId });
      if (!error && data) {
        setMembers(
          (data as Array<Record<string, unknown>>).map((m) => ({
            user_id: m['user_id'] as string,
            display_name: (m['display_name'] as string | null) ?? null,
            email: (m['email'] as string | null) ?? null,
          })),
        );
      }
    })();
  }, [orgId]);

  const memberOptions: DropdownOption[] = members.map((m) => ({
    value: m.user_id,
    label: m.display_name ?? m.email ?? m.user_id.slice(0, 8),
  }));

  // Debounced PostHog event after filter change
  const fireFilterEvent = useCallback((filterType: string, next: FilterState): void => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      posthog.capture(CLINIC_EVENTS.AUDIT_FILTER_APPLIED, {
        filter_type: filterType,
        has_member_filter: next.memberFilter !== null,
        has_action_filter: next.actionFilter !== null,
        has_time_filter: next.timeRangeFilter !== '7d' || next.customRange !== null,
      });
    }, 200);
  }, []);

  const handleMemberChange = (v: string | null): void => {
    const next = { ...value, memberFilter: v };
    onChange(next);
    fireFilterEvent('member', next);
  };

  const handleActionChange = (v: string | null): void => {
    const next = { ...value, actionFilter: v };
    onChange(next);
    fireFilterEvent('action_type', next);
  };

  const handleTimeRangeChange = (v: string | null): void => {
    const preset = (v as TimeRangePreset | null) ?? '7d';
    if (preset === 'custom') {
      setCustomRangeOpen(true);
      return;
    }
    const next = { ...value, timeRangeFilter: preset, customRange: null };
    onChange(next);
    fireFilterEvent('time_range', next);
  };

  const handleCustomRangeApply = (range: CustomRange): void => {
    const next = { ...value, timeRangeFilter: 'custom' as TimeRangePreset, customRange: range };
    onChange(next);
    fireFilterEvent('time_range', next);
  };

  const handleClearAll = (): void => {
    onClear();
    posthog.capture(CLINIC_EVENTS.AUDIT_FILTER_APPLIED, {
      filter_type: 'clear_all',
      has_member_filter: false,
      has_action_filter: false,
      has_time_filter: false,
    });
  };

  const isFiltered =
    value.memberFilter !== null ||
    value.actionFilter !== null ||
    value.timeRangeFilter !== '7d' ||
    value.customRange !== null;

  // Build time-range dropdown value
  const timeRangeDropdownValue: string | null =
    value.timeRangeFilter === '7d' ? null : value.timeRangeFilter;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[13px] font-semibold text-[var(--color-text-secondary)] shrink-0">
        Filter
      </span>

      <Dropdown
        id="audit-filter-member"
        label="Member"
        options={memberOptions}
        value={value.memberFilter}
        allLabel="All members ▾"
        onSelect={handleMemberChange}
        headingLabel="Filter by member"
      />

      <Dropdown
        id="audit-filter-action"
        label="Action type"
        options={AUDIT_ACTION_OPTIONS}
        value={value.actionFilter}
        allLabel="All actions ▾"
        onSelect={handleActionChange}
        headingLabel="Filter by action"
      />

      {/* Time-range picker */}
      <Dropdown
        id="audit-filter-time"
        label="Time range"
        options={TIME_RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        value={timeRangeDropdownValue}
        allLabel={`${timeRangeLabel(value.timeRangeFilter, value.customRange)} ▾`}
        onSelect={handleTimeRangeChange}
        headingLabel="Filter by time"
      />

      {isFiltered && (
        <Button variant="ghost" size="sm" onClick={handleClearAll}>
          Clear filters
        </Button>
      )}

      <AuditCustomRangeModal
        open={customRangeOpen}
        initial={value.customRange}
        onApply={handleCustomRangeApply}
        onClose={() => setCustomRangeOpen(false)}
      />
    </div>
  );
}

export { DEFAULT_FILTER_STATE };
