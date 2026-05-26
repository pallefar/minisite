/**
 * TipOfTheDayCard.test.tsx — Vitest unit tests for TipOfTheDayCard
 *
 * Phase 60 Plan 60-11 Task 5 (TDD RED → GREEN).
 *
 * Run: cd leanshot && npx vitest run --config vite.config.ts src/components/dashboard/cards/__tests__/TipOfTheDayCard.test.tsx
 *
 * Tests:
 *   1. Renders card with all UI-SPEC §6 elements when row present
 *   2. Returns null when no row for today (D-24 empty state)
 *   3. Shows skeleton during loading; reduced-motion disables animation
 *   4. Fires rag_tip_impression server event on mount
 *   5. rag_tip_clicked emitted on Open source link click
 */

import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ──────────────────────────────────────────────────────────────────────────────
// Mock @/lib/supabase
// ──────────────────────────────────────────────────────────────────────────────

const mockInvoke = vi.fn();
const mockMaybeSingle = vi.fn();
const mockFrom = vi.fn(() => ({
  select: vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: mockMaybeSingle,
      })),
    })),
  })),
}));
const mockFunctions = { invoke: mockInvoke };

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    functions: mockFunctions,
  },
}));

// ──────────────────────────────────────────────────────────────────────────────
// Mock @/lib/store (for user id)
// ──────────────────────────────────────────────────────────────────────────────

vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: unknown) => unknown) =>
    selector({
      user: { id: 'test-user-id-123' },
    }),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Mock useReducedMotion (default: false, overrideable per test)
// ──────────────────────────────────────────────────────────────────────────────

const mockReducedMotion = vi.fn(() => false);
vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReducedMotion(),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Fixture
// ──────────────────────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);

const SEEDED_ROW = {
  id: 'row-id-1',
  chunk_id: 'chunk-id-abc',
  headline: 'GLP-1 receptor agonists affect gastric emptying timing.',
  body: 'GLP-1 receptor agonists slow gastric emptying, which can affect oral medication absorption.',
  source_name: 'FDA Label',
  source_tier: 'A' as const,
  evidence_date: '2024-01-15',
  canonical_url: 'https://example.test/fda-label',
  topic_tag: 'glp1-mechanism',
  topic_slug: 'glp1-mechanism',
};

// ──────────────────────────────────────────────────────────────────────────────
// Import component AFTER mocks
// ──────────────────────────────────────────────────────────────────────────────

// Dynamic import ensures mocks are applied before module loads
let TipOfTheDayCard: React.ComponentType;

beforeEach(async () => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue({ data: null, error: null });
  const mod = await import('../TipOfTheDayCard');
  TipOfTheDayCard = mod.TipOfTheDayCard;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 2: null when no row for today
// ──────────────────────────────────────────────────────────────────────────────

describe('TipOfTheDayCard', () => {
  it('returns null (no DOM element) when no row exists for today', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const { container } = render(<TipOfTheDayCard />);

    await waitFor(() => {
      expect(container.querySelector('[data-testid="tip-of-day-card"]')).toBeNull();
      expect(container.querySelector('[data-testid="tip-of-day-skeleton"]')).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // Test 1: renders all UI-SPEC §6 elements
  // ──────────────────────────────────────────────────────────────────────────────

  it('renders card with all UI-SPEC §6 elements when row present', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: SEEDED_ROW, error: null });

    render(<TipOfTheDayCard />);

    await waitFor(() => {
      expect(screen.getByTestId('tip-of-day-card')).toBeInTheDocument();
    });

    // Eyebrow
    expect(screen.getByText('TIP OF THE DAY')).toBeInTheDocument();

    // Topic-tag Pill
    expect(screen.getByText('glp1-mechanism')).toBeInTheDocument();

    // Headline
    expect(screen.getByText(SEEDED_ROW.headline)).toBeInTheDocument();

    // Body
    expect(screen.getByText(SEEDED_ROW.body)).toBeInTheDocument();

    // Footer attribution (source_name + evidence_date)
    expect(screen.getByText(/FDA Label/)).toBeInTheDocument();
    expect(screen.getByText(/2024-01-15/)).toBeInTheDocument();

    // Open source link
    const link = screen.getByRole('link', { name: /Open source/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', `/knowledge/${SEEDED_ROW.topic_tag}/${SEEDED_ROW.topic_slug}`);

    // Disclaimer
    expect(screen.getByText('Not medical advice — consult your clinician.')).toBeInTheDocument();

    // RotateCcw button
    const rotateBtn = screen.getByRole('button', { name: 'Show another tip' });
    expect(rotateBtn).toBeInTheDocument();
    expect(rotateBtn).toHaveAttribute('aria-disabled', 'true');
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // Test 3: skeleton during load, reduced-motion disables animation
  // ──────────────────────────────────────────────────────────────────────────────

  it('shows skeleton during loading', async () => {
    // Never resolves during this test
    mockMaybeSingle.mockImplementation(() => new Promise(() => {}));

    render(<TipOfTheDayCard />);

    expect(screen.getByTestId('tip-of-day-skeleton')).toBeInTheDocument();
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // Test 4: rag_tip_impression fired on mount
  // ──────────────────────────────────────────────────────────────────────────────

  it('fires rag_tip_impression server event on mount', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: SEEDED_ROW, error: null });

    render(<TipOfTheDayCard />);

    await waitFor(() => {
      expect(screen.getByTestId('tip-of-day-card')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'server-rag-event-relay',
        expect.objectContaining({
          body: expect.objectContaining({
            event: 'rag_tip_impression',
            distinct_id: 'test-user-id-123',
          }),
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // Test 5: rag_tip_clicked emitted on Open source click
  // ──────────────────────────────────────────────────────────────────────────────

  it('emits rag_tip_clicked on Open source link click', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: SEEDED_ROW, error: null });

    render(<TipOfTheDayCard />);

    await waitFor(() => {
      expect(screen.getByTestId('tip-of-day-card')).toBeInTheDocument();
    });

    const link = screen.getByRole('link', { name: /Open source/i });

    // Reset invocations to isolate click event
    mockInvoke.mockClear();

    await userEvent.click(link);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'server-rag-event-relay',
        expect.objectContaining({
          body: expect.objectContaining({
            event: 'rag_tip_clicked',
            distinct_id: 'test-user-id-123',
          }),
        }),
      );
    });
  });
});
