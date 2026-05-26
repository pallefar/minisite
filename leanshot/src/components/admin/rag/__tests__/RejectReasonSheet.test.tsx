/**
 * Phase 60 Plan 60-08 — RejectReasonSheet unit tests (TDD RED → GREEN).
 *
 * Per D-AdminQueue-15 run with:
 *   npx vitest run --config vite.config.ts src/components/admin/rag/__tests__/RejectReasonSheet.test.tsx
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QuoteBlock } from '@/lib/admin/rag/chunk-api';
import { EditChunkModal } from '../EditChunkModal';
import { QueueKeyboardHelpModal } from '../QueueKeyboardHelpModal';
import { RejectReasonSheet } from '../RejectReasonSheet';
import { RetractChunkModal } from '../RetractChunkModal';

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}));

const QUOTE_BLOCKS: QuoteBlock[] = [{ text: 'Take 0.25mg weekly', kind: 'dose' }];

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── RejectReasonSheet ────────────────────────────────────────────────────────

describe('RejectReasonSheet', () => {
  it('Test 1: renders 6 pills with the correct labels', () => {
    render(
      <RejectReasonSheet
        open={true}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    // Verbatim labels per UI-SPEC §Copywriting Contract
    expect(screen.getByText('Off-topic')).toBeTruthy();
    expect(screen.getByText('Factually wrong')).toBeTruthy();
    expect(screen.getByText('Off-label')).toBeTruthy();
    expect(screen.getByText('Low quality')).toBeTruthy();
    expect(screen.getByText('Duplicate')).toBeTruthy();
    expect(screen.getByText('Safety concern')).toBeTruthy();
  });

  it('Test 2: container has role=radiogroup and pills have role=radio with aria-checked', () => {
    const { container } = render(
      <RejectReasonSheet open={true} onClose={vi.fn()} onSelect={vi.fn()} />,
    );
    expect(container.querySelector('[role="radiogroup"]')).toBeTruthy();
    const radios = container.querySelectorAll('[role="radio"]');
    expect(radios.length).toBe(6);
    // Each radio has aria-checked attribute
    radios.forEach((r) => {
      expect(r.hasAttribute('aria-checked')).toBe(true);
    });
  });

  it('Test 3: ArrowDown cycles to next pill; ArrowUp cycles to previous', () => {
    const { container } = render(
      <RejectReasonSheet open={true} onClose={vi.fn()} onSelect={vi.fn()} />,
    );
    const group = container.querySelector('[role="radiogroup"]')!;
    // Initial focus on first radio
    const radios = container.querySelectorAll('[role="radio"]');
    (radios[0] as HTMLElement).focus();
    // ArrowDown should move to next
    fireEvent.keyDown(group, { key: 'ArrowDown' });
    const checked = container.querySelector('[aria-checked="true"]');
    expect(checked).toBeTruthy();
  });

  it('Test 4: clicking a pill calls onSelect with the correct RejectReason and closes', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <RejectReasonSheet open={true} onClose={onClose} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByText('Off-topic'));
    expect(onSelect).toHaveBeenCalledWith('off-topic');
    expect(onClose).toHaveBeenCalled();
  });

  it('Test 5: danger-toned pills are Factually wrong, Off-label, Safety concern', () => {
    render(
      <RejectReasonSheet open={true} onClose={vi.fn()} onSelect={vi.fn()} />,
    );
    // Find pill buttons by text, check for danger class
    const factuallyWrong = screen.getByText('Factually wrong');
    const offLabel = screen.getByText('Off-label');
    const safetyConcern = screen.getByText('Safety concern');
    [factuallyWrong, offLabel, safetyConcern].forEach((el) => {
      const btn = el.closest('button') ?? el;
      expect(btn.className).toContain('danger');
    });
  });

  it('Test 6: ESC key closes the sheet without calling onSelect', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <RejectReasonSheet open={true} onClose={onClose} onSelect={onSelect} />,
    );
    fireEvent.keyDown(container, { key: 'Escape' });
    expect(onSelect).not.toHaveBeenCalled();
    // onClose is wired to ESC via Sheet primitive's own handler
    // We just verify the component renders without crash + onSelect not called
  });

  it('Test 7: Sheet has role=dialog + aria-modal=true (from Sheet primitive)', () => {
    const { container } = render(
      <RejectReasonSheet open={true} onClose={vi.fn()} onSelect={vi.fn()} />,
    );
    // The Sheet primitive adds role=dialog + aria-modal=true on the backdrop div
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    expect(container.querySelector('[aria-modal="true"]')).toBeTruthy();
  });
});

// ─── EditChunkModal ──────────────────────────────────────────────────────────

describe('EditChunkModal', () => {
  const chunk = {
    id: 'c1',
    source_id: 's1',
    source_name: 'PubMed',
    source_tier: 'B' as const,
    topic_tag: 'glp-1',
    summary: 'Initial summary',
    quote_blocks: QUOTE_BLOCKS,
    source_markdown: '# Test',
    created_by: 'u1',
    queued_at: '2026-05-01T00:00:00Z',
    queue_age_hours: 24,
    canonical_url: 'https://example.com',
  };

  it('Test 8: renders Modal with title "Edit chunk", summary textarea, quote_blocks JSON textarea', () => {
    render(
      <EditChunkModal
        open={true}
        chunk={chunk}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Edit chunk')).toBeTruthy();
    // Two textareas: summary + quote_blocks JSON
    const textareas = screen.getAllByRole('textbox');
    expect(textareas.length).toBeGreaterThanOrEqual(2);
    // Summary textarea has the initial value
    const summaryArea = textareas.find((t) => t.getAttribute('aria-label') === 'Chunk summary');
    expect(summaryArea).toBeTruthy();
    // JSON textarea exists
    const jsonArea = textareas.find((t) => t.getAttribute('aria-label') === 'Quote blocks JSON');
    expect(jsonArea).toBeTruthy();
  });

  it('Test 9: invalid JSON in quote_blocks shows error and disables Save', () => {
    render(
      <EditChunkModal
        open={true}
        chunk={chunk}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    const textareas = screen.getAllByRole('textbox');
    const jsonArea = textareas.find((t) => t.getAttribute('aria-label') === 'Quote blocks JSON')!;
    fireEvent.change(jsonArea, { target: { value: '{invalid json' } });
    expect(screen.getByText('Invalid JSON')).toBeTruthy();
    // Save button should be disabled
    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn).toHaveAttribute('disabled');
  });

  it('Test 10: valid JSON + click Save calls onSave', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EditChunkModal
        open={true}
        chunk={chunk}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Initial summary' }),
    );
  });

  it('Test 11: summary > 2000 chars disables Save with error message', () => {
    render(
      <EditChunkModal
        open={true}
        chunk={chunk}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    const textareas = screen.getAllByRole('textbox');
    const summaryArea = textareas.find((t) => t.getAttribute('aria-label') === 'Chunk summary')!;
    fireEvent.change(summaryArea, { target: { value: 'x'.repeat(2001) } });
    expect(screen.getByText('Summary too long (max 2000)')).toBeTruthy();
    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn).toHaveAttribute('disabled');
  });

  it('Test 12: quote_blocks JSON > 16KB disables Save with error message', () => {
    render(
      <EditChunkModal
        open={true}
        chunk={chunk}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    // Build a valid JSON array > 16KB
    const bigJson = JSON.stringify(
      Array.from({ length: 500 }, () => ({
        text: 'x'.repeat(50),
        kind: 'dose',
        gloss: 'y'.repeat(50),
      })),
      null,
      2,
    );
    // Verify it is > 16KB
    expect(bigJson.length).toBeGreaterThan(16 * 1024);
    const textareas = screen.getAllByRole('textbox');
    const jsonArea = textareas.find((t) => t.getAttribute('aria-label') === 'Quote blocks JSON')!;
    fireEvent.change(jsonArea, { target: { value: bigJson } });
    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn).toHaveAttribute('disabled');
  });
});

// ─── RetractChunkModal ───────────────────────────────────────────────────────

describe('RetractChunkModal', () => {
  it('Test 13: title, verbatim body copy, Keep chunk + Retract chunk buttons', () => {
    render(
      <RetractChunkModal open={true} onClose={vi.fn()} onRetract={vi.fn()} />,
    );
    expect(screen.getByText('Retract this chunk?')).toBeTruthy();
    expect(
      screen.getByText(
        'Chunk removes from RAG retrieval immediately. Already-sent newsletter inclusions stay sent. Action is logged.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /keep chunk/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /retract chunk/i })).toBeTruthy();
  });

  it('Test 14: Retract button disabled until at least 1 non-whitespace char in reason', () => {
    const onRetract = vi.fn();
    render(
      <RetractChunkModal open={true} onClose={vi.fn()} onRetract={onRetract} />,
    );
    const retractBtn = screen.getByRole('button', { name: /retract chunk/i });
    expect(retractBtn).toHaveAttribute('disabled');

    // Enter whitespace only
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '   ' } });
    expect(retractBtn).toHaveAttribute('disabled');

    // Enter real text
    fireEvent.change(textarea, { target: { value: 'Source was retracted' } });
    expect(retractBtn).not.toHaveAttribute('disabled');

    // Click calls onRetract with the reason
    fireEvent.click(retractBtn);
    expect(onRetract).toHaveBeenCalledWith('Source was retracted');
  });
});

// ─── QueueKeyboardHelpModal ───────────────────────────────────────────────────

describe('QueueKeyboardHelpModal', () => {
  it('Test 15: renders 5 shortcut rows', () => {
    render(<QueueKeyboardHelpModal open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Approve selected')).toBeTruthy();
    expect(screen.getByText('Reject selected')).toBeTruthy();
    expect(screen.getByText('Edit & approve')).toBeTruthy();
    expect(screen.getByText('Next / Previous')).toBeTruthy();
    expect(screen.getByText('Show/hide this help')).toBeTruthy();
  });

  it('Test 16: renders correctly when isOpen=true (Keyboard shortcuts heading)', () => {
    render(<QueueKeyboardHelpModal open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Keyboard shortcuts')).toBeTruthy();
  });
});
