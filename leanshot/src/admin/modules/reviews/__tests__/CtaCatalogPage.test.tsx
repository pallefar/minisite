/**
 * Phase 36 Plan 36-04 Task 3 — CtaCatalogPage tests (Surface F).
 *
 * Covers:
 *  - mounts and calls list_review_cta_catalog RPC
 *  - renders 5 rows (Wave 1 seeded catalog: trustpilot/g2/capterra + apple_app_store/google_play)
 *  - requires_mobile_shell=true rows get the "v1.4 — needs mobile shell" warning pill
 *  - requires_mobile_shell=false rows get "Live (web)" sage pill
 *  - footer note "Catalog managed via migration in v1.3" present
 *  - no "Add CTA" button
 */
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CtaCatalogPage from '../CtaCatalogPage';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => vi.fn(),
}));

beforeEach(() => {
  mockRpc.mockReset();
});

afterEach(() => {
  cleanup();
});

const SEED_ROWS = [
  {
    slug: 'trustpilot',
    display_name: 'Trustpilot',
    available_for_org_type: 'consumer',
    url_pattern: 'https://trustpilot.com/review/leanshot.app',
    requires_mobile_shell: false,
    claimed: false,
  },
  {
    slug: 'g2',
    display_name: 'G2',
    available_for_org_type: 'clinic',
    url_pattern: 'https://g2.com/products/leanshot/reviews',
    requires_mobile_shell: false,
    claimed: false,
  },
  {
    slug: 'capterra',
    display_name: 'Capterra',
    available_for_org_type: 'clinic',
    url_pattern: 'https://capterra.com/p/leanshot/reviews',
    requires_mobile_shell: false,
    claimed: false,
  },
  {
    slug: 'apple_app_store',
    display_name: 'Apple App Store',
    available_for_org_type: 'consumer',
    url_pattern: 'itms-apps://itunes.apple.com/app/idXXXX?action=write-review',
    requires_mobile_shell: true,
    claimed: false,
  },
  {
    slug: 'google_play',
    display_name: 'Google Play',
    available_for_org_type: 'consumer',
    url_pattern: 'market://details?id=app.leanshot',
    requires_mobile_shell: true,
    claimed: false,
  },
];

describe('CtaCatalogPage (Phase 36 Plan 36-04 Task 3 — Surface F)', () => {
  it('renders 5 catalog rows on mount', async () => {
    mockRpc.mockResolvedValue({ data: SEED_ROWS, error: null });

    render(<CtaCatalogPage />);

    await waitFor(() => {
      expect(screen.getByText('Trustpilot')).toBeTruthy();
    });
    expect(screen.getByText('G2')).toBeTruthy();
    expect(screen.getByText('Capterra')).toBeTruthy();
    expect(screen.getByText('Apple App Store')).toBeTruthy();
    expect(screen.getByText('Google Play')).toBeTruthy();
  });

  it('flags requires_mobile_shell=true rows with "v1.4 — needs mobile shell"', async () => {
    mockRpc.mockResolvedValue({ data: SEED_ROWS, error: null });
    render(<CtaCatalogPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/v1\.4 — needs mobile shell/i).length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getAllByText(/Live \(web\)/i).length).toBeGreaterThanOrEqual(3);
  });

  it('renders the v1.3 footer note and no "Add CTA" button', async () => {
    mockRpc.mockResolvedValue({ data: SEED_ROWS, error: null });
    render(<CtaCatalogPage />);

    await waitFor(() => {
      expect(screen.getByText(/Catalog managed via migration in v1\.3/i)).toBeTruthy();
    });
    const addBtn = screen.queryByRole('button', { name: /Add CTA/i });
    expect(addBtn).toBeNull();
  });
});
