/**
 * Phase 23 Plan 23-03 — PatientActivityModal.test.tsx
 *
 * Vitest + React Testing Library coverage for PatientActivityModal:
 *
 *   1. Renders nothing when open=false.
 *   2. Renders skeleton rows during fetch (loading state).
 *   3. Renders a merged 12-entry timeline (2 per table) sorted newest-first.
 *   4. Renders empty-state copy when all 6 queries return [].
 *   5. Renders partial timeline when one category (workouts) rejects.
 *   6. Calls onClose when Esc is pressed (delegated to Modal primitive).
 *   7. Accessibility: role="dialog" + aria-modal="true" present when open.
 *   8. No s.user! usage in source (belt-and-suspenders ESLint guard).
 *   9. Renders correct kind badges for each category.
 *  10. formatRelativeTs returns sensible strings for known inputs.
 *
 * Mocking strategy:
 *   - vi.mock('@/lib/supabase') — chainable builder that tests override via
 *     mockFromReturnValue(). All 6 table queries resolve independently.
 *   - framer-motion AnimatePresence: tests override `open` prop directly;
 *     Modal renders via conditional inside AnimatePresence so the component
 *     IS rendered when open=true (real Modal logic, not mocked).
 *
 * No s.user! assertions — Phase 23 DEBT-02 ESLint rule enforces on source;
 * Test 8 provides a belt-and-suspenders file-content assertion.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PatientActivityModal, formatRelativeTs } from './PatientActivityModal';

// ---------------------------------------------------------------------------
// Shared mock state (set per-test in beforeEach)
// ---------------------------------------------------------------------------

// These hold the per-test resolve/reject functions for each table query.
let mockInjectionsResult: { data: unknown[] | null; error: unknown | null } = {
  data: [],
  error: null,
};
let mockWeightsResult: { data: unknown[] | null; error: unknown | null } = {
  data: [],
  error: null,
};
let mockMealsResult: { data: unknown[] | null; error: unknown | null } = {
  data: [],
  error: null,
};
let mockWorkoutsResult: { data: unknown[] | null; error: unknown | null } = {
  data: [],
  error: null,
};
let mockSymptomsResult: { data: unknown[] | null; error: unknown | null } = {
  data: [],
  error: null,
};
let mockPhotosResult: { data: unknown[] | null; error: unknown | null } = {
  data: [],
  error: null,
};

// ---------------------------------------------------------------------------
// Mock supabase
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase', () => {
  // Chainable builder: from().select().eq().order().limit() → resolves
  const makeChain = (getResult: () => { data: unknown[] | null; error: unknown | null }) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => Promise.resolve(getResult()),
    };
    return chain;
  };

  const fromFn = vi.fn((table: string) => {
    switch (table) {
      case 'injections':
        return makeChain(() => mockInjectionsResult);
      case 'weights':
        return makeChain(() => mockWeightsResult);
      case 'meals':
        return makeChain(() => mockMealsResult);
      case 'workouts':
        return makeChain(() => mockWorkoutsResult);
      case 'symptoms':
        return makeChain(() => mockSymptomsResult);
      case 'photos':
        return makeChain(() => mockPhotosResult);
      default:
        return makeChain(() => ({ data: [], error: null }));
    }
  });

  return {
    supabase: {
      from: fromFn,
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    },
  };
});

// Mock framer-motion to avoid animation issues in jsdom
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Test helpers — sample data fixtures
// ---------------------------------------------------------------------------

const PATIENT_ID = 'patient-uuid-1234';

/** Two injection rows, newer first */
const injectionRows = [
  {
    log_id: 'inj-1',
    dose: '0.5',
    unit: 'mg',
    medication: 'semaglutide',
    site: 'abdomen',
    logged_at: new Date('2026-05-16T10:00:00Z').toISOString(),
  },
  {
    log_id: 'inj-2',
    dose: '0.25',
    unit: 'mg',
    medication: 'semaglutide',
    site: null,
    logged_at: new Date('2026-05-09T10:00:00Z').toISOString(),
  },
];

const weightRows = [
  { weight_id: 'w-1', weight: 82.5, date: '2026-05-16', body_fat: 22.1, ts: new Date('2026-05-16T08:00:00Z').getTime() },
  { weight_id: 'w-2', weight: 84.0, date: '2026-05-09', body_fat: null, ts: new Date('2026-05-09T08:00:00Z').getTime() },
];

const mealRows = [
  { meal_id: 'm-1', name: 'Oatmeal', calories: 350, date: '2026-05-16', ts: new Date('2026-05-16T07:00:00Z').getTime() },
  { meal_id: 'm-2', name: 'Chicken salad', calories: 450, date: '2026-05-09', ts: new Date('2026-05-09T07:00:00Z').getTime() },
];

