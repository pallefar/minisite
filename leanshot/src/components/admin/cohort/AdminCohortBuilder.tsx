/**
 * Phase 27 Plan 27-02 — AdminCohortBuilder.
 *
 * Owns the in-memory rule tree state, runs `ruleTreeSchema.safeParse` on every
 * change to surface validation errors inline, and dispatches `defineCohort()`
 * on Save. Save is disabled when name is empty, tree is invalid, or a request
 * is in flight.
 *
 * Defense-in-depth layer #1 — the UI never lets the user pick a non-allowlisted
 * field (CohortFieldPicker only renders those 15 options).
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/hooks/useToast';
import { defineCohort, CohortApiError } from '@/lib/cohort/api';
import { FIELD_ALLOWLIST, type RuleField } from '@/lib/cohort/field-allowlist';
import { ruleTreeSchema, type RuleNode } from '@/lib/cohort/rule-tree-schema';
import { CohortRuleNode } from './CohortRuleNode';

const DEFAULT_FIELD: RuleField = FIELD_ALLOWLIST[0];

const DEFAULT_TREE: RuleNode = {
  op: 'and',
  children: [{ field: DEFAULT_FIELD, op: '=', value: '' }],
};

export interface AdminCohortBuilderProps {
  /** Invoked with the new cohort_id after a successful save. */
  onSaved?: (cohortId: string) => void;
}

export function AdminCohortBuilder({ onSaved }: AdminCohortBuilderProps) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [tree, setTree] = useState<RuleNode>(DEFAULT_TREE);
  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const validation = useMemo(() => ruleTreeSchema.safeParse(tree), [tree]);
  const treeError = validation.success
    ? null
    : (validation.error.issues[0]?.message ?? 'Invalid rule tree');

  const canSave = !submitting && name.trim().length > 0 && validation.success;

  const handleSave = async () => {
    setNameError(null);
    setSubmitting(true);
    try {
      const { cohortId } = await defineCohort(name.trim(), tree);
      toast(`Cohort "${name.trim()}" created (draft)`, 'success');
      setName('');
      setTree(DEFAULT_TREE);
      onSaved?.(cohortId);
    } catch (e) {
      if (e instanceof CohortApiError) {
        if (e.code === 'duplicate_name') {
          setNameError('A cohort with that name already exists');
        } else if (e.code === 'not_staff') {
          toast('You need admin access to create cohorts', 'error');
        } else if (e.code === 'invalid_rule') {
          toast('The rule tree is invalid — please review the conditions', 'error');
        } else {
          toast(`Could not save cohort (${e.code})`, 'error');
        }
      } else {
        toast('Could not save cohort — try again', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card variant="elevated" padding="lg" className="space-y-4">
      <h2 className="text-lg font-semibold">Create cohort</h2>

      <div className="flex flex-col gap-1">
        <label htmlFor="cohort-name" className="text-sm font-medium">
          Name
        </label>
        <input
          id="cohort-name"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(null);
          }}
          placeholder='e.g. "Free users >7d"'
          aria-invalid={nameError ? 'true' : undefined}
          className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
        />
        {nameError && (
          <p role="alert" className="text-xs text-[var(--color-danger)]">
            {nameError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Conditions</span>
        <CohortRuleNode node={tree} depth={1} onChange={(next) => setTree(next)} />
        {treeError && (
          <p role="alert" className="text-xs text-[var(--color-danger)]">
            {treeError}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="primary" onClick={handleSave} disabled={!canSave} loading={submitting}>
          Save as draft
        </Button>
      </div>
    </Card>
  );
}
