/**
 * Phase 27 Plan 27-02 — CohortFieldPicker.
 *
 * The UI layer (defense-in-depth layer #1) that enforces the 15-field
 * allowlist by literally rendering ONLY those 15 options. Adding a field
 * means updating `FIELD_ALLOWLIST` in field-allowlist.ts and re-grepping the
 * 3 plpgsql + 1 TS mirror sites.
 */
import { FIELD_ALLOWLIST, FIELD_LABEL, type RuleField } from '@/lib/cohort/field-allowlist';

export interface CohortFieldPickerProps {
  value: RuleField;
  onChange: (next: RuleField) => void;
  /** ARIA label fallback used when the picker is not wrapped in a <label>. */
  ariaLabel?: string;
}

export function CohortFieldPicker({ value, onChange, ariaLabel }: CohortFieldPickerProps) {
  return (
    <select
      aria-label={ariaLabel ?? 'Field'}
      value={value}
      onChange={(e) => onChange(e.target.value as RuleField)}
      className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
    >
      {FIELD_ALLOWLIST.map((field) => (
        <option key={field} value={field}>
          {FIELD_LABEL[field]}
        </option>
      ))}
    </select>
  );
}
