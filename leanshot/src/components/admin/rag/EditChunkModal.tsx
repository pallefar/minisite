/**
 * Phase 60 Plan 60-08 — EditChunkModal.
 *
 * Full edit surface for chunk summary + quote_blocks JSON.
 * Save calls onSave({summary, quoteBlocks}) which triggers queue_rag_chunk re-queue.
 *
 * Validation per T-60-08-JSON-1 + T-60-08-DOS-1:
 *   - summary ≤ 2000 chars
 *   - quoteBlocks JSON ≤ 16KB
 *   - quoteBlocks must be valid JSON (parse error shown inline)
 *
 * role=dialog + aria-modal=true inherited from Modal primitive.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { QuoteBlock, ReviewQueueRow } from '@/lib/admin/rag/chunk-api';

export interface EditChunkModalProps {
  open: boolean;
  chunk: ReviewQueueRow;
  onClose: () => void;
  onSave: (fields: { summary: string; quoteBlocks: QuoteBlock[] }) => void | Promise<void>;
}

const MAX_SUMMARY = 2000;
const MAX_QUOTE_JSON = 16 * 1024;

export function EditChunkModal({ open, chunk, onClose, onSave }: EditChunkModalProps) {
  const [summary, setSummary] = useState(chunk.summary);
  const [quoteBlocksJson, setQuoteBlocksJson] = useState(
    JSON.stringify(chunk.quote_blocks, null, 2),
  );
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset when chunk identity changes. We intentionally only track `chunk.id`
  // because we want to reset the form when a different chunk is opened, not on
  // every intermediate prop change (which would clobber the user's draft edits).
  useEffect(() => {
    setSummary(chunk.summary);
    setQuoteBlocksJson(JSON.stringify(chunk.quote_blocks, null, 2));
    setParseError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunk.id]);

  const summaryError = summary.length > MAX_SUMMARY ? 'Summary too long (max 2000)' : null;
  const sizeError =
    quoteBlocksJson.length > MAX_QUOTE_JSON ? 'Quote blocks JSON too large (max 16KB)' : null;

  const handleJsonChange = (val: string) => {
    setQuoteBlocksJson(val);
    try {
      JSON.parse(val);
      setParseError(null);
    } catch {
      setParseError('Invalid JSON');
    }
  };

  const canSave = !parseError && !summaryError && !sizeError;

  const handleSave = () => {
    if (!canSave) return;
    let parsed: QuoteBlock[];
    try {
      parsed = JSON.parse(quoteBlocksJson) as QuoteBlock[];
    } catch {
      setParseError('Invalid JSON');
      return;
    }
    setSaving(true);
    const result = onSave({ summary, quoteBlocks: parsed });
    if (result instanceof Promise) {
      result.finally(() => setSaving(false));
    } else {
      setSaving(false);
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit chunk" size="lg">
      <div className="space-y-4">
        <div className="space-y-1">
          <label
            htmlFor="edit-chunk-summary"
            className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]"
          >
            Summary
          </label>
          <textarea
            id="edit-chunk-summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={4}
            className="w-full p-3 text-[13px] border border-[var(--color-border)] rounded-card bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] resize-y"
            aria-label="Chunk summary"
          />
          {summaryError && <p className="text-[11px] text-[var(--color-danger)]">{summaryError}</p>}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="edit-chunk-quote-blocks"
            className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]"
          >
            Quote blocks (JSON)
          </label>
          <textarea
            id="edit-chunk-quote-blocks"
            value={quoteBlocksJson}
            onChange={(e) => handleJsonChange(e.target.value)}
            rows={8}
            className="w-full p-3 text-[13px] font-mono border border-[var(--color-border)] rounded-card bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] resize-y"
            aria-label="Quote blocks JSON"
          />
          {parseError && <p className="text-[11px] text-[var(--color-danger)]">{parseError}</p>}
          {sizeError && <p className="text-[11px] text-[var(--color-danger)]">{sizeError}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canSave}
            loading={saving}
            onClick={handleSave}
          >
            Save &amp; re-queue
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default EditChunkModal;
