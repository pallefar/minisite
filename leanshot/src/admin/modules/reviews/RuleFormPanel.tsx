/**
 * Phase 36 Plan 36-04 Task 2 — RuleFormPanel (Surface D, single-condition rule form).
 *
 * D-02 hard-locked: EXACTLY 1 trigger picker + 1 cohort picker. No AND/OR/+
 * composition controls — schema-level prohibition mirrored at the UI layer.
 *
 * Trigger picker source: Object.values(EVENTS).filter(e => e.nps_trigger_eligible === true).
 * Empty list → fallback message + Save disabled (Phase 35 events may not be
 * merged yet at plan-time).
 */
import { useMemo, useState } from 'react';
import { CohortPicker } from '@/components/admin/cohort/CohortPicker';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/hooks/useToast';
import { EVENTS } from '@/lib/analytics/events';
import { supabase } from '@/lib/supabase';

export interface ReviewRule {
  id: string;
  name: string;
  trigger_event: string;
  cohort_id: string | null;
  active: boolean;
}

export interface RuleFormPanelProps {
  open: boolean;
  rule?: ReviewRule;
  onSave: () => void;
  onCancel: () => void;
}

interface EligibleEvent {
  name: string;
  description: string;
}

function getEligibleEvents(): EligibleEvent[] {
  const out: EligibleEvent[] = [];
  for (const e of Object.values(EVENTS as Record<string, unknown>)) {
    if (!e || typeof e !== 'object') continue;
    const def = e as { name?: string; description?: string; nps_trigger_eligible?: unknown };
    if (def.nps_trigger_eligible === true && typeof def.name === 'string') {
      out.push({ name: def.name, description: def.description ?? '' });
    }
  }
  return out;
}

export default function RuleFormPanel({
  open,
  rule,
  onSave,
  onCancel,
}: RuleFormPanelProps): React.JSX.Element {
  const toast = useToast();
  const eligible = useMemo(() => getEligibleEvents(), []);
  const [name, setName] = useState(rule?.name ?? '');
  const [triggerEvent, setTriggerEvent] = useState(
    rule?.trigger_event ?? eligible[0]?.name ?? '',
  );
  const [cohortId, setCohortId] = useState<string | null>(rule?.cohort_id ?? null);
  const [active, setActive] = useState<boolean>(rule?.active ?? true);
  const [busy, setBusy] = useState(false);

  const hasEligible = eligible.length > 0;
  const canSave = hasEligible && name.trim().length > 0 && triggerEvent.length > 0 && !busy;

  async function handleSave(): Promise<void> {
    if (!canSave) return;
    setBusy(true);
    try {
      const fn = rule ? 'update_review_prompt_rule' : 'create_review_prompt_rule';
      const payload = rule
        ? {
            p_id: rule.id,
            p_name: name.trim(),
            p_trigger_event: triggerEvent,
            p_cohort_id: cohortId,
            p_active: active,
          }
        : {
            p_name: name.trim(),
            p_trigger_event: triggerEvent,
            p_cohort_id: cohortId,
            p_active: active,
          };
      const { error } = await supabase.rpc(fn, payload);
      if (error) {
        toast(`Could not save rule: ${error.message}`, 'error');
        return;
      }
      toast('Rule saved', 'success');
      onSave();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onCancel} title={rule ? 'Edit rule' : 'New rule'}>
      <div className="p-4 space-y-4">
        <Input
          label="Rule name"
          required
          maxLength={60}
          placeholder="e.g. Post-activation NPS"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        {hasEligible ? (
          <Select
            label="Trigger event"
            required
            value={triggerEvent}
            onChange={(e) => setTriggerEvent(e.target.value)}
            hint="Pick the positive-engagement event that fires this prompt."
          >
            {eligible.map((ev) => (
              <option key={ev.name} value={ev.name}>
                {ev.name}
                {ev.description ? ` — ${ev.description.slice(0, 80)}` : ''}
              </option>
            ))}
          </Select>
        ) : (
          <p
            role="status"
            aria-live="polite"
            className="rounded-md border border-[var(--color-warning,#a67b00)] bg-[var(--color-surface-elevated)] p-3 text-sm"
          >
            No trigger-eligible events registered. See <code>events.ts</code> —
            mark an event with <code>nps_trigger_eligible: true</code> first.
          </p>
        )}

        <div>
          <CohortPicker
            value={cohortId}
            onChange={setCohortId}
            placeholder="All users"
          />
        </div>

        <label className="flex items-center gap-2 text-sm select-none">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4"
          />
          <span>Active</span>
        </label>

        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSave()}
            disabled={!canSave}
            loading={busy}
          >
            Save rule
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
