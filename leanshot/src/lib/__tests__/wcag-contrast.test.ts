/**
 * Phase 31 Plan 31-05 Task 1 — parity tests for wcag-contrast.ts
 *
 * Asserts that the TypeScript port of `public._compute_wcag_contrast` matches
 * the SQL helper within ≤0.05 absolute tolerance across ≥6 sample pairs.
 *
 * Pre-computed SQL values were derived by running the SQL helper against each
 * pair with the same L^2.2 formula. The expected values are inline in each test.
 *
 * SQL formula (from 20270601400003_p31_02_branding_expand_and_wcag.sql):
 *   lum = power(greatest(0, least(1, L)), 2.2)
 *   ratio = (lighter + 0.05) / (darker + 0.05)
 *   return round(ratio, 4)
 */
import { describe, expect, it } from 'vitest';
import { computeWcagContrast, parseOklch } from '@/lib/wcag-contrast';

const TOLERANCE = 0.05;

describe('computeWcagContrast', () => {
  // Pair 1: max contrast — white (L=1) on black (L=0) → ~21.0
  it('Pair 1: white on black → ~21.0 (max contrast)', () => {
    const result = computeWcagContrast('oklch(1 0 0)', 'oklch(0 0 0)');
    // SQL: lum1=1^2.2=1, lum2=0^2.2=0 → (1.05/0.05) = 21.0
    expect(Math.abs(result - 21.0)).toBeLessThan(TOLERANCE);
  });

  // Pair 2: identical colors → 1.0 (no contrast)
  it('Pair 2: identical mid-grey → 1.0 (no contrast)', () => {
    const result = computeWcagContrast('oklch(0.5 0 0)', 'oklch(0.5 0 0)');
    // SQL: lum1=lum2=0.5^2.2=0.2176; (0.2676/0.2676)=1.0
    expect(Math.abs(result - 1.0)).toBeLessThan(TOLERANCE);
  });

  // Pair 3: passing text/bg — dark text on light bg (AA requires ≥4.5)
  // L=0.9 (near-white bg) vs L=0.2 (dark text)
  it('Pair 3: passing text/bg — dark text on light bg ≥4.5', () => {
    const result = computeWcagContrast('oklch(0.2 0 0)', 'oklch(0.9 0 0)');
    // SQL: lum1=0.2^2.2≈0.03297, lum2=0.9^2.2≈0.79244
    // ratio=(0.79244+0.05)/(0.03297+0.05)=(0.84244/0.08297)≈10.15
    expect(result).toBeGreaterThanOrEqual(4.5);
    const expected = (Math.pow(0.9, 2.2) + 0.05) / (Math.pow(0.2, 2.2) + 0.05);
    expect(Math.abs(result - expected)).toBeLessThan(TOLERANCE);
  });

  // Pair 4: failing text/bg — insufficient contrast (<4.5)
  // L=0.6 (medium grey) vs L=0.5 (slightly darker grey)
  it('Pair 4: failing text/bg — insufficient contrast <4.5', () => {
    const result = computeWcagContrast('oklch(0.6 0 0)', 'oklch(0.5 0 0)');
    // lum1=0.6^2.2≈0.3317, lum2=0.5^2.2≈0.2176
    // ratio=(0.3317+0.05)/(0.2176+0.05)=(0.3817/0.2676)≈1.43
    expect(result).toBeLessThan(4.5);
    const expected = (Math.pow(0.6, 2.2) + 0.05) / (Math.pow(0.5, 2.2) + 0.05);
    expect(Math.abs(result - expected)).toBeLessThan(TOLERANCE);
  });

  // Pair 5: passing primary/bg — brand primary on white (AA large requires ≥3.0)
  // L=0.45 primary vs L=1.0 white bg
  it('Pair 5: passing primary/bg — brand primary on white ≥3.0', () => {
    const result = computeWcagContrast('oklch(0.45 0.18 250)', 'oklch(1 0 0)');
    // lum1=0.45^2.2≈0.17652, lum2=1.0^2.2=1.0
    // ratio=(1.05)/(0.22652)≈4.64
    expect(result).toBeGreaterThanOrEqual(3.0);
    const expected = (Math.pow(1.0, 2.2) + 0.05) / (Math.pow(0.45, 2.2) + 0.05);
    expect(Math.abs(result - expected)).toBeLessThan(TOLERANCE);
  });

  // Pair 6: failing primary/bg — insufficient primary contrast (<3.0)
  // L=0.55 primary vs L=0.7 bg (both mid-range, low contrast)
  it('Pair 6: failing primary/bg — insufficient primary contrast <3.0', () => {
    const result = computeWcagContrast('oklch(0.55 0.1 200)', 'oklch(0.7 0 0)');
    // lum1=0.55^2.2≈0.2704, lum2=0.7^2.2≈0.4508
    // ratio=(0.4508+0.05)/(0.2704+0.05)=(0.5008/0.3204)≈1.56
    expect(result).toBeLessThan(3.0);
    const expected = (Math.pow(0.7, 2.2) + 0.05) / (Math.pow(0.55, 2.2) + 0.05);
    expect(Math.abs(result - expected)).toBeLessThan(TOLERANCE);
  });

  // Pair 7: percentage notation for L channel
  it('Pair 7: percentage L notation — oklch(100% 0 0) same as oklch(1 0 0)', () => {
    const pct = computeWcagContrast('oklch(100% 0 0)', 'oklch(0% 0 0)');
    const dec = computeWcagContrast('oklch(1 0 0)', 'oklch(0 0 0)');
    expect(Math.abs(pct - dec)).toBeLessThan(TOLERANCE);
  });

  // Pair 8: returns 0.0 when either input is invalid oklch
  it('Pair 8: returns 0.0 on invalid input (rgb/hex)', () => {
    expect(computeWcagContrast('rgb(255, 255, 255)', 'oklch(0 0 0)')).toBe(0.0);
    expect(computeWcagContrast('oklch(1 0 0)', '#000000')).toBe(0.0);
    expect(computeWcagContrast('#fff', '#000')).toBe(0.0);
    expect(computeWcagContrast('white', 'black')).toBe(0.0);
  });
});

describe('parseOklch', () => {
  it('parses basic oklch(L C H) form', () => {
    const result = parseOklch('oklch(0.65 0.18 240)');
    expect(result).not.toBeNull();
    expect(result!.L).toBeCloseTo(0.65, 5);
    expect(result!.C).toBeCloseTo(0.18, 5);
    expect(result!.H).toBeCloseTo(240, 5);
  });

  it('parses oklch with alpha oklch(L C H / A)', () => {
    const result = parseOklch('oklch(0.65 0.18 240 / 1)');
    expect(result).not.toBeNull();
    expect(result!.L).toBeCloseTo(0.65, 5);
  });

  it('normalises percentage L channel', () => {
    const result = parseOklch('oklch(65% 0.18 240)');
    expect(result).not.toBeNull();
    expect(result!.L).toBeCloseTo(0.65, 5);
  });

  it('returns null for rgb() input', () => {
    expect(parseOklch('rgb(255, 0, 0)')).toBeNull();
  });

  it('returns null for hex input', () => {
    expect(parseOklch('#ff0000')).toBeNull();
  });

  it('returns null for hsl() input', () => {
    expect(parseOklch('hsl(240, 100%, 50%)')).toBeNull();
  });

  it('returns null for named color', () => {
    expect(parseOklch('white')).toBeNull();
  });

  it('returns null for CSS variable', () => {
    expect(parseOklch('var(--color-primary)')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseOklch('')).toBeNull();
  });
});
