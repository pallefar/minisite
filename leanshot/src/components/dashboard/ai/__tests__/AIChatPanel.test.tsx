/**
 * Phase 60 Plan 60-10 Task 6 — AIChatPanel augmentation tests.
 *
 * Verifies:
 * - Regression: messages without citation markers render unchanged
 * - Citation markers render as [N] superscripts
 * - Clicking marker opens CitationPopover
 * - Refusal envelopes render RefusalCard (with correct kind + zero markers + zero footer)
 * - AI-04 fence preserved (ctx composition unchanged)
 * - User messages unaffected (role='user')
 * - UUID deduplication (3× same UUID → 1 Sources footer entry)
 *
 * Run: npx vitest run --config vite.config.ts src/components/dashboard/ai/__tests__/AIChatPanel.test.tsx
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from '@/lib/store';
import { AIChatPanel } from '../AIChatPanel';

// jsdom doesn't implement scrollIntoView — mock it globally for this test file
Element.prototype.scrollIntoView = vi.fn();

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { mockCallAIChat, mockRagChunkById, mockCaptureRagEventBrowser } = vi.hoisted(() => ({
  mockCallAIChat: vi.fn(),
  mockRagChunkById: vi.fn(),
  mockCaptureRagEventBrowser: vi.fn(),
}));

vi.mock('@/lib/ai', () => ({
  callAIChat: mockCallAIChat,
  RateLimitedError: class RateLimitedError extends Error {},
  AIUnavailableError: class AIUnavailableError extends Error {},
}));

vi.mock('@/lib/rag/retrieve-client', () => ({
  ragChunkById: mockRagChunkById,
}));

vi.mock('@/lib/rag/server-rag-events-relay', () => ({
  captureRagEventBrowser: mockCaptureRagEventBrowser,
}));

// ─── Store mock ───────────────────────────────────────────────────────────────

// Seed store with a test user + history

const TEST_USER = {
  id: 'test-user-1',
  name: 'Test User',
  email: 'test@example.com',
  medication: 'semaglutide',
  dose: 0.5,
  doseUnit: 'mg',
  startDate: '2024-01-01',
  startWeight: 100,
  goalWeight: 80,
  goal: 'weight_loss',
  liftingLevel: 'none',
  proteinTarget: 120,
  units: 'metric',
  sex: 'female',
  height: 165,
  dob: '1990-01-01',
  injectionSites: [],
} as const;

const UUID_A = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';
const UUID_B = 'b2c3d4e5-f6a7-8901-bcde-f01234567890';

function seedHistory(
  messages: Array<{ role: 'user' | 'assistant'; content: string; hasDataReference?: boolean }>,
) {
  useStore.setState({
    user: TEST_USER as Parameters<typeof useStore.getState>['0']['user'],
    aiHistory: messages,
    weights: [],
    symptoms: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCallAIChat.mockResolvedValue(undefined);
  mockCaptureRagEventBrowser.mockResolvedValue(undefined);
  mockRagChunkById.mockResolvedValue(null);

  // Reset store
  useStore.setState({
    user: null,
    aiHistory: [],
    weights: [],
    symptoms: [],
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AIChatPanel — citation augmentation', () => {
  // Test 1: existing messages WITHOUT citations render via existing Bubble path (regression-safe)
  it('Test 1: messages without citations render as plain text (regression-safe)', () => {
    seedHistory([{ role: 'assistant', content: 'Hello! How can I help you today?' }]);

    render(<AIChatPanel open onClose={vi.fn()} />);

    expect(screen.getByText('Hello! How can I help you today?')).toBeInTheDocument();
    // No citation markers
    expect(screen.queryByText(/\[\d+\]/)).toBeNull();
    // No sources footer
    expect(screen.queryByText(/Sources \(\d+\)/)).toBeNull();
  });

  // Test 2: assistant message with UUID → renders [1] marker + Sources footer
  it('Test 2: assistant message with UUID renders [1] marker and Sources footer', () => {
    seedHistory([
      { role: 'assistant', content: `Tirzepatide is dosed weekly. [${UUID_A}] starting at 2.5mg.` },
    ]);

    render(<AIChatPanel open onClose={vi.fn()} />);

    expect(screen.getByText('[1]')).toBeInTheDocument();
    expect(screen.getByText(/Sources \(1\)/)).toBeInTheDocument();
  });

  // Test 3: clicking [1] marker opens CitationPopover
  it('Test 3: clicking the [1] marker triggers CitationPopover mount', async () => {
    seedHistory([{ role: 'assistant', content: `See this reference. [${UUID_A}]` }]);

    render(<AIChatPanel open onClose={vi.fn()} />);

    const markerBtn = screen.getByRole('button', { name: /Open citation 1/i });
    fireEvent.click(markerBtn);

    // CitationPopover is now mounted — it calls ragChunkById (which we mocked to null)
    // and renders the error state
    await waitFor(() => {
      expect(mockRagChunkById).toHaveBeenCalledWith(UUID_A);
    });
  });

  // Test 4: [[REFUSAL:pharma_02]] renders RefusalCard kind=pharma_02
  it('Test 4: [[REFUSAL:pharma_02]] renders RefusalCard with locked PHARMA-02 copy', () => {
    seedHistory([
      { role: 'assistant', content: '[[REFUSAL:pharma_02]]\nThis topic is restricted.' },
    ]);

    render(<AIChatPanel open onClose={vi.fn()} />);

    expect(
      screen.getByText('That topic requires clinician guidance — please ask your doctor.'),
    ).toBeInTheDocument();
    // ZERO [N] markers
    expect(screen.queryByText(/\[\d+\]/)).toBeNull();
    // ZERO Sources footer
    expect(screen.queryByText(/Sources \(\d+\)/)).toBeNull();
  });

  // Test 5: [[REFUSAL:out_of_corpus]] renders RefusalCard kind=out_of_corpus
  it('Test 5: [[REFUSAL:out_of_corpus]] renders out_of_corpus RefusalCard', () => {
    seedHistory([{ role: 'assistant', content: '[[REFUSAL:out_of_corpus]]' }]);

    render(<AIChatPanel open onClose={vi.fn()} />);

    expect(screen.getByText(/I don't have evidence for that/)).toBeInTheDocument();
  });

  // Test 6: [[REFUSAL:citation_validation_failed]] renders correct RefusalCard
  it('Test 6: [[REFUSAL:citation_validation_failed]] renders citation_validation_failed RefusalCard', () => {
    seedHistory([{ role: 'assistant', content: '[[REFUSAL:citation_validation_failed]]' }]);

    render(<AIChatPanel open onClose={vi.fn()} />);

    expect(screen.getByText(/I'm not confident in the supporting evidence/)).toBeInTheDocument();
  });

  // Test 7: callAIChat receives userContext in the correct format (AI-04 fence preserved)
  it('Test 7: callAIChat userContext preserves AI-04 fence format (ctx composition unchanged)', async () => {
    seedHistory([]);

    render(<AIChatPanel open onClose={vi.fn()} />);

    // Type a message and send it
    const textarea = screen.getByPlaceholderText(/Ask anything/);
    fireEvent.change(textarea, { target: { value: 'What is my dose?' } });

    const sendBtn = screen.getByRole('button', { name: /Send/i });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(mockCallAIChat).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockCallAIChat.mock.calls[0][0] as { userContext?: string };
    // Verify the userContext starts with "User context: Name:" — AI-04 fence preserved
    expect(callArgs.userContext).toMatch(/^User context: Name:/);
    // And contains medication info
    expect(callArgs.userContext).toContain('semaglutide');
  });

  // Test 8: user messages render via existing right-aligned Bubble path
  it('Test 8: user messages render via existing right-aligned Bubble (no citation rendering)', () => {
    seedHistory([{ role: 'user', content: `This is my question with [${UUID_A}] in it.` }]);

    render(<AIChatPanel open onClose={vi.fn()} />);

    // User message renders verbatim — NO citation markers parsed (role='user')
    const userMsg = screen.getByText(`This is my question with [${UUID_A}] in it.`);
    expect(userMsg).toBeInTheDocument();
    // No citation marker button rendered
    expect(screen.queryByRole('button', { name: /Open citation/i })).toBeNull();
  });

  // Test 9: repeated UUID → only ONE Sources footer entry (deduplication)
  it('Test 9: repeated UUID in one message creates only ONE Sources footer entry', () => {
    seedHistory([
      {
        role: 'assistant',
        content: `First mention [${UUID_A}], second mention [${UUID_A}], third [${UUID_A}].`,
      },
    ]);

    render(<AIChatPanel open onClose={vi.fn()} />);

    // Three citation markers rendered (all refIndex=1)
    const markerBtns = screen.getAllByRole('button', { name: /Open citation 1/i });
    expect(markerBtns).toHaveLength(3);

    // But Sources footer shows Sources (1) — one unique citation
    expect(screen.getByText(/Sources \(1\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Sources \(3\)/)).toBeNull();
  });

  // Bonus: multiple distinct UUIDs → [1], [2] markers + Sources (2)
  it('Bonus: two distinct UUIDs render [1] + [2] markers + Sources (2)', () => {
    seedHistory([
      {
        role: 'assistant',
        content: `First [${UUID_A}] and second [${UUID_B}].`,
      },
    ]);

    render(<AIChatPanel open onClose={vi.fn()} />);

    expect(screen.getByText('[1]')).toBeInTheDocument();
    expect(screen.getByText('[2]')).toBeInTheDocument();
    expect(screen.getByText(/Sources \(2\)/)).toBeInTheDocument();
  });
});
