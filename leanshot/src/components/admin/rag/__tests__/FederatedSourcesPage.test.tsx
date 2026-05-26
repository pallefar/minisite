/**
 * Phase 60 Plan 60-09 — FederatedSourcesPage unit tests (TDD RED → GREEN).
 *
 * Option D resolution: tests cover toggle + disabled pull-history button.
 * No PullHistoryConfirmDialog in this plan.
 *
 * Run with:
 *   npx vitest run --config vite.config.ts src/components/admin/rag/__tests__/FederatedSourcesPage.test.tsx
 */

import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FederatedSource } from '@/lib/admin/rag/federated-api';

const { mockListSources, mockSetEnabled, mockTriggerPull } = vi.hoisted(() => ({
  mockListSources: vi.fn(),
  mockSetEnabled: vi.fn(),
  mockTriggerPull: vi.fn(),
}));

vi.mock('@/lib/admin/rag/federated-api', () => ({
  listFederatedSources: mockListSources,
  setFederatedSourceEnabled: mockSetEnabled,
  triggerHistoricalPull: mockTriggerPull,
  SOURCE_META: {
    pubmed: { display_name: 'PubMed (NLM E-utilities)', sync_cadence_label: 'Daily 3:00 AM UTC' },
    openfda: { display_name: 'OpenFDA', sync_cadence_label: 'Daily 3:00 AM UTC' },
    dailymed: { display_name: 'DailyMed', sync_cadence_label: 'Daily 3:00 AM UTC' },
  },
}));

const mockToast = vi.fn();
vi.mock('@/hooks/useToast', () => ({
  useToast: () => mockToast,
}));

vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: unknown) => unknown) =>
    selector({
      toast: null,
      showToast: vi.fn(),
      dismissToast: vi.fn(),
    }),
}));

const makeSources = (): FederatedSource[] => [
  {
    name: 'dailymed',
    enabled: false,
    auto_tier_a: true,
    sync_cron: '0 3 * * *',
    last_sync_at: null,
    last_error: null,
    last_error_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    name: 'openfda',
    enabled: false,
    auto_tier_a: true,
    sync_cron: '0 3 * * *',
    last_sync_at: null,
    last_error: null,
    last_error_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    name: 'pubmed',
    enabled: false,
    auto_tier_a: true,
    sync_cron: '0 3 * * *',
    last_sync_at: null,
    last_error: null,
    last_error_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FederatedSourcesPage — initial load', () => {
  it('shows loading state initially', async () => {
    // Never resolves during this test
    mockListSources.mockReturnValue(new Promise(() => {}));

    const { default: FederatedSourcesPage } = await import('../FederatedSourcesPage');
    render(<FederatedSourcesPage />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders 3 source rows after successful load', async () => {
    mockListSources.mockResolvedValueOnce(makeSources());

    const { default: FederatedSourcesPage } = await import('../FederatedSourcesPage');
    render(<FederatedSourcesPage />);

    await waitFor(() => {
      expect(screen.getByText('PubMed (NLM E-utilities)')).toBeInTheDocument();
      expect(screen.getByText('OpenFDA')).toBeInTheDocument();
      expect(screen.getByText('DailyMed')).toBeInTheDocument();
    });
  });

  it('renders error state when listFederatedSources throws', async () => {
    mockListSources.mockRejectedValueOnce(new Error('Network error'));

    const { default: FederatedSourcesPage } = await import('../FederatedSourcesPage');
    render(<FederatedSourcesPage />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load federated sources/i)).toBeInTheDocument();
    });
  });

  it('renders empty state for non-staff when 0 rows returned', async () => {
    mockListSources.mockResolvedValueOnce([]);

    const { default: FederatedSourcesPage } = await import('../FederatedSourcesPage');
    render(<FederatedSourcesPage />);

    await waitFor(() => {
      expect(screen.getByText(/no access/i)).toBeInTheDocument();
    });
  });
});

