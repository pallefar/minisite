/**
 * Phase 50 Plan 50-02 — AddTopicSheet.
 *
 * Right-side Sheet with a small form to create a new rag_topic via
 * ragTopicCreate(). Validates:
 *   - query non-empty
 *   - tag matches /^[a-z0-9-]+$/ (kebab-case per CONTEXT D-08)
 *
 * On success: closes sheet, fires onCreated() so parent refreshes its list.
 */
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/hooks/useToast';
import { ragTopicCreate } from '@/lib/admin/rag/rag-api';

const TAG_REGEX = /^[a-z0-9-]+$/;

export interface AddTopicSheetProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (topicId: string) => void;
}

export function AddTopicSheet({ open, onClose, onCreated }: AddTopicSheetProps) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [posture, setPosture] = useState<'curated' | 'open-web'>('curated');
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'monthly' | 'manual'>('weekly');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ query?: string; tag?: string; form?: string }>({});

  function reset(): void {
    setQuery('');
    setTag('');
    setPosture('curated');
    setCadence('weekly');
    setErrors({});
  }

  function validate(): boolean {
    const next: { query?: string; tag?: string } = {};
    if (!query.trim()) next.query = 'Required';
    if (!tag.trim()) next.tag = 'Required';
    else if (!TAG_REGEX.test(tag.trim())) next.tag = 'Lowercase letters, digits, hyphens only';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    const { data, error } = await ragTopicCreate({
      query: query.trim(),
      tag: tag.trim(),
      posture,
      cadence,
    });
    setSubmitting(false);
    if (error || !data) {
      setErrors({ form: error?.message ?? 'Failed to create topic.' });
      toast('Failed to add topic', 'error');
      return;
    }
    toast('Topic added');
    onCreated?.(data);
    reset();
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add topic">
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="flex flex-col gap-4"
      >
        <Input
          label="Query"
          placeholder="e.g., tirzepatide muscle loss"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          error={errors.query}
          required
          autoFocus
        />
        <Input
          label="Tag"
          placeholder="e.g., muscle-loss"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          error={errors.tag}
          hint="Lowercase, hyphens between words"
          required
        />
        <Select
          label="Posture"
          value={posture}
          onChange={(e) => setPosture(e.target.value as 'curated' | 'open-web')}
        >
          <option value="curated">Curated (allowlisted sources)</option>
          <option value="open-web">Open-web (broader scrape)</option>
        </Select>
        <Select
          label="Cadence"
          value={cadence}
          onChange={(e) =>
            setCadence(e.target.value as 'daily' | 'weekly' | 'monthly' | 'manual')
          }
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="manual">Manual</option>
        </Select>

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
            {submitting ? 'Adding…' : 'Add topic'}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

export default AddTopicSheet;
