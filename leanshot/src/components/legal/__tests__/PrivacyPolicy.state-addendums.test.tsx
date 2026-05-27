/**
 * Phase 64 Plan 04 — PrivacyPolicy state-addendums tests (TDD RED → GREEN).
 *
 * Verifies that the extended PrivacyPolicy renders all 5 state addendum sections,
 * the TOC with anchor links, the "What changed" banner, and SubprocessorList.
 *
 * SubprocessorList is mocked so it doesn't make real network calls.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrivacyPolicy } from '../PrivacyPolicy';

// Mock SubprocessorList to avoid real Supabase calls
vi.mock('../SubprocessorList', () => ({
  SubprocessorList: vi.fn(() => <div data-testid="subprocessor-list-mock" />),
}));

// Mock @/lib/legal/data-categories (used by existing PrivacyPolicy)
vi.mock('@/lib/legal/data-categories', () => ({
  DATA_CATEGORIES: [
    {
      key: 'injections',
      label: 'Injection logs',
      description: 'Dose, site, timestamp.',
      isConsumerHealthData: true,
    },
    {
      key: 'metadata',
      label: 'Metadata',
      description: 'IP address, user agent.',
      isConsumerHealthData: false,
    },
  ],
}));


describe('PrivacyPolicy state addendums', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Test 1: page contains all 5 state anchor ids', () => {
    render(<PrivacyPolicy />);

    expect(document.getElementById('california')).not.toBeNull();
    expect(document.getElementById('virginia')).not.toBeNull();
    expect(document.getElementById('colorado')).not.toBeNull();
    expect(document.getElementById('connecticut')).not.toBeNull();
    expect(document.getElementById('utah')).not.toBeNull();
  });

  it('Test 2: TOC contains anchor links to all 5 state sections', () => {
    render(<PrivacyPolicy />);

    const nav = document.querySelector('nav');
    expect(nav).not.toBeNull();

    const californiaLink = nav!.querySelector('a[href="#california"]');
    const virginiaLink = nav!.querySelector('a[href="#virginia"]');
    const coloradoLink = nav!.querySelector('a[href="#colorado"]');
    const connecticutLink = nav!.querySelector('a[href="#connecticut"]');
    const utahLink = nav!.querySelector('a[href="#utah"]');

    expect(californiaLink).not.toBeNull();
    expect(virginiaLink).not.toBeNull();
    expect(coloradoLink).not.toBeNull();
    expect(connecticutLink).not.toBeNull();
    expect(utahLink).not.toBeNull();
  });

  it('Test 3: page contains banner with "Last updated" and "What changed" and a date', () => {
    render(<PrivacyPolicy />);

    // Multiple elements may contain these texts — use getAllByText
    expect(screen.getAllByText(/Last updated/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/What changed/i).length).toBeGreaterThan(0);
    // Date should be in YYYY-MM-DD format
    const dateRegex = /\d{4}-\d{2}-\d{2}/;
    expect(document.body.textContent).toMatch(dateRegex);
  });

  it('Test 4: SubprocessorList component is rendered', () => {
    render(<PrivacyPolicy />);

    expect(screen.getByTestId('subprocessor-list-mock')).toBeInTheDocument();
  });

  it('Test 5: California section mentions CCPA/CPRA and right to delete, opt out, limit sensitive', () => {
    render(<PrivacyPolicy />);

    const californiaSection = document.getElementById('california');
    expect(californiaSection).not.toBeNull();
    const text = californiaSection!.textContent ?? '';

    expect(text).toMatch(/CCPA|CPRA/i);
    expect(text).toMatch(/right to delete/i);
    expect(text).toMatch(/right to opt out/i);
    expect(text).toMatch(/limit.*sensitive|sensitive.*personal information/i);
  });

  it('Test 6: Virginia section mentions CDPA and right to portability', () => {
    render(<PrivacyPolicy />);

    const virginiaSection = document.getElementById('virginia');
    expect(virginiaSection).not.toBeNull();
    const text = virginiaSection!.textContent ?? '';

    expect(text).toMatch(/CDPA/i);
    expect(text).toMatch(/portability/i);
  });

  it('Test 7: Utah section mentions UCPA and does NOT claim portability', () => {
    render(<PrivacyPolicy />);

    const utahSection = document.getElementById('utah');
    expect(utahSection).not.toBeNull();
    const text = utahSection!.textContent ?? '';

    expect(text).toMatch(/UCPA/i);
    // Utah's UCPA does NOT grant portability — the section should not claim it
    expect(text).not.toMatch(/right to portability/i);
  });
});
