/**
 * Phase 34 Plan 34-08 ONBOARD-07 — Step property panel.
 *
 * Controlled-component form for editing the selected step. Inputs flow back
 * to the parent via `onChange(nextStep)` immediately so the parent owns the
 * working flow state (single source of truth).
 *
 * MVP scope (per plan): copy / field / options (single-select & multi-select) /
 * validation / branching (JSON textarea — full per-rule UI deferred). Branching
 * JSON is parsed defensively — invalid JSON is reported via an error message
 * and the step's existing branching array is preserved until valid JSON is
 * entered (no destructive update on parse failure).
 */
import { useId, useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import type {
  ConsumerOnboardingStepNode,
  OnboardingStepOption,
  OnboardingStepBranchingRule,
} from '@/types/onboarding-step';

export interface StepPropertyPanelProps {
  step: ConsumerOnboardingStepNode;
  onChange: (next: ConsumerOnboardingStepNode) => void;
  onDelete: () => void;
}

export default function StepPropertyPanel({ step, onChange, onDelete }: StepPropertyPanelProps) {
  const headerId = useId();
  const supportsOptions = step.type === 'single-select' || step.type === 'multi-select';
  const supportsField = step.type !== 'custom-component';

  return (
    <div role="region" aria-labelledby={headerId} className="space-y-5">
      <header className="flex items-center justify-between">
        <h2 id={headerId} className="text-lg font-semibold">
          Edit step
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          aria-label="Delete step"
          data-action="delete-step"
        >
          Delete
        </Button>
      </header>

      <section className="space-y-3">
        <Input
          label="Title"
          value={step.copy?.title ?? ''}
          onChange={(e) =>
            onChange({ ...step, copy: { ...(step.copy ?? {}), title: e.target.value } })
          }
        />
        <Input
          label="Subtitle"
          value={step.copy?.subtitle ?? ''}
          onChange={(e) =>
            onChange({ ...step, copy: { ...(step.copy ?? {}), subtitle: e.target.value } })
          }
        />
        <Input
          label="Helper text"
          value={step.copy?.helper ?? ''}
          onChange={(e) =>
            onChange({ ...step, copy: { ...(step.copy ?? {}), helper: e.target.value } })
          }
        />
      </section>

      {supportsField && (
        <section className="space-y-3">
          <Input
            label="Field key"
            hint="The key under which the answer is stored on the user profile."
            value={step.field?.key ?? ''}
            onChange={(e) =>
              onChange({
                ...step,
                field: { ...(step.field ?? { key: '' }), key: e.target.value },
              })
            }
          />
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!step.field?.required}
              onChange={(e) =>
                onChange({
                  ...step,
                  field: { ...(step.field ?? { key: '' }), required: e.target.checked },
                })
              }
            />
            <span className="text-sm">Required</span>
          </label>
        </section>
      )}

      {supportsOptions && (
        <OptionsEditor
          options={step.options ?? []}
          onChange={(next) => onChange({ ...step, options: next })}
        />
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--color-text-secondary)]">Validation</h3>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Min"
            type="number"
            value={step.validation?.min ?? ''}
            onChange={(e) => {
              const v = e.target.value === '' ? undefined : Number(e.target.value);
              onChange({
                ...step,
                validation: { ...(step.validation ?? {}), min: v },
              });
            }}
          />
          <Input
            label="Max"
            type="number"
            value={step.validation?.max ?? ''}
            onChange={(e) => {
              const v = e.target.value === '' ? undefined : Number(e.target.value);
              onChange({
                ...step,
                validation: { ...(step.validation ?? {}), max: v },
              });
            }}
          />
        </div>
        <Input
          label="Pattern (regex)"
          value={step.validation?.pattern ?? ''}
          onChange={(e) =>
            onChange({
              ...step,
              validation: {
                ...(step.validation ?? {}),
                pattern: e.target.value === '' ? undefined : e.target.value,
              },
            })
          }
        />
      </section>

      <BranchingEditor
        rules={step.branching}
        onChange={(next) => onChange({ ...step, branching: next })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Options editor (single-select / multi-select)
// ---------------------------------------------------------------------------

function OptionsEditor({
  options,
  onChange,
}: {
  options: OnboardingStepOption[];
  onChange: (next: OnboardingStepOption[]) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text-secondary)]">Options</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange([...options, { value: '', label: '' }])}
          data-action="add-option"
        >
          + Add option
        </Button>
      </div>
      {options.length === 0 ? (
        <p className="text-sm text-[var(--color-text-tertiary)]">No options yet.</p>
      ) : (
        <ul className="space-y-2">
          {options.map((opt, i) => (
            <li key={i} className="flex gap-2 items-end">
              <div className="flex-1">
                <Input
                  label={i === 0 ? 'Value' : undefined}
                  value={opt.value}
                  onChange={(e) =>
                    onChange(
                      options.map((o, idx) => (idx === i ? { ...o, value: e.target.value } : o)),
                    )
                  }
                />
              </div>
              <div className="flex-1">
                <Input
                  label={i === 0 ? 'Label' : undefined}
                  value={opt.label}
                  onChange={(e) =>
                    onChange(
                      options.map((o, idx) => (idx === i ? { ...o, label: e.target.value } : o)),
                    )
                  }
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove option ${i + 1}`}
                onClick={() => onChange(options.filter((_, idx) => idx !== i))}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Branching editor (JSON textarea MVP)
// ---------------------------------------------------------------------------

function BranchingEditor({
  rules,
  onChange,
}: {
  rules: OnboardingStepBranchingRule[] | undefined;
  onChange: (next: OnboardingStepBranchingRule[] | undefined) => void;
}) {
  // Local draft text — never re-serialize from `rules` on every keystroke
  // (would clobber the user's in-flight edits).
  const [draft, setDraft] = useState<string>(() =>
    rules && rules.length > 0 ? JSON.stringify(rules, null, 2) : '',
  );
  const [parseError, setParseError] = useState<string | null>(null);

  // When the parent replaces the step (e.g. switches selection), re-seed the
  // draft from the new rules. Comparing serialized forms avoids loops when
  // the user is typing.
  useEffect(() => {
    const serialized = rules && rules.length > 0 ? JSON.stringify(rules, null, 2) : '';
    setDraft((current) => (current === serialized ? current : serialized));
    setParseError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(rules)]);

  function commit(next: string): void {
    setDraft(next);
    if (next.trim() === '') {
      setParseError(null);
      onChange(undefined);
      return;
    }
    try {
      const parsed = JSON.parse(next);
      if (!Array.isArray(parsed)) {
        setParseError('Branching JSON must be an array of rule objects.');
        return;
      }
      // Light-weight shape check — full schema enforcement happens at the DB
      // validator (_validate_onboarding_steps).
      const ok = parsed.every(
        (r) => r && typeof r === 'object' && r.when && typeof r.when === 'object' && r.goto_step_id,
      );
      if (!ok) {
        setParseError(
          'Each rule must have shape { "when": { "value": "..." }, "goto_step_id": "..." }.',
        );
        return;
      }
      setParseError(null);
      onChange(parsed as OnboardingStepBranchingRule[]);
    } catch (err) {
      setParseError(`Invalid JSON: ${(err as Error).message}`);
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-[var(--color-text-secondary)]">Branching</h3>
      <Textarea
        label="Branching rules (JSON)"
        hint='Array of { "when": { "value": "..." }, "goto_step_id": "..." }'
        rows={5}
        value={draft}
        onChange={(e) => commit(e.target.value)}
        error={parseError ?? undefined}
        data-field="branching-json"
      />
    </section>
  );
}
