import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PK_DISCLAIMER_DOCTOR_REPORT } from '@/lib/disclaimers';
import { initialState } from '@/lib/storage';
import { useStore } from '@/lib/store';
import type { User } from '@/types';
import { DoctorReport } from './DoctorReport';

/**
 * RTL regression test for PK-04 + CONTEXT D-10.
 *
 * Asserts the DoctorReport modal renders the PK_DISCLAIMER_DOCTOR_REPORT
 * verbatim and the "Pharmacokinetic estimate:" label. If a future PR
 * removes or mutates the aside, these tests fail in CI — discharging
 * T-03-11 (Tampering/Repudiation of the PK disclaimer copy).
 */

const FIXTURE_USER: User = {
  name: 'Test Patient',
  units: 'metric',
  medication: 'wegovy',
  dose: '1.0',
  doseUnit: 'mg',
  startDate: '2026-01-01',
  startWeight: 100,
  height: 170,
  age: 35,
  sex: 'female',
  bodyFat: null,
  goalWeight: 80,
  goal: 'fat-loss',
  proteinTarget: 100,
  calorieTarget: 1800,
  fiberTarget: 30,
  waterTarget: 8,
  injectionDay: 1,
  activityLevel: 'moderate',
  liftingLevel: 'beginner',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('DoctorReport — Phase 3 PK disclaimer (PK-04 + D-10)', () => {
  beforeEach(() => {
    useStore.setState({ ...initialState, user: FIXTURE_USER });
  });

  afterEach(() => {
    // Unmount the modal BEFORE resetting state — framer-motion's AnimatePresence
    // exit transition still reads `u.units` from the store during teardown; resetting
    // user→null first triggers a "Cannot read properties of null" unhandled exception.
    cleanup();
    useStore.setState(initialState);
  });

  it('renders the PK_DISCLAIMER_DOCTOR_REPORT verbatim', () => {
    render(<DoctorReport open onClose={() => {}} />);
    expect(screen.getByText(PK_DISCLAIMER_DOCTOR_REPORT, { exact: false })).toBeTruthy();
  });

  it('renders the Pharmacokinetic estimate: label', () => {
    render(<DoctorReport open onClose={() => {}} />);
    expect(screen.getByText('Pharmacokinetic estimate:')).toBeTruthy();
  });
});