describe('FederatedSourcesPage — toggle interaction', () => {
  it('calls setFederatedSourceEnabled with source name and new state on toggle click', async () => {
    const sources = makeSources();
    mockListSources.mockResolvedValueOnce(sources);
    mockSetEnabled.mockResolvedValueOnce({ ...sources[2], enabled: true }); // pubmed toggle

    const { default: FederatedSourcesPage } = await import('../FederatedSourcesPage');
    render(<FederatedSourcesPage />);

    await waitFor(() => screen.getByText('PubMed (NLM E-utilities)'));

    const switches = screen.getAllByRole('switch');
    // pubmed is the last in the alphabetical list (dailymed, openfda, pubmed)
    await act(async () => {
      await userEvent.click(switches[2]!);
    });

    expect(mockSetEnabled).toHaveBeenCalledWith('pubmed', true);
  });

  it('shows success toast after successful toggle', async () => {
    const sources = makeSources();
    mockListSources.mockResolvedValueOnce(sources);
    mockSetEnabled.mockResolvedValueOnce({ ...sources[2], enabled: true });

    const { default: FederatedSourcesPage } = await import('../FederatedSourcesPage');
    render(<FederatedSourcesPage />);

    await waitFor(() => screen.getByText('PubMed (NLM E-utilities)'));

    const switches = screen.getAllByRole('switch');
    await act(async () => {
      await userEvent.click(switches[2]!);
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringContaining('PubMed'),
        'success',
      );
    });
  });

  it('shows danger toast and reverts UI on toggle failure', async () => {
    const sources = makeSources();
    mockListSources.mockResolvedValueOnce(sources);
    mockSetEnabled.mockRejectedValueOnce(new Error('not authorized'));

    const { default: FederatedSourcesPage } = await import('../FederatedSourcesPage');
    render(<FederatedSourcesPage />);

    await waitFor(() => screen.getByText('PubMed (NLM E-utilities)'));

    const switches = screen.getAllByRole('switch');
    await act(async () => {
      await userEvent.click(switches[2]!);
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringContaining('Failed'),
        'error',
      );
    });

    // Row should revert: pubmed was disabled initially, should still be disabled
    const pubmedSwitch = switches[2]!;
    expect(pubmedSwitch).toHaveAttribute('aria-checked', 'false');
  });
});

describe('FederatedSourcesPage — Pull history button (Option D: disabled)', () => {
  it('all Pull-history buttons are disabled (Option D deferral)', async () => {
    mockListSources.mockResolvedValueOnce(makeSources());

    const { default: FederatedSourcesPage } = await import('../FederatedSourcesPage');
    render(<FederatedSourcesPage />);

    await waitFor(() => screen.getByText('PubMed (NLM E-utilities)'));

    const pullButtons = screen.getAllByText(/pull full history/i);
    expect(pullButtons).toHaveLength(3);
    pullButtons.forEach((btn) => {
      expect(btn.closest('button')).toBeDisabled();
    });
  });

  it('Pull-history buttons have tooltip mentioning Coming soon', async () => {
    mockListSources.mockResolvedValueOnce(makeSources());

    const { default: FederatedSourcesPage } = await import('../FederatedSourcesPage');
    render(<FederatedSourcesPage />);

    await waitFor(() => screen.getByText('PubMed (NLM E-utilities)'));

    const pullButtons = screen.getAllByText(/pull full history/i);
    pullButtons.forEach((btn) => {
      expect(btn.closest('button')).toHaveAttribute('title', expect.stringContaining('Coming soon'));
    });
  });
});

describe('FederatedSourcesPage — page header', () => {
  it('renders H1 "Federated Sources" heading', async () => {
    mockListSources.mockResolvedValueOnce(makeSources());

    const { default: FederatedSourcesPage } = await import('../FederatedSourcesPage');
    render(<FederatedSourcesPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /federated sources/i }),
      ).toBeInTheDocument();
    });
  });
});

describe('FederatedSourcesPage — a11y assertions', () => {
  it('each source row has a switch with accessible name', async () => {
    mockListSources.mockResolvedValueOnce(makeSources());

    const { default: FederatedSourcesPage } = await import('../FederatedSourcesPage');
    render(<FederatedSourcesPage />);

    await waitFor(() => screen.getByText('PubMed (NLM E-utilities)'));

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(3);
    switches.forEach((sw) => {
      expect(sw).toHaveAttribute('aria-label');
      expect(sw.getAttribute('aria-label')).not.toBe('');
    });
  });

  it('each switch has aria-checked attribute', async () => {
    mockListSources.mockResolvedValueOnce(makeSources());

    const { default: FederatedSourcesPage } = await import('../FederatedSourcesPage');
    render(<FederatedSourcesPage />);

    await waitFor(() => screen.getByText('PubMed (NLM E-utilities)'));

    const switches = screen.getAllByRole('switch');
    switches.forEach((sw) => {
      expect(sw).toHaveAttribute('aria-checked');
    });
  });
});
