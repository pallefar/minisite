import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialState } from '@/lib/storage';
import { useStore } from '@/lib/store';
import type { User } from '@/types';
import { MedicationTab } from './MedicationTab';

// Chart.js requires a real canvas for resize/responsive handling, which jsdom
// doesn't provide. The chart is irrelevant to the G3 null-guard test surface,
// so stub MedLevelChart to a marker div. `vi.mock` calls are hoisted by Vitest
// above the import statements at compile time, so this still runs before the
// MedicationTab import resolves the real MedLevelChart.
vi.mock('@/components/dashboard/charts/MedLevelChart', () => ({
  MedLevelChart: () => <div data-testid="med-level-chart-stub" />,
}));

/**
 * Phase 5 Plan 05-06 — Gap G3 close.
 *
 * UAT Test 7 (05-UAT.md) reported a transient
 * `TypeError: Cannot read properties of null (reading 'dose')`
 * fired by MedicationTab during the signOut → SIGNED_OUT view transition.
 * `clearUserDataSlices()` sets `user: null` BEFORE App.tsx swaps the view,
 * so MedicationTab renders one final time with `user === null` and the
 * `useStore((s) => s.user!)` non-null assertion lies, crashing the next
 * `u.dose` deref.
 *
 * Fix in MedicationTab.tsx: nullable selector + null-guard early-return.
 * These two tests pin the fix:
 *   - G3-1: store has user=null → MedicationTab renders nothing and logs
 *     ZERO `Cannot read properties of null` console errors.
 *   - G3-2: store has a real user → happy-path rendering still works
 *     (Current dose tile, Log new injection form, Half-life badge).
 */

const FIXTURE_USER: User = {
  name: 'Test',
  units: 'metric',
  medication: 'mounjaro',
  dose: '2.5',
  doseUnit: 'mg',
  startDate: '2026-04-01',
  startWeight: 90,
  height: 170,
  age: 35,
  sex: 'female',
  bodyFat: null,
  goalWeight: 75,
  goal: 'fat-loss',
  proteinTarget: 120,
  calorieTarget: 1800,
  fiberTarget: 30,
  waterTarget: 8,
  injectionDay: 1,
  activityLevel: 'moderate',
  liftingLevel: 'beginner',
  createdAt: '2026-04-01T00:00:00.000Z',
};

describe('MedicationTab — Gap G3 null-guard (Plan 05-06)', () => {
  afterEach(() => {
    cleanup();
    useStore.setState({ ...initialState }, true);
    vi.restoreAllMocks();
  });

  it('G3-1: renders cleanly with no errors when user is null (SIGNED_OUT transition)', () => {
    // Replicate the exact store shape after clearUserDataSlices() runs:
    // user is null but the slot still exists.
    useStore.setState({ ...initialState, user: null, injections: [], vials: [], costs: [] }, true);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Render MUST NOT throw — the early-return guard kicks in.
    const { container } = render(<MedicationTab />);

    // Component returned null → root is empty.
    expect(container).toBeEmptyDOMElement();

    // The exact regression we're guarding against: zero "Cannot read properties
    // of null" console.error calls.
    const nullDerefCalls = errorSpy.mock.calls.filter((args) =>
      args.some((a) => typeof a === 'string' && /Cannot read properties of null/i.test(a)),
    );
    expect(nullDerefCalls).toHaveLength(0);
  });

  it('G3-2: renders Current dose tile and Log new injection form when user is non-null', () => {
    useStore.setState(
      { ...initialState, user: FIXTURE_USER, injections: [], vials: [], costs: [] },
      true,
    );

    render(<MedicationTab />);

    // Happy-path elements — proves the rename + guard didn't regress steady-state UI.
    expect(screen.getByText(/Current dose/i)).toBeInTheDocument();
    expect(screen.getByText(/Log new injection/i)).toBeInTheDocument();
    expect(screen.getByText(/Half-life/i)).toBeInTheDocument();
  });
});
