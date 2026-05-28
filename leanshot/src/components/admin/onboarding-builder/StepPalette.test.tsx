/**
 * Phase 34 Plan 34-08 ONBOARD-07 — StepPalette unit tests.
 *
 * Asserts the 8 D-16 chips render, tap-target sizing, click semantics, and
 * the createStepOfType defaults per step type.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CONSUMER_STEP_TYPES, CONSUMER_STEP_TYPE_LABELS } from '@/types/onboarding-step';
import StepPalette, { createStepOfType } from './StepPalette';

describe('StepPalette (Plan 34-08)', () => {
  it('renders 8 chips, one per consumer step type', () => {
    render(<StepPalette onAddStep={() => {}} />);
    for (const t of CONSUMER_STEP_TYPES) {
      const chip = screen.getByLabelText(`Add ${CONSUMER_STEP_TYPE_LABELS[t]} step`);
      expect(chip).toBeTruthy();
      expect(chip.getAttribute('data-step-type')).toBe(t);
    }
  });

  it('each chip has the min-h-[44px] tap target class', () => {
    render(<StepPalette onAddStep={() => {}} />);
    for (const t of CONSUMER_STEP_TYPES) {
      const chip = screen.getByLabelText(`Add ${CONSUMER_STEP_TYPE_LABELS[t]} step`);
      expect(chip.className).toMatch(/min-h-\[44px\]/);
    }
  });

  it('clicking a chip calls onAddStep with that step type', () => {
    const onAddStep = vi.fn();
    render(<StepPalette onAddStep={onAddStep} />);

    fireEvent.click(screen.getByLabelText('Add Single select step'));
    expect(onAddStep).toHaveBeenCalledWith('single-select');

    fireEvent.click(screen.getByLabelText('Add NPS step'));
    expect(onAddStep).toHaveBeenCalledWith('nps');

    expect(onAddStep).toHaveBeenCalledTimes(2);
  });
});

describe('createStepOfType (Plan 34-08)', () => {
  it('text step gets a field-defaulted node without options', () => {
    const step = createStepOfType('text');
    expect(step.type).toBe('text');
    expect(typeof step.id).toBe('string');
    expect(step.id.length).toBeGreaterThan(0);
    expect(step.field).toEqual({ key: '', required: false });
    expect(step.options).toBeUndefined();
  });

  it('single-select step has options: [] (defaulted for the type)', () => {
    const step = createStepOfType('single-select');
    expect(step.type).toBe('single-select');
    expect(step.options).toEqual([]);
    expect(step.field).toEqual({ key: '', required: false });
  });

  it('multi-select step has options: []', () => {
    const step = createStepOfType('multi-select');
    expect(step.options).toEqual([]);
  });

  it('custom-component step has no field metadata', () => {
    const step = createStepOfType('custom-component');
    expect(step.type).toBe('custom-component');
    expect(step.field).toBeUndefined();
    expect(step.options).toBeUndefined();
  });

  it('each generated step has a unique id', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      ids.add(createStepOfType('text').id);
    }
    expect(ids.size).toBe(10);
  });

  it('all steps carry an initial empty copy block', () => {
    for (const t of CONSUMER_STEP_TYPES) {
      const step = createStepOfType(t);
      expect(step.copy).toBeDefined();
      expect(step.copy?.title).toBe('');
      expect(step.copy?.subtitle).toBe('');
    }
  });
});
