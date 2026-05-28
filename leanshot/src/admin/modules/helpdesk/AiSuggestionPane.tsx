/**
 * Phase 37 Plan 37-07 — AiSuggestionPane (HELP-04).
 *
 * Reads the latest `ticket_ai_suggestions` row for a ticket and renders:
 *   - Sentiment score with traffic-light color
 *   - Tags + per-tag confidence
 *   - Suggested route (agent name + confidence) — Plan 37-08 wires routes
 *   - Draft reply preview (truncated to 400 chars; click "Insert" to populate composer)
 *
 * Auto-refetch every 5s for the first 30s when no row exists yet (AI classify
 * pipeline is async). After 30s, gives up — agent can still send.
 *
 * D-08: "Insert draft into composer" does NOT auto-send. It calls a callback
 * that populates the AgentReplyComposer textarea. Send remains a separate click.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface AiSuggestionPaneProps {
  ticketId: string;
  onInsertDraft: (text: string) => void;
}

export interface TagEntry {
  tag: string;
  confidence: number;
}

interface SuggestionRow {
  ticket_id: string;
  suggested_tags: unknown;
  suggested_route_user_id: string | null;
  suggested_route_confidence: number | null;
  draft_reply: string | null;
  sentiment_score: number | null;
  created_at: string;
}

function sentimentColor(score: number | null): string {
  if (score === null) return 'text-[var(--color-text-secondary)]';
  if (score <= -0.6) return 'text-danger';
  if (score <= -0.3) return 'text-warning';
  return 'text-[var(--color-success)]';
}

function parseTags(raw: unknown): TagEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is { tag: unknown; confidence: unknown } => typeof t === 'object' && t !== null)
    .map((t) => ({
      tag: typeof t.tag === 'string' ? t.tag : 'unknown',
      confidence: typeof t.confidence === 'number' ? t.confidence : 0,
    }));
}

export default function AiSuggestionPane({
  ticketId,
  onInsertDraft,
}: AiSuggestionPaneProps): React.JSX.Element {
  const [row, setRow] = useState<SuggestionRow | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [showFull, setShowFull] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick(): Promise<void> {
      attempts += 1;
      const { data, error } = (await (supabase
        .from('ticket_ai_suggestions')
        .select(
          'ticket_id, suggested_tags, suggested_route_user_id, suggested_route_confidence, draft_reply, sentiment_score, created_at',
        )
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false })
        .limit(1)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .maybeSingle() as any)) as {
        data: SuggestionRow | null;
        error: { code?: string } | null;
      };
      if (cancelled) return;
      if (error) {
        console.warn('[helpdesk/ai-suggestion] load-failed', error.code ?? 'unknown');
      }
      if (data) {
        setRow(data);
        setLoading(false);
        return; // Stop polling once we have a row.
      }
      setLoading(false);
      // No row yet — poll every 5s for up to 30s total (6 attempts).
      if (attempts < 6) {
        timer = setTimeout(tick, 5000);
      }
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [ticketId]);

  if (loading) {
    return (
      <div
        aria-live="polite"
        className="p-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)]"
      >
        <span className="text-xs text-[var(--color-text-secondary)]">Loading AI suggestion…</span>
      </div>
    );
  }

  if (!row) {
    return (
      <div
        aria-live="polite"
        className="p-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)]"
      >
        <span className="text-xs text-[var(--color-text-secondary)]">
          AI is still classifying this ticket…
        </span>
      </div>
    );
  }

  const tags = parseTags(row.suggested_tags);
  const draft = row.draft_reply ?? '';
  const displayDraft = draft.length > 400 && !showFull ? `${draft.slice(0, 400)}…` : draft;

  return (
    <section
      aria-live="polite"
      className="flex flex-col gap-3 p-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">AI Suggestion</h3>
        {row.sentiment_score !== null ? (
          <span className={`text-xs font-semibold ${sentimentColor(row.sentiment_score)}`}>
            Sentiment: {row.sentiment_score.toFixed(2)}
          </span>
        ) : null}
      </header>

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <span
              key={t.tag}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-pill bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)]"
            >
              {t.tag}
              <span className="opacity-70">({Math.round(t.confidence * 100)}%)</span>
            </span>
          ))}
        </div>
      ) : null}

      {row.suggested_route_user_id ? (
        <div className="text-xs text-[var(--color-text-secondary)]">
          Suggested route: agent{' '}
          <code className="font-mono">{row.suggested_route_user_id.slice(0, 8)}</code>
          {row.suggested_route_confidence !== null ? (
            <span className="opacity-70">
              {' '}
              ({Math.round(row.suggested_route_confidence * 100)}%)
            </span>
          ) : null}
        </div>
      ) : null}

      {draft.length > 0 ? (
        <div className="flex flex-col gap-2">
          <pre
            data-sentry-mask
            className="whitespace-pre-wrap text-xs p-2 rounded bg-[var(--color-bg)] border border-[var(--color-border)]"
          >
            {displayDraft}
          </pre>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onInsertDraft(draft)}
              className="text-xs font-semibold px-3 py-1.5 rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
            >
              Insert draft into composer
            </button>
            {draft.length > 400 ? (
              <button
                type="button"
                onClick={() => setShowFull((v) => !v)}
                className="text-xs text-[var(--color-text-secondary)] underline"
              >
                {showFull ? 'Collapse' : 'Show full'}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
