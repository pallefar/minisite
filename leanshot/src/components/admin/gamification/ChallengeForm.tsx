/**
 * Phase 35 Plan 35-05 GAME-05/08 — ChallengeForm admin component.
 *
 * Controlled form mirroring AdminCohortBuilder pattern (Phase 27 D-05).
 * Fields: title, framing, challenge_type, threshold, action_type (conditional),
 * duration, cohort_id, reward_* (D-19), starts_at/ends_at, status, A/B variants (D-20).
 *
 * Surface gate: admin.gamification.challenges.write.
 * Validation: inline per-field; submit disabled until valid.
 * Error handling: typed ChallengeApiError codes per Phase 27 CohortApiError pattern.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/hooks/useToast';
import {
  createWeeklyChallenge,
  ChallengeApiError,
  type CreateChallengePayload,
} from '@/lib/gamification/admin-api';
import type { ChallengeVariantKey } from '@/lib/gamification/challenges';

interface VariantDraft {
  variant_key: ChallengeVariantKey;
  framing: string;
  threshold: string; // string for input; parsed on submit
}

interface FormState {
  title: string;
  framing: string;
  challenge_type: 'log_count' | 'streak_days' | 'specific_action';
  threshold: string;
  action_type: 'injection_log' | 'weight_log' | 'symptom_log' | 'workout_log' | '';
  duration: 'week' | 'month';
  cohort_id: string; // empty = global
  reward_xp: string;
  reward_badge_id: string;
  reward_freeze_tokens: string;
  reward_combo_badge_id: string;
  starts_at: string;
  ends_at: string;
  status: 'draft' | 'active';
  variants: VariantDraft[];
  showVariants: boolean;
}

const DEFAULT_FORM: FormState = {
  title: '',
  framing: '',
  challenge_type: 'log_count',
  threshold: '',
  action_type: '',
  duration: 'week',
  cohort_id: '',
  reward_xp: '0',
  reward_badge_id: '',
  reward_freeze_tokens: '0',
  reward_combo_badge_id: '',
  starts_at: '',
  ends_at: '',
  status: 'draft',
  variants: [],
  showVariants: false,
};

export interface ChallengeFormProps {
  onSaved?: (challengeId: string) => void;
}

function isFormValid(form: FormState): boolean {
  if (form.title.trim().length < 3 || form.title.trim().length > 100) return false;
  if (form.framing.trim().length < 3 || form.framing.trim().length > 280) return false;
  const threshold = parseInt(form.threshold, 10);
  if (isNaN(threshold) || threshold < 1 || threshold > 1000) return false;
  if (form.challenge_type === 'specific_action' && !form.action_type) return false;
  if (form.status !== 'draft') {
    if (!form.starts_at || !form.ends_at) return false;
    if (new Date(form.ends_at) <= new Date(form.starts_at)) return false;
  }
  for (const v of form.variants) {
    if (v.framing.trim().length < 3) return false;
  }
  return true;
}

export default function ChallengeForm({ onSaved }: ChallengeFormProps) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  const canSubmit = !submitting && isFormValid(form);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f: FormState) => ({ ...f, [key]: value }));
  }

  function addVariant() {
    if (form.variants.length >= 2) return;
    const nextKey: ChallengeVariantKey = form.variants.length === 0 ? 'A' : 'B';
    setForm((f: FormState) => ({
      ...f,
      variants: [...f.variants, { variant_key: nextKey, framing: '', threshold: '' }],
    }));
  }

  function updateVariant(index: number, field: keyof VariantDraft, value: string) {
    setForm((f: FormState) => ({
      ...f,
      variants: f.variants.map((v: VariantDraft, i: number) =>
        i === index ? { ...v, [field]: value } : v,
      ),
    }));
  }

  function removeVariant(index: number) {
    setForm((f: FormState) => ({
      ...f,
      variants: f.variants.filter((_: VariantDraft, i: number) => i !== index),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTitleError(null);
    setSubmitting(true);
    try {
      const payload: CreateChallengePayload = {
        title: form.title.trim(),
        framing: form.framing.trim(),
        challenge_type: form.challenge_type,
        threshold: parseInt(form.threshold, 10),
        duration: form.duration,
        starts_at: form.starts_at || new Date().toISOString(),
        ends_at: form.ends_at || new Date().toISOString(),
        status: form.status,
      };

      if (form.action_type) payload.action_type = form.action_type;
      if (form.cohort_id) payload.cohort_id = form.cohort_id;
      const xp = parseInt(form.reward_xp, 10);
      if (!isNaN(xp) && xp > 0) payload.reward_xp = xp;
      if (form.reward_badge_id.trim()) payload.reward_badge_id = form.reward_badge_id.trim();
      const ft = parseInt(form.reward_freeze_tokens, 10);
      if (!isNaN(ft) && ft > 0) payload.reward_freeze_tokens = ft;
      if (form.reward_combo_badge_id.trim()) payload.reward_combo_badge_id = form.reward_combo_badge_id.trim();

      if (form.variants.length > 0) {
        payload.variants = form.variants.map((v: VariantDraft) => ({
          variant_key: v.variant_key,
          framing: v.framing.trim(),
          ...(v.threshold ? { threshold: parseInt(v.threshold, 10) } : {}),
        }));
      }

      const newId = await createWeeklyChallenge(payload);
      toast(`Challenge "${payload.title}" created`, 'success');
      setForm(DEFAULT_FORM);
      onSaved?.(newId);
    } catch (err) {
      if (err instanceof ChallengeApiError) {
        if (err.code === 'not_admin') {
          toast('You need admin access to create challenges', 'error');
        } else if (err.code === 'max_2_variants') {
          toast('Maximum 2 A/B variants per challenge (D-20)', 'error');
        } else {
          toast(`Could not create challenge (${err.code})`, 'error');
        }
      } else {
        toast('Could not create challenge — try again', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card variant="elevated" padding="lg" className="space-y-4">
      <h3 className="text-base font-semibold">Create challenge</h3>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {/* Title */}
        <div className="flex flex-col gap-1">
          <label htmlFor="challenge-title" className="text-sm font-medium">
            Title
          </label>
          <input
            id="challenge-title"
            type="text"
            value={form.title}
            onChange={(e) => {
              updateField('title', e.target.value);
              if (titleError) setTitleError(null);
            }}
            placeholder="e.g. Log 5 injections this week"
            aria-invalid={titleError ? 'true' : undefined}
            className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
          />
          {titleError && (
            <p className="text-xs text-[var(--color-error)]" role="alert">{titleError}</p>
          )}
        </div>

        {/* Framing */}
        <div className="flex flex-col gap-1">
          <label htmlFor="challenge-framing" className="text-sm font-medium">
            Framing <span className="text-[var(--color-text-secondary)] font-normal">(default copy)</span>
          </label>
          <textarea
            id="challenge-framing"
            value={form.framing}
            onChange={(e) => updateField('framing', e.target.value)}
            placeholder="e.g. Log any 5 injections this week to build your routine"
            rows={2}
            className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm resize-y"
          />
        </div>

        {/* Challenge type + Threshold */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="challenge-type" className="text-sm font-medium">
              Challenge type
            </label>
            <select
              id="challenge-type"
              value={form.challenge_type}
              onChange={(e) =>
                updateField(
                  'challenge_type',
                  e.target.value as FormState['challenge_type'],
                )
              }
              aria-label="Challenge type"
              className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
            >
              <option value="log_count">Log count</option>
              <option value="streak_days">Streak days</option>
              <option value="specific_action">Specific action</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="challenge-threshold" className="text-sm font-medium">
              Threshold
            </label>
            <input
              id="challenge-threshold"
              type="number"
              min={1}
              max={1000}
              value={form.threshold}
              onChange={(e) => updateField('threshold', e.target.value)}
              placeholder="e.g. 5"
              className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
            />
          </div>
        </div>

        {/* Action type (visible only for specific_action) */}
        {form.challenge_type === 'specific_action' && (
          <div className="flex flex-col gap-1">
            <label htmlFor="challenge-action-type" className="text-sm font-medium">
              Action type
            </label>
            <select
              id="challenge-action-type"
              value={form.action_type}
              onChange={(e) =>
                updateField(
                  'action_type',
                  e.target.value as FormState['action_type'],
                )
              }
              aria-label="Action type"
              className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
            >
              <option value="">Select action type</option>
              <option value="injection_log">Injection log</option>
              <option value="weight_log">Weight log</option>
              <option value="symptom_log">Symptom log</option>
              <option value="workout_log">Workout log</option>
            </select>
          </div>
        )}

        {/* Duration */}
        <div className="flex flex-col gap-1">
          <label htmlFor="challenge-duration" className="text-sm font-medium">
            Duration
          </label>
          <select
            id="challenge-duration"
            value={form.duration}
            onChange={(e) =>
              updateField('duration', e.target.value as FormState['duration'])
            }
            className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
          >
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="challenge-starts-at" className="text-sm font-medium">
              Starts at
            </label>
            <input
              id="challenge-starts-at"
              type="datetime-local"
              value={form.starts_at}
              onChange={(e) => updateField('starts_at', e.target.value)}
              className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="challenge-ends-at" className="text-sm font-medium">
              Ends at
            </label>
            <input
              id="challenge-ends-at"
              type="datetime-local"
              value={form.ends_at}
              onChange={(e) => updateField('ends_at', e.target.value)}
              className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
            />
          </div>
        </div>

        {/* Status */}
        <div className="flex flex-col gap-1">
          <label htmlFor="challenge-status" className="text-sm font-medium">
            Status
          </label>
          <select
            id="challenge-status"
            value={form.status}
            onChange={(e) =>
              updateField('status', e.target.value as FormState['status'])
            }
            className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
          </select>
        </div>

        {/* Rewards section (D-19 all 4 types) */}
        <details className="border border-[var(--color-border)] rounded p-3">
          <summary className="text-sm font-medium cursor-pointer">
            Rewards (D-19 — optional)
          </summary>
          <div className="mt-3 space-y-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="reward-xp" className="text-sm font-medium">
                XP reward
              </label>
              <input
                id="reward-xp"
                type="number"
                min={0}
                max={10000}
                value={form.reward_xp}
                onChange={(e) => updateField('reward_xp', e.target.value)}
                className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="reward-badge-id" className="text-sm font-medium">
                Badge ID (badge_catalog)
              </label>
              <input
                id="reward-badge-id"
                type="text"
                value={form.reward_badge_id}
                onChange={(e) => updateField('reward_badge_id', e.target.value)}
                placeholder="e.g. badge_5day_streak"
                className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="reward-freeze-tokens" className="text-sm font-medium">
                Freeze tokens (0–3)
              </label>
              <input
                id="reward-freeze-tokens"
                type="number"
                min={0}
                max={3}
                value={form.reward_freeze_tokens}
                onChange={(e) => updateField('reward_freeze_tokens', e.target.value)}
                className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="reward-combo-badge-id" className="text-sm font-medium">
                Combo badge ID (D-19 type 4 — cross-streak)
              </label>
              <input
                id="reward-combo-badge-id"
                type="text"
                value={form.reward_combo_badge_id}
                onChange={(e) => updateField('reward_combo_badge_id', e.target.value)}
                placeholder="e.g. badge_combo_consistency"
                className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
              />
            </div>
          </div>
        </details>

        {/* A/B Variants accordion (D-20 — max 2) */}
        <details
          className="border border-[var(--color-border)] rounded p-3"
          open={form.showVariants}
        >
          <summary
            className="text-sm font-medium cursor-pointer"
            onClick={() => updateField('showVariants', !form.showVariants)}
          >
            A/B Variants (D-20 — max 2)
          </summary>
          <div className="mt-3 space-y-3">
            {form.variants.map((variant: VariantDraft, index: number) => (
              <div
                key={variant.variant_key}
                className="border border-[var(--color-border)] rounded p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Variant {variant.variant_key}</span>
                  <button
                    type="button"
                    onClick={() => removeVariant(index)}
                    className="text-xs text-[var(--color-error)] hover:underline"
                  >
                    Remove
                  </button>
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`variant-framing-${index}`}
                    className="text-sm font-medium"
                  >
                    Variant framing
                  </label>
                  <textarea
                    id={`variant-framing-${index}`}
                    value={variant.framing}
                    onChange={(e) => updateVariant(index, 'framing', e.target.value)}
                    rows={2}
                    className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm resize-y"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`variant-threshold-${index}`}
                    className="text-sm font-medium"
                  >
                    Threshold override <span className="text-[var(--color-text-secondary)] font-normal">(optional)</span>
                  </label>
                  <input
                    id={`variant-threshold-${index}`}
                    type="number"
                    min={1}
                    max={1000}
                    value={variant.threshold}
                    onChange={(e) => updateVariant(index, 'threshold', e.target.value)}
                    placeholder="Leave empty to use parent threshold"
                    className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
                  />
                </div>
              </div>
            ))}

            {/* Add variant button — hidden when 2 variants exist */}
            {form.variants.length < 2 && (
              <button
                type="button"
                onClick={addVariant}
                aria-label="Add variant"
                className="text-sm font-medium text-[var(--color-primary)] hover:underline"
              >
                + Add variant
              </button>
            )}
          </div>
        </details>

        <Button type="submit" disabled={!canSubmit} aria-busy={submitting}>
          {submitting ? 'Creating…' : 'Create challenge'}
        </Button>
      </form>
    </Card>
  );
}
