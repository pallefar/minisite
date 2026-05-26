/**
 * Phase 60 Plan 60-09 — FederatedSourceRow unit tests (TDD RED → GREEN).
 *
 * Option D: Pull-history button rendered DISABLED with tooltip.
 * No PullHistoryConfirmDialog in this plan (deferred to 60-15).
 *
 * Run with:
 *   npx vitest run --config vite.config.ts src/components/admin/rag/__tests__/FederatedSourceRow.test.tsx
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FederatedSource } from '@/lib/admin/rag/federated-api';
import { FederatedSourceRow } from '../FederatedSourceRow';

vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

const makeSource = (overrides?: Partial<FederatedSource>): FederatedSource => ({
  name: 'pubmed',
  enabled: true,
  auto_tier_a: true,
  sync_cron: '0 3 * * *',
  last_sync_at: '2026-05-20T03:00:00Z',
  last_error: null,
  last_error_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-05-20T03:00:00Z',
  ...overrides,
});

const defaultProps = {
  source: makeSource(),
  onToggle: vi.fn(),
  onTriggerPull: vi.fn(),
  isToggleBusy: false,
  isPullBusy: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FederatedSourceRow — toggle switch', () => {
  it('renders enabled toggle with aria-checked=true when source.enabled=true', () => {
    render(<FederatedSourceRow {...defaultProps} source={makeSource({ enabled: true })} />);

    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('renders disabled toggle with aria-checked=false when source.enabled=false', () => {
    render(<FederatedSourceRow {...defaultProps} source={makeSource({ enabled: false })} />);

    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('toggle has accessible aria-label containing display_name', () => {
    render(<FederatedSourceRow {...defaultProps} source={makeSource({ name: 'pubmed' })} />);

    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-label', expect.stringContaining('PubMed'));
  });

  it('calls onToggle when toggle is clicked', () => {
    render(<FederatedSourceRow {...defaultProps} source={makeSource({ enabled: true })} />);

    fireEvent.click(screen.getByRole('switch'));
    expect(defaultProps.onToggle).toHaveBeenCalledWith(false);
  });

  it('toggle is disabled and not clickable when isToggleBusy=true', () => {
    render(<FederatedSourceRow {...defaultProps} isToggleBusy={true} />);

    const toggle = screen.getByRole('switch');
    expect(toggle).toBeDisabled();
  });
});

describe('FederatedSourceRow — last_sync_at display', () => {
  it('shows relative time when last_sync_at is set', () => {
    // Use a past date far enough back to reliably show non-"just now"
    const past = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    render(<FederatedSourceRow {...defaultProps} source={makeSource({ last_sync_at: past })} />);

    // Should contain "ago" somewhere (relative time)
    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveTextContent(/ago|just now|synced/i);
  });

  it('shows "Never synced" when last_sync_at is null', () => {
    render(
      <FederatedSourceRow {...defaultProps} source={makeSource({ last_sync_at: null })} />,
    );

    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveTextContent(/never synced/i);
  });
});

describe('FederatedSourceRow — last_error pill', () => {
  it('hides error pill when last_error is null', () => {
    render(<FederatedSourceRow {...defaultProps} source={makeSource({ last_error: null })} />);

    expect(screen.queryByText(/last error/i)).not.toBeInTheDocument();
  });

  it('shows error pill with truncated message when last_error is set', () => {
    render(
      <FederatedSourceRow
        {...defaultProps}
        source={makeSource({ last_error: 'Rate limit exceeded' })}
      />,
    );

    expect(screen.getByText(/Rate limit exceeded/)).toBeInTheDocument();
  });

  it('truncates error message to 80 chars', () => {
    const longError = 'A'.repeat(100);
    render(
      <FederatedSourceRow
        {...defaultProps}
        source={makeSource({ last_error: longError })}
      />,
    );

    // "Last error: " = 12 chars, truncated message = 80 chars + "…" = 81 → total 93
    const pill = screen.getByText(/A+…/);
    expect(pill.textContent).toHaveLength(93); // 12 (prefix) + 80 (truncated) + 1 (…)
  });
});

describe('FederatedSourceRow — Pull full history button (Option D: disabled)', () => {
  it('renders a "Pull full history" button', () => {
    render(<FederatedSourceRow {...defaultProps} />);
    expect(screen.getByText(/pull full history/i)).toBeInTheDocument();
  });

  it('Pull-history button is disabled (Option D: deferred to 60-15)', () => {
    render(<FederatedSourceRow {...defaultProps} />);
    const pullBtn = screen.getByText(/pull full history/i).closest('button');
    expect(pullBtn).toBeDisabled();
  });

  it('Pull-history button has tooltip explaining deferral', () => {
    render(<FederatedSourceRow {...defaultProps} />);
    const pullBtn = screen.getByText(/pull full history/i).closest('button');
    expect(pullBtn).toHaveAttribute('title', expect.stringContaining('Coming soon'));
  });

  it('does not call onTriggerPull when Pull-history button is clicked (disabled)', () => {
    render(<FederatedSourceRow {...defaultProps} />);
    const pullBtn = screen.getByText(/pull full history/i).closest('button')!;
    fireEvent.click(pullBtn);
    expect(defaultProps.onTriggerPull).not.toHaveBeenCalled();
  });
});
