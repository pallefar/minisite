/**
 * Phase 39 Plan 39-07 Task 1 — TrafficSplitSlider tests (UI-SPEC).
 *
 * Contract:
 *   (a) 5 preset Pills with labels 10%, 20%, 50%, 80%, 90%
 *   (b) clicking preset → onChange(presetValue)
 *   (c) range input → onChange(newValue)
 *   (d) value prop is the displayed value
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrafficSplitSlider } from './TrafficSplitSlider';

describe('TrafficSplitSlider', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders 5 preset Pills with values 10/20/50/80/90', () => {
    render(<TrafficSplitSlider value={50} onChange={onChange} />);
    expect(screen.getByRole('button', { name: '10%' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '20%' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '50%' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '80%' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '90%' })).toBeInTheDocument();
  });

  it('clicking the 20% preset calls onChange(20)', () => {
    render(<TrafficSplitSlider value={50} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '20%' }));
    expect(onChange).toHaveBeenCalledWith(20);
  });

  it('changing the range input calls onChange with new numeric value', () => {
    render(<TrafficSplitSlider value={50} onChange={onChange} />);
    const range = screen.getByRole('slider');
    fireEvent.change(range, { target: { value: '37' } });
    expect(onChange).toHaveBeenCalledWith(37);
  });

  it('renders value=72 as the displayed value on the range', () => {
    render(<TrafficSplitSlider value={72} onChange={onChange} />);
    const range = screen.getByRole('slider') as HTMLInputElement;
    expect(range.value).toBe('72');
  });

  it('marks the active preset Pill as aria-pressed when value matches a preset', () => {
    render(<TrafficSplitSlider value={50} onChange={onChange} />);
    const fifty = screen.getByRole('button', { name: '50%' });
    expect(fifty).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '20%' })).toHaveAttribute('aria-pressed', 'false');
  });
});
