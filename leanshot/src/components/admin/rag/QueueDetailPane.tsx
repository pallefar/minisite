/**
 * Phase 60 Plan 60-08 — QueueDetailPane.
 *
 * Side-by-side SOURCE TEXT vs EXTRACTED QUOTE pane + sticky action row.
 * DOMPurify sanitize on SOURCE TEXT per T-60-08-XSS-1.
 * 2-person rule UI layer per D-AdminQueue-02 + [[feedback_3_layer_must_never_invariant_pattern]].
 *
 * Typography: ONLY text-[11px] (text-micro) / text-[13px] (text-sm) / text-[18px] (text-lg).
 * Forbidden size tokens excluded per UI-SPEC Critical Invariant #11.
 */
import DOMPurify from 'dompurify';
import { ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { ReviewQueueRow } from '@/lib/admin/rag/chunk-api';
import { TierBadge } from './TierBadge';

// ─── DOMPurify allowlist per UI-SPEC §1 + T-60-08-XSS-1 ────────────────────
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['p', 'a', 'ul', 'ol', 'li', 'code', 'pre', 'strong', 'em', 'blockquote', 'mark', 'h2', 'h3', 'h4'],
  ALLOWED_ATTR: ['href', 'target', 'rel'],
  FORBID_TAGS: ['img', 'script', 'iframe', 'style', 'svg', 'math', 'form', 'input'],
  FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus'],
  ADD_ATTR: ['target', 'rel'],
};

