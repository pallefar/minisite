/**
 * Phase 19 Plan 19-05 — `<InitialsAvatar>` unit tests.
 *
 * Coverage:
 *   T1: hashStringToHue is deterministic
 *   T2: hashStringToHue diverges across most distinct names
 *   T3: empty name renders '?' placeholder
 *   T4: size='sm' applies w-10 h-10; size='lg' applies w-[120px]
 *   T5: rounded='full' applies rounded-full (default 'card' uses rounded-card)
 *   T6: role='img' + aria-label set correctly
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InitialsAvatar, hashStringToHue } from '@/components/ui/InitialsAvatar';

describe('hashStringToHue', () => {
  it('T1 — returns the same hue for the same input (deterministic)', () => {
    expect(hashStringToHue('Alice')).toBe(hashStringToHue('Alice'));
    expect(hashStringToHue('Casey Creator')).toBe(hashStringToHue('Casey Creator'));
    // Stays within 0..359.
    const h = hashStringToHue('Alice');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });

  it('T2 — distinct names usually yield distinct hues (cross-name divergence)', () => {
    // Sample a small basket of names. With a 360-bucket modulo we expect
    // ≥4 distinct hues from these 5 names (true ratio is much higher;
    // the threshold is generous so it survives a hypothetical hash tweak).
    const names = ['Alice', 'Bob', 'Casey', 'Dakota', 'Eli'];
    const hues = new Set(names.map(hashStringToHue));
    expect(hues.size).toBeGreaterThanOrEqual(4);
    // Specific pair we care about: Alice vs Bob MUST differ.
    expect(hashStringToHue('Alice')).not.toBe(hashStringToHue('Bob'));
  });
});

describe('<InitialsAvatar />', () => {
  it('T3 — empty name renders the "?" placeholder', () => {
    render(<InitialsAvatar name="" />);
    const el = screen.getByRole('img');
    expect(el.textContent).toBe('?');
  });

  it('T3b — whitespace-only name also renders "?"', () => {
    render(<InitialsAvatar name="   " />);
    const el = screen.getByRole('img');
    expect(el.textContent).toBe('?');
  });

  it('T3c — first letter is uppercased', () => {
    render(<InitialsAvatar name="alice" />);
    const el = screen.getByRole('img');
    expect(el.textContent).toBe('A');
  });

  it('T4 — size="sm" applies w-10 h-10; size="lg" applies w-[120px]', () => {
    const { rerender } = render(<InitialsAvatar name="Alice" size="sm" />);
    let el = screen.getByRole('img');
    expect(el.className).toContain('w-10');
    expect(el.className).toContain('h-10');

    rerender(<InitialsAvatar name="Alice" size="lg" />);
    el = screen.getByRole('img');
    expect(el.className).toContain('w-[120px]');
    expect(el.className).toContain('md:w-[200px]');
  });

  it('T5 — rounded="full" applies rounded-full (default rounded-card)', () => {
    const { rerender } = render(<InitialsAvatar name="Alice" />);
    let el = screen.getByRole('img');
    expect(el.className).toContain('rounded-card');
    expect(el.className).not.toContain('rounded-full');

    rerender(<InitialsAvatar name="Alice" rounded="full" />);
    el = screen.getByRole('img');
    expect(el.className).toContain('rounded-full');
  });

  it('T6 — role="img" + aria-label set, tabIndex=-1', () => {
    render(<InitialsAvatar name="Casey Creator" />);
    const el = screen.getByRole('img');
    expect(el.getAttribute('aria-label')).toBe('Avatar for Casey Creator');
    expect(el.getAttribute('tabindex')).toBe('-1');
  });
});
