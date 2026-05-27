/**
 * Phase 34 Plan 34-08 ONBOARD-07 — Step palette (8 D-16 consumer step types).
 *
 * Renders 8 chips, one per ConsumerStepType. Clicking a chip appends a new
 * step (uuid id + type + sensible defaults) to the working flow via the
 * `onAddStep` callback.
 *
 * Lives under `src/components/admin/onboarding-builder/` so dnd-kit imports
 * (via the parent module's SortableTreePanel usage) stay routed to the
 * `admin-shell` lazy chunk per [[reference_eslint_import_x_path_gotcha]] +
 * [[admin-module-manifest-vs-router-branch-drift]]. The CI bundle guard
 * (scripts/assert-clinic-bundle-budget.sh) fails the build if dnd-kit leaks
 * into the index chunk.
 *
 * Pattern S1 dual-layer: the palette is purely client-side; the real superadmin
 * gate happens at save_consumer_onboarding_flow SECDEF (Plan 34-01). Standard
 * admins can drag/drop here but Save will return 42501.
 */

import {
  CONSUMER_STEP_TYPES,
  CONSUMER_STEP_TYPE_LABELS,
  type ConsumerStepType,
  type ConsumerOnboardingStepNode,
} from '@/types/onboarding-step';

export interface StepPaletteProps {
  /** Called with the step type when an admin clicks a palette chip. */
  onAddStep: (type: ConsumerStepType) => void;
}

export default function StepPalette({ onAddStep }: StepPaletteProps) {
  return (
    <div
      role="toolbar"
      aria-label="Step palette"
      className="flex flex-wrap gap-2 p-3 bg-[var(--color-surface-elevated)] rounded-2xl border border-[var(--color-border)]"
    >
      {CONSUMER_STEP_TYPES.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onAddStep(t)}
          className="min-h-[44px] px-3 py-2 rounded-pill border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-medium hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
          aria-label={`Add ${CONSUMER_STEP_TYPE_LABELS[t]} step`}
          data-step-type={t}
        >
          + {CONSUMER_STEP_TYPE_LABELS[t]}
        </button>
      ))}
    </div>
  );
}

/**
 * Construct a new OnboardingStepNode populated with sensible defaults for the
 * given consumer step type. Centralized here so test invariants (single-select
 * gets `options: []`, custom-component has no `field`, etc.) live with the
 * palette code that creates them.
 *
 * SSR/test safety: falls back to a non-crypto uuid when `crypto.randomUUID`
 * is unavailable (jsdom older builds + Node < 19).
 */
export function createStepOfType(type: ConsumerStepType): ConsumerOnboardingStepNode {
  const id = generateStepId();
  const base: ConsumerOnboardingStepNode = {
    id,
    type,
    copy: { title: '', subtitle: '' },
  };

  if (type === 'custom-component') {
    // Custom-component steps render arbitrary React; no field-key/required.
    return base;
  }

  base.field = { key: '', required: false };

  if (type === 'single-select' || type === 'multi-select') {
    base.options = [];
  }

  return base;
}

function generateStepId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (rare; jsdom <17 etc.).
  return `step-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}
