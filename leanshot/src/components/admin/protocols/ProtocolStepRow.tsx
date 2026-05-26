/**
 * Phase 61 Plan 61-05 — ProtocolStepRow.
 *
 * Per-week titration step row for the ProtocolEditorPage step builder.
 * Renders inside a table body or equivalent grid context.
 *
 * Fields:
 *   - Week number (non-editable, font-mono)
 *   - dose_mg (number input, font-mono tabular-nums)
 *   - frequency select (daily/weekly/bi-weekly/custom-cron)
 *   - cron_string input (only when frequency='custom-cron')
 *   - monitoring multiselect pills (5 options, aria-pressed)
 *   - Cite evidence button (secondary, shows count when evidence present)
 *   - Suggest button (secondary, triggers AI assist)
 *   - Remove button (icon-only, danger hover)
 *
 * Evidence chips below row: click opens CitationPopover via anchorEl ref pattern.
 *
 * Typography: text-[11px] / text-[13px] only per Phase 60 BLOCKER lesson.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { CitationPopover } from '@/components/dashboard/ai/CitationPopover';
import type { ProtocolStep, ProtocolEvidence, ProtocolMonitoringKey } from '@/types/protocols';

const MONITORING_OPTIONS: { key: ProtocolMonitoringKey; label: string }[] = [
  { key: 'weight',      label: 'Weight' },
  { key: 'glucose',     label: 'Glucose' },
  { key: 'bp',          label: 'BP' },
  { key: 'mood',        label: 'Mood' },
  { key: 'gi-symptoms', label: 'GI Symptoms' },
];

const FREQUENCY_OPTIONS = [
  { value: 'daily',       label: 'Daily' },
  { value: 'weekly',      label: 'Weekly' },
  { value: 'bi-weekly',   label: 'Bi-weekly' },
  { value: 'custom-cron', label: 'Custom cron' },
] as const;

export interface ProtocolStepRowProps {
  step: ProtocolStep;
  evidence: ProtocolEvidence[];
  evidenceCount: number;
  onChange: (patch: Partial<ProtocolStep>) => void;
  onRemove: () => void;
  onCiteEvidence: () => void;
  onAiAssist: () => void;
}

export function ProtocolStepRow({
  step,
  evidence,
  evidenceCount,
  onChange,
  onRemove,
  onCiteEvidence,
  onAiAssist,
}: ProtocolStepRowProps) {
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null);
  const [activeCitationId, setActiveCitationId] = useState<string | null>(null);

  const handleMonitoringToggle = (key: ProtocolMonitoringKey) => {
    const current = step.monitoring;
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key];
    onChange({ monitoring: next });
  };

  return (
    <>
      {/* Step row */}
      <tr className="border-b border-[var(--color-border)] last:border-0">
        {/* Week */}
        <td className="py-3 px-2 text-[11px] font-mono text-[var(--color-text-secondary)] w-12 shrink-0">
          W{step.week}
        </td>

        {/* Dose (mg) */}
        <td className="py-3 px-2">
          <input
            type="number"
            step="0.1"
            min="0"
            value={step.dose_mg}
            onChange={(e) => onChange({ dose_mg: parseFloat(e.target.value) || 0 })}
            aria-label={`Week ${step.week} dose mg`}
            className="w-20 h-8 px-2 text-[13px] font-mono tabular-nums border border-[var(--color-border)] rounded-pill bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] text-center"
          />
        </td>

        {/* Frequency */}
        <td className="py-3 px-2">
          <select
            value={step.frequency}
            onChange={(e) => onChange({ frequency: e.target.value as ProtocolStep['frequency'] })}
            aria-label={`Week ${step.week} frequency`}
            className="h-8 px-2 text-[13px] border border-[var(--color-border)] rounded-pill bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] appearance-none"
          >
            {FREQUENCY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {step.frequency === 'custom-cron' && (
            <input
              type="text"
              value={step.cron_string ?? ''}
              onChange={(e) => onChange({ cron_string: e.target.value })}
              placeholder="0 8 * * *"
              aria-label={`Week ${step.week} cron string`}
              className="mt-1 w-32 h-8 px-2 text-[13px] font-mono border border-[var(--color-border)] rounded-pill bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
            />
          )}
        </td>

        {/* Monitoring pills */}
        <td className="py-3 px-2">
          <div className="flex flex-wrap gap-1">
            {MONITORING_OPTIONS.map(({ key, label }) => {
              const active = step.monitoring.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => handleMonitoringToggle(key)}
                  className={`h-6 px-2 rounded-pill text-[11px] font-semibold border transition-colors ${
                    active
                      ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] border-[var(--color-primary)]'
                      : 'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </td>

        {/* Cite evidence */}
        <td className="py-3 px-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={onCiteEvidence}
            className="text-[13px] font-semibold border-[var(--color-primary)] text-[var(--color-primary)]"
            aria-label={`Cite evidence for week ${step.week}`}
          >
            Cite
            {evidenceCount > 0 && (
              <span className="ms-1 text-[11px]">({evidenceCount})</span>
            )}
          </Button>
        </td>

        {/* AI Suggest */}
        <td className="py-3 px-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={onAiAssist}
            aria-label={`AI suggest for week ${step.week}`}
          >
            Suggest
          </Button>
        </td>

        {/* Remove */}
        <td className="py-3 px-2">
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove step ${step.week}`}
            className="inline-flex items-center justify-center size-7 rounded-pill text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </td>
      </tr>

      {/* Evidence chips row (below step row, spans full width) */}
      {evidence.length > 0 && (
        <tr>
          <td colSpan={7} className="pb-2 px-2">
            <div className="flex flex-wrap gap-1.5">
              {evidence.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={(e) => {
                    setPopoverAnchor(e.currentTarget);
                    setActiveCitationId(ev.rag_source_id);
                  }}
                  className="text-[11px] bg-[var(--color-surface-elevated)] px-2 py-1 rounded border border-[var(--color-border)] hover:border-[var(--color-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors"
                  aria-label={`View evidence: ${ev.citation_text.slice(0, 30)}`}
                >
                  {ev.citation_text.slice(0, 30)}…
                </button>
              ))}
            </div>
          </td>
        </tr>
      )}

      {/* CitationPopover */}
      {activeCitationId && (
        <CitationPopover
          chunkId={activeCitationId}
          anchorEl={popoverAnchor}
          onClose={() => {
            setActiveCitationId(null);
            setPopoverAnchor(null);
          }}
        />
      )}
    </>
  );
}

export default ProtocolStepRow;