// WR-04: Register afterSanitizeAttributes hook to force target=_blank + rel=noopener
// on all anchor elements in scraped source text. Prevents admin tab-napping via
// window.opener when source markdown contains external links.
// Hook registered once per module load (mirrors sanitize.ts / community/dompurify-config.ts).
let _adminHookRegistered = false;
function ensureAdminHook(): void {
  if (_adminHookRegistered) return;
  _adminHookRegistered = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if ('tagName' in node && (node as Element).tagName === 'A') {
      (node as Element).setAttribute('target', '_blank');
      (node as Element).setAttribute('rel', 'noopener noreferrer');
    }
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, (now - then) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

const TIERS = ['A', 'B', 'C'] as const;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface QueueDetailPaneProps {
  chunk: ReviewQueueRow;
  currentUserId: string | null;
  onApprove: () => Promise<void>;
  onReject: () => void;
  onEdit: () => void;
  onRetract?: () => void;
  onQueueWithEdits: (edits: { tier: 'A' | 'B' | 'C'; topicTag: string }) => Promise<void>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function QueueDetailPane({
  chunk,
  currentUserId,
  onApprove,
  onReject,
  onEdit,
  onRetract,
  onQueueWithEdits,
}: QueueDetailPaneProps) {
  const reducedMotion = useReducedMotion();
  const isSelfCreated = currentUserId !== null && currentUserId === chunk.created_by;
  const [editTier, setEditTier] = useState<'A' | 'B' | 'C'>(chunk.source_tier);
  const [editTopicTag, setEditTopicTag] = useState(chunk.topic_tag);
  const [savingEdits, setSavingEdits] = useState(false);
  const [approving, setApproving] = useState(false);

  // Sanitize source_markdown per T-60-08-XSS-1
  // Ensure the afterSanitizeAttributes hook is registered before sanitizing.
  // Cast to string: DOMPurify.sanitize returns TrustedHTML in strict TS contexts,
  // but it is always a string value at runtime.
  const sanitizedMarkdown = useMemo(
    () => {
      ensureAdminHook();
      return String(DOMPurify.sanitize(chunk.source_markdown, SANITIZE_CONFIG));
    },
    [chunk.source_markdown],
  );

  const handleApprove = async () => {
    if (isSelfCreated) return;
    setApproving(true);
    try {
      await onApprove();
    } finally {
      setApproving(false);
    }
  };

  const handleSaveEdits = async () => {
    setSavingEdits(true);
    try {
      await onQueueWithEdits({ tier: editTier, topicTag: editTopicTag });
    } finally {
      setSavingEdits(false);
    }
  };

  // Suppress unused variable warning for reducedMotion when only used in future framer variants
  void reducedMotion;

  return (
    <aside className="grid gap-4 lg:sticky lg:top-4 lg:self-start">
      {/* Header strip */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <a
            href={chunk.canonical_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] font-semibold text-[var(--color-primary)] hover:underline truncate"
          >
            {chunk.source_name}
          </a>
          <TierBadge tier={chunk.source_tier} />
          <span className="text-[11px] text-[var(--color-text-tertiary)]">
            Scraped {formatRelative(chunk.queued_at)}
          </span>
        </div>
        <a
          href={chunk.canonical_url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open canonical URL in new tab"
          className="text-[var(--color-text-tertiary)] hover:text-[var(--color-primary)] shrink-0"
        >
          <ExternalLink className="size-4" aria-hidden />
        </a>
      </div>

      {/* Inline tier/topic_tag edit row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-[var(--color-text-tertiary)]">Tier:</span>
        <div role="radiogroup" aria-label="Select tier" className="flex gap-1">
          {TIERS.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={editTier === t}
              onClick={() => setEditTier(t)}
              className={`h-7 w-10 rounded-pill text-[11px] font-semibold border transition-colors ${
                editTier === t
                  ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] border-[var(--color-primary)]'
                  : 'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] border-[var(--color-border)]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={editTopicTag}
          onChange={(e) => setEditTopicTag(e.target.value)}
          aria-label="Topic tag"
          className="h-7 px-2 text-[13px] border border-[var(--color-border)] rounded-pill bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
        />
        <Button
          size="sm"
          variant="ghost"
          loading={savingEdits}
          onClick={handleSaveEdits}
          aria-label="Save edits"
        >
          Save edits
        </Button>
      </div>

      {/* Side-by-side source text vs extracted quote */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Left: SOURCE TEXT */}
        <div className="bg-[var(--color-surface-soft,var(--color-surface-elevated))] p-4 rounded-md">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-2">
            SOURCE TEXT
          </p>
          <div className="prose prose-sm max-w-none text-[13px]">
            <ReactMarkdown rehypePlugins={[rehypeRaw]}>
              {sanitizedMarkdown}
            </ReactMarkdown>
          </div>
        </div>

        {/* Right: EXTRACTED QUOTE */}
        <div className="p-4 rounded-md border border-[var(--color-border)]">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-primary)] mb-2">
            EXTRACTED QUOTE
          </p>
          <div className="space-y-3">
            {chunk.quote_blocks.map((qb, i) => {
              const isDanger =
                qb.kind === 'contraindication' || qb.kind === 'adverse-event';
              return (
                <div key={i} className="space-y-1">
                  <p className="text-[13px] text-[var(--color-text)]">{qb.text}</p>
                  <div className="flex items-center gap-2">
                    <Badge tone={isDanger ? 'danger' : 'neutral'}>{qb.kind}</Badge>
                    {qb.gloss && (
                      <span className="text-[11px] text-[var(--color-text-secondary)]">
                        {qb.gloss}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Summary block */}
      <p className="text-[13px] text-[var(--color-text-secondary)]">{chunk.summary}</p>

      {/* 2-person rule warning badge */}
      {isSelfCreated && (
        <Badge tone="warning">You created this — needs a different reviewer</Badge>
      )}

      {/* Sticky action row */}
      <div className="sticky bottom-0 bg-[var(--color-surface)] border-t border-[var(--color-border)] p-3 flex items-center gap-2 justify-between">
        {/* Left: keyboard hint chips */}
        <div className="hidden md:flex items-center gap-1">
          {['A', 'R', 'E', 'J/K'].map((k) => (
            <kbd
              key={k}
              className="inline-flex items-center justify-center h-6 min-w-[1.5rem] px-1.5 rounded text-[11px] font-mono bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text-secondary)]"
            >
              {k}
            </kbd>
          ))}
        </div>

        {/* Right: action buttons */}
        <div className="flex items-center gap-2 ms-auto">
          {onRetract && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onRetract}
              className="text-[var(--color-danger)]"
            >
              Retract chunk
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={onReject}
            aria-label="Reject chunk"
          >
            Reject chunk
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Edit &amp; approve
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={handleApprove}
            disabled={isSelfCreated}
            aria-disabled={isSelfCreated}
            loading={approving}
            aria-busy={approving}
          >
            Approve chunk
          </Button>
        </div>
      </div>
    </aside>
  );
}

export default QueueDetailPane;
