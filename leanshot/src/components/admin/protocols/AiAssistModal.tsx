/**
 * Phase 61 Plan 61-05 — AiAssistModal.
 *
 * Modal posting to the protocol-ai-assist Edge Fn for per-step dose/monitoring
 * suggestions grounded in approved RAG chunks.
 *
 * State machine per PATTERNS.md AiAssistModal pattern:
 *   idle → loading → loaded | refusal | error
 *
 * Rate-limit 429: showToast + close modal (no retry UI).
 * Refusal: warning + 'Go to RAG queue →' link (no Apply button).
 * Apply: writes dose_mg + monitoring[] back to step row via onApply callback.
 *
 * Per EditChunkModal analog:
 *  - Modal DS primitive wraps content (role=dialog + aria-modal inherited).
 *  - Loading state: Skeleton in output area + aria-busy on Apply.
 *  - Footer: Cancel (secondary) + Apply (primary).
 *
 * Typography: text-[13px] / text-[11px] only per Phase 60 BLOCKER lesson.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/useToast';
import type { AiAssistResponse, ProtocolMonitoringKey } from '@/types/protocols';

export interface AiAssistModalProps {
  open: boolean;
  onClose: () => void;
  protocolId: string | null;
  stepWeek: number;
  compound: string;
  priorStepsContext: string;
  onApply: (suggestion: { dose_mg: number; monitoring: ProtocolMonitoringKey[] }) => void;
}

type AiState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; suggestion: AiAssistResponse }
  | { status: 'refusal'; reason?: string }
  | { status: 'error'; message: string };

export function AiAssistModal({
  open,
  onClose,
  protocolId,
  stepWeek,
  compound,
  priorStepsContext,
  onApply,
}: AiAssistModalProps) {
  const showToast = useToast();
  const [state, setState] = useState<AiState>({ status: 'idle' });

  useEffect(() => {
    if (!open) {
      // Reset on close so next open starts fresh
      setState({ status: 'idle' });
      return;
    }

    // Auto-fire on open when idle
    void fetchSuggestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fetchSuggestion = async () => {
    setState({ status: 'loading' });
    try {
      const { data, error } = await supabase.functions.invoke('protocol-ai-assist', {
        body: {
          protocol_id: protocolId,
          step_week: stepWeek,
          compound,
          prior_steps_context: priorStepsContext,
        },
      });

      // Check for rate-limit: Edge Fn returns 429 shape as error or data.error
      if (
        error?.message?.includes('429') ||
        error?.message?.includes('rate_limit_exceeded') ||
        (data as { error?: string } | null)?.error === 'rate_limit_exceeded'
      ) {
        showToast('AI assist limit reached for today. Resets at midnight UTC.', 'error');
        onClose();
        return;
      }

      if (error) {
        setState({ status: 'error', message: error.message ?? 'AI assist failed' });
        return;
      }

      const response = data as AiAssistResponse | null;
      if (!response) {
        setState({ status: 'error', message: 'Empty response from AI assist' });
        return;
      }

      if (response.refusal) {
        setState({ status: 'refusal', reason: response.refusal_reason });
        return;
      }

      setState({ status: 'loaded', suggestion: response });
    } catch (err) {
      // Network-level 429 or other error
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('429') || msg.includes('rate_limit_exceeded')) {
        showToast('AI assist limit reached for today. Resets at midnight UTC.', 'error');
        onClose();
        return;
      }
      setState({ status: 'error', message: msg });
    }
  };

  const handleApply = () => {
    if (state.status !== 'loaded') return;
    onApply({
      dose_mg: state.suggestion.dose_mg,
      monitoring: state.suggestion.monitoring,
    });
    onClose();
  };

  const isLoading = state.status === 'loading';

  return (
    <Modal open={open} onClose={onClose} title="AI Suggestion" size="lg">
      <div className="space-y-4">
        {/* Suggestion output area */}
        <div
          aria-live="polite"
          aria-busy={isLoading}
          className="p-4 rounded-card border border-[var(--color-border)] bg-[var(--color-surface-elevated)] text-[13px] min-h-[120px]"
        >
          {state.status === 'idle' && (
            <p className="text-[var(--color-text-secondary)]">Preparing suggestion…</p>
          )}

          {state.status === 'loading' && (
            <div className="space-y-2">
              <Skeleton className="h-5 rounded" />
              <Skeleton className="h-5 rounded w-3/4" />
              <Skeleton className="h-5 rounded w-1/2" />
            </div>
          )}

          {state.status === 'loaded' && (
            <div className="space-y-3">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                  Suggested dose
                </span>
                <p className="text-[13px] font-semibold text-[var(--color-text)] font-mono tabular-nums mt-0.5">
                  {state.suggestion.dose_mg} mg
                </p>
              </div>
              {state.suggestion.monitoring.length > 0 && (
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                    Monitoring
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {state.suggestion.monitoring.map((m) => (
                      <span
                        key={m}
                        className="inline-flex items-center h-6 px-2 rounded-pill text-[11px] font-semibold bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {state.suggestion.cited_chunk_ids.length > 0 && (
                <p className="text-[11px] text-[var(--color-text-tertiary)]">
                  {state.suggestion.cited_chunk_ids.length} evidence source
                  {state.suggestion.cited_chunk_ids.length === 1 ? '' : 's'} cited
                </p>
              )}
            </div>
          )}

          {state.status === 'refusal' && (
            <div className="flex items-start gap-3">
              <AlertTriangle
                className="size-4 text-[var(--color-warning)] shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="space-y-1">
                <p className="text-[13px] font-semibold text-[var(--color-warning)]">
                  Suggestion blocked
                </p>
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  {state.reason ??
                    'No qualifying RAG evidence found for this compound and step context.'}
                </p>
                <a
                  href="/admin/rag"
                  className="text-[13px] text-[var(--color-primary)] hover:underline"
                >
                  Go to RAG queue →
                </a>
              </div>
            </div>
          )}

          {state.status === 'error' && (
            <p className="text-[13px] text-[var(--color-danger)]">{state.message}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {state.status !== 'refusal' && state.status !== 'error' && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleApply}
              disabled={state.status !== 'loaded'}
              loading={isLoading}
              aria-busy={isLoading}
              aria-label={`Apply AI suggestion for week ${stepWeek}`}
            >
              Apply
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default AiAssistModal;
