/**
 * Phase 34 Plan 34-08 ONBOARD-07 — Step row.
 *
 * Renders one step in the SortableTreePanel list. Receives `dragging` from
 * SortableTreePanel's `renderItem` callback so the row can dim during drag.
 *
 * The drag handle itself is rendered by SortableTreePanel — do NOT include
 * one here (per SortableTreePanel's contract; see its props doc-comment).
 */
import type { ConsumerOnboardingStepNode } from '@/types/onboarding-step';
import { CONSUMER_STEP_TYPE_LABELS, type ConsumerStepType } from '@/types/onboarding-step';

export interface StepRowProps {
  step: ConsumerOnboardingStepNode;
  index: number;
  dragging: boolean;
  onClick: () => void;
}

export default function StepRow({ step, index, dragging, onClick }: StepRowProps) {
  // Consumer step types resolve to the D-16 label; org step types (present
  // only when a row crosses phases — defensive) fall back to the raw type.
  const typeLabel =
    (CONSUMER_STEP_TYPE_LABELS as Record<string, string | undefined>)[step.type] ?? step.type;
  const title = step.copy?.title?.trim() || '';

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'w-full text-start px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] min-h-[56px] transition-colors hover:border-[var(--color-primary)] ' +
        (dragging ? 'opacity-50' : '')
      }
      aria-label={`Step ${index + 1}: ${typeLabel}${title ? ` — ${title}` : ''}`}
      data-step-row-type={step.type}
    >
      <div className="flex items-center gap-3">
        <span className="text-xs text-[var(--color-text-tertiary)] font-mono">
          {(index + 1).toString().padStart(2, '0')}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wide">
            {typeLabel}
          </div>
          <div className="font-medium truncate">
            {title ? (
              title
            ) : (
              <em className="text-[var(--color-text-tertiary)] not-italic">Untitled step</em>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

/**
 * Type-only re-export keeps a typed boundary for consumers that want the
 * step-type union without importing from `@/types/onboarding-step` directly.
 */
export type { ConsumerStepType };
