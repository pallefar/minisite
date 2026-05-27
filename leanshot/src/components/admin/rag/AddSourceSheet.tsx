/**
 * Phase 50 Plan 50-02 — AddSourceSheet.
 *
 * Right-side Sheet form to create a new rag_source via ragSourceCreate().
 * Validates:
 *   - name non-empty
 *   - domain matches /^[a-z0-9.-]+\.[a-z]{2,}$/ (bare hostname, lowercase)
 *   - tier ∈ {A,B,C}
 *   - freshness_window_days 1..3650 (matches DB check constraint)
 *
 * Default freshness per tier (D-32): A=365, B=90, C=30 — pre-filled on tier change.
 */
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/hooks/useToast';
import { ragSourceCreate } from '@/lib/admin/rag/rag-api';

const DOMAIN_REGEX = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const DEFAULT_FRESHNESS: Record<'A' | 'B' | 'C', number> = { A: 365, B: 90, C: 30 };

export interface AddSourceSheetProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (sourceId: string) => void;
}

export function AddSourceSheet({ open, onClose, onCreated }: AddSourceSheetProps) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [tier, setTier] = useState<'A' | 'B' | 'C'>('B');
  const [freshness, setFreshness] = useState<number>(DEFAULT_FRESHNESS.B);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{
    name?: string;
    domain?: string;
    freshness?: string;
    form?: string;
  }>({});

  function reset(): void {
    setName('');
    setDomain('');
    setTier('B');
    setFreshness(DEFAULT_FRESHNESS.B);
    setErrors({});
  }

  function validate(): boolean {
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Required';
    if (!domain.trim()) next.domain = 'Required';
    else if (!DOMAIN_REGEX.test(domain.trim()))
      next.domain = 'Bare hostname only (e.g., pubmed.ncbi.nlm.nih.gov)';
    if (!Number.isFinite(freshness) || freshness < 1 || freshness > 3650)
      next.freshness = 'Must be 1–3650 days';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    const { data, error } = await ragSourceCreate({
      name: name.trim(),
      domain: domain.trim().toLowerCase(),
      tier,
      freshnessWindowDays: freshness,
    });
    setSubmitting(false);
    if (error || !data) {
      setErrors({ form: error?.message ?? 'Failed to create source.' });
      toast('Failed to add source', 'error');
      return;
    }
    toast('Source added');
    onCreated?.(data);
    reset();
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add source">
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="flex flex-col gap-4"
      >
        <Input
          label="Source name"
          placeholder="e.g., PubMed E-utilities"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          required
          // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional UX: focus first field when sheet opens.
          autoFocus
        />
        <Input
          label="Domain"
          placeholder="e.g., pubmed.ncbi.nlm.nih.gov"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          error={errors.domain}
          hint="Bare hostname, no scheme"
          required
        />
        <Select
          label="Trust tier"
          value={tier}
          onChange={(e) => {
            const t = e.target.value as 'A' | 'B' | 'C';
            setTier(t);
            setFreshness(DEFAULT_FRESHNESS[t]);
          }}
        >
          <option value="A">Tier A — primary / regulatory</option>
          <option value="B">Tier B — established health source</option>
          <option value="C">Tier C — community / lay press</option>
        </Select>
        <Input
          label="Freshness window (days)"
          type="number"
          inputMode="numeric"
          min={1}
          max={3650}
          value={String(freshness)}
          onChange={(e) => setFreshness(Number(e.target.value))}
          error={errors.freshness}
          hint={`Default for Tier ${tier}: ${DEFAULT_FRESHNESS[tier]} days`}
          required
        />

        {errors.form && (
          <p className="text-[13px] text-[var(--color-danger)]" role="alert">
            {errors.form}
          </p>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add source'}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

export default AddSourceSheet;