const workoutRows = [
  { workout_id: 'wo-1', name: 'Morning run', type: 'cardio', minutes: 30, date: '2026-05-15', ts: new Date('2026-05-15T06:00:00Z').getTime() },
  { workout_id: 'wo-2', name: 'Strength', type: 'resistance', minutes: 45, date: '2026-05-14', ts: new Date('2026-05-14T06:00:00Z').getTime() },
];

const symptomRows = [
  { symptom_id: 's-1', symptom: 'nausea', severity: 2, date: '2026-05-16', created_at: new Date('2026-05-16T09:00:00Z').toISOString() },
  { symptom_id: 's-2', symptom: 'fatigue', severity: 3, date: '2026-05-15', created_at: new Date('2026-05-15T09:00:00Z').toISOString() },
];

const photoRows = [
  { photo_id: 'p-1', storage_path: 'user1/photos/p-1.jpg', date: '2026-05-10' },
  { photo_id: 'p-2', storage_path: 'user1/photos/p-2.jpg', date: '2026-05-03' },
];

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('PatientActivityModal', () => {
  const onCloseFn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all queries return empty
    mockInjectionsResult = { data: [], error: null };
    mockWeightsResult = { data: [], error: null };
    mockMealsResult = { data: [], error: null };
    mockWorkoutsResult = { data: [], error: null };
    mockSymptomsResult = { data: [], error: null };
    mockPhotosResult = { data: [], error: null };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test 1 — renders nothing when open=false
  // -------------------------------------------------------------------------

  it('renders nothing (no dialog) when open=false', () => {
    const { container } = render(
      <PatientActivityModal patientId={PATIENT_ID} open={false} onClose={onCloseFn} />,
    );
    // AnimatePresence with open=false should render nothing inside the dialog
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 2 — renders skeleton during fetch (loading state)
  // -------------------------------------------------------------------------

  it('renders loading skeleton rows while fetches are in flight', async () => {
    // Delay the resolution so we can assert the loading state
    let resolveInjections!: () => void;
    const pendingInjections = new Promise<{ data: unknown[]; error: null }>((resolve) => {
      resolveInjections = () => resolve({ data: [], error: null });
    });

    mockInjectionsResult = { data: null, error: null };
    // Intercept the from('injections') chain to return pending
    const { supabase: mockSupabase } = await import('@/lib/supabase');
    (mockSupabase.from as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => pendingInjections,
          }),
        }),
      }),
    }));

    await act(async () => {
      render(
        <PatientActivityModal patientId={PATIENT_ID} open={true} onClose={onCloseFn} />,
      );
    });

    expect(screen.getByTestId('activity-loading')).toBeInTheDocument();

    // Resolve and clean up
    resolveInjections();
  });

  // -------------------------------------------------------------------------
  // Test 3 — renders 12 merged timeline entries sorted newest-first
  // -------------------------------------------------------------------------

  it('renders 12-entry merged timeline sorted newest-first when all 6 tables return data', async () => {
    mockInjectionsResult = { data: injectionRows, error: null };
    mockWeightsResult = { data: weightRows, error: null };
    mockMealsResult = { data: mealRows, error: null };
    mockWorkoutsResult = { data: workoutRows, error: null };
    mockSymptomsResult = { data: symptomRows, error: null };
    mockPhotosResult = { data: photoRows, error: null };

    await act(async () => {
      render(
        <PatientActivityModal patientId={PATIENT_ID} open={true} onClose={onCloseFn} />,
      );
    });

    await waitFor(() => {
      const timeline = screen.getByTestId('activity-timeline');
      expect(timeline).toBeInTheDocument();
    });

    const rows = screen.getAllByTestId('activity-row');
    expect(rows).toHaveLength(12); // 2 × 6 tables

    // First row should be the newest entry (injection at 2026-05-16T10:00:00Z)
    const firstRow = rows[0];
    expect(firstRow).toHaveTextContent('Injection');
    expect(firstRow).toHaveTextContent('0.5 mg');
  });

  // -------------------------------------------------------------------------
  // Test 4 — renders empty state when all 6 queries return []
  // -------------------------------------------------------------------------

  it('renders empty-state copy when all 6 queries return []', async () => {
    // All mocks return empty arrays (default from beforeEach)

    await act(async () => {
      render(
        <PatientActivityModal patientId={PATIENT_ID} open={true} onClose={onCloseFn} />,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('activity-empty')).toBeInTheDocument();
    });

    expect(screen.getByText('No logged activity yet for this patient.')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Test 5 — partial timeline when one category (workouts) rejects
  // -------------------------------------------------------------------------

  it('renders partial timeline (injections, etc.) when workouts fetch errors', async () => {
    mockInjectionsResult = { data: injectionRows, error: null };
    mockWeightsResult = { data: weightRows, error: null };
    mockMealsResult = { data: mealRows, error: null };
    mockWorkoutsResult = { data: null, error: { message: 'db error', code: '42501' } };
    mockSymptomsResult = { data: symptomRows, error: null };
    mockPhotosResult = { data: photoRows, error: null };

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await act(async () => {
      render(
        <PatientActivityModal patientId={PATIENT_ID} open={true} onClose={onCloseFn} />,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('activity-timeline')).toBeInTheDocument();
    });

    const rows = screen.getAllByTestId('activity-row');
    // 10 entries: 2 per remaining 5 tables (workouts excluded due to error)
    expect(rows).toHaveLength(10);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[PatientActivityModal] workouts fetch failed'),
      expect.anything(),
    );

    consoleSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Test 6 — calls onClose when Esc pressed (Modal primitive delegation)
  // -------------------------------------------------------------------------

  it('calls onClose when Escape key is pressed', async () => {
    await act(async () => {
      render(
        <PatientActivityModal patientId={PATIENT_ID} open={true} onClose={onCloseFn} />,
      );
    });

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    });

    expect(onCloseFn).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Test 7 — accessibility: role="dialog" + aria-modal="true" when open
  // -------------------------------------------------------------------------

  it('exposes role=dialog and aria-modal=true when open=true', async () => {
    await act(async () => {
      render(
        <PatientActivityModal patientId={PATIENT_ID} open={true} onClose={onCloseFn} />,
      );
    });

    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });
  });

  // -------------------------------------------------------------------------
  // Test 8 — no s.user! in source (belt-and-suspenders for ESLint rule)
  // -------------------------------------------------------------------------

  it('does not use s.user! non-null assertion in source file', () => {
    const sourcePath = resolve(
      __dirname,
      'PatientActivityModal.tsx',
    );
    const source = readFileSync(sourcePath, 'utf-8');
    // The Phase 23 ESLint rule blocks \.user! patterns; this belt-and-suspenders
    // assertion catches any slip before lint runs.
    expect(source).not.toMatch(/\.user!/);
  });

  // -------------------------------------------------------------------------
  // Test 9 — kind badges rendered for each category
  // -------------------------------------------------------------------------

  it('renders kind-specific badges (Injection, Weight, Meal, Workout, Symptom, Photo)', async () => {
    mockInjectionsResult = { data: [injectionRows[0]], error: null };
    mockWeightsResult = { data: [weightRows[0]], error: null };
    mockMealsResult = { data: [mealRows[0]], error: null };
    mockWorkoutsResult = { data: [workoutRows[0]], error: null };
    mockSymptomsResult = { data: [symptomRows[0]], error: null };
    mockPhotosResult = { data: [photoRows[0]], error: null };

    await act(async () => {
      render(
        <PatientActivityModal patientId={PATIENT_ID} open={true} onClose={onCloseFn} />,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('activity-timeline')).toBeInTheDocument();
    });

    expect(screen.getByText('Injection')).toBeInTheDocument();
    expect(screen.getByText('Weight')).toBeInTheDocument();
    expect(screen.getByText('Meal')).toBeInTheDocument();
    expect(screen.getByText('Workout')).toBeInTheDocument();
    expect(screen.getByText('Symptom')).toBeInTheDocument();
    expect(screen.getByText('Photo')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Test 10 — formatRelativeTs returns sensible strings
  // -------------------------------------------------------------------------

  describe('formatRelativeTs', () => {
    it('returns "just now" for a timestamp < 1 minute ago', () => {
      const ts = new Date(Date.now() - 30_000).toISOString();
      expect(formatRelativeTs(ts)).toBe('just now');
    });

    it('returns "Xm ago" for timestamps under an hour', () => {
      const ts = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(formatRelativeTs(ts)).toBe('5m ago');
    });

    it('returns "Xh ago" for timestamps under a day', () => {
      const ts = new Date(Date.now() - 3 * 3600_000).toISOString();
      expect(formatRelativeTs(ts)).toBe('3h ago');
    });

    it('returns "Xd ago" for timestamps under 30 days', () => {
      const ts = new Date(Date.now() - 7 * 86_400_000).toISOString();
      expect(formatRelativeTs(ts)).toBe('7d ago');
    });
  });
});
