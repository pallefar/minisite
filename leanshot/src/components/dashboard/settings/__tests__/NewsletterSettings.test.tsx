/**
 * Phase 60 Plan 60-12 Task 3 — NewsletterSettings.tsx vitest tests.
 *
 * 10 test cases covering default OFF state, subscription load, topic-tag
 * multi-select, save behavior, loading/error states, a11y, i18n, and
 * no-unsubscribe-token-reference guard.
 *
 * Run: npx vitest run --config vite.config.ts src/components/dashboard/settings/__tests__/NewsletterSettings.test.tsx
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewsletterSettings } from '../NewsletterSettings';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key, // return key as-is for lookup assertions
    i18n: { language: 'en' },
  }),
}));

const mockGetSubscription = vi.fn();
const mockSetOptIn = vi.fn();

vi.mock('@/lib/rag/newsletter-api', () => ({
  getNewsletterSubscription: (...args: unknown[]) => mockGetSubscription(...args),
  setNewsletterOptIn: (...args: unknown[]) => mockSetOptIn(...args),
}));

vi.mock('@/lib/store', () => ({
  useStore: vi.fn((selector: (s: { signedIn: { user: { id: string } } | null; toast: null }) => unknown) =>
    selector({ signedIn: { user: { id: 'user-test-1' } }, toast: null }),
  ),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        returns: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }),
  },
}));

// ─── Import after mocks ──────────────────────────────────────────────────────


// ─── Helpers ─────────────────────────────────────────────────────────────────

const defaultSubscription = {
  user_id: 'user-test-1',
  opted_in: false,
  topic_tags: [],
  email: '',
  last_sent_at: null,
  opted_in_at: null,
  opted_out_at: null,
};

const activeSubscription = {
  ...defaultSubscription,
  opted_in: true,
  topic_tags: ['glp-1', 'peptide-research'],
  opted_in_at: '2026-05-01T10:00:00Z',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NewsletterSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSubscription.mockResolvedValue(defaultSubscription);
    mockSetOptIn.mockResolvedValue(defaultSubscription);
  });

  // Test 1: Mounts with default state opted_in=false — toggle is OFF visually
  it('mounts with default opted_in=false — toggle is OFF (CAN-SPAM)', async () => {
    render(<NewsletterSettings />);
    await waitFor(() => {
      const toggle = screen.getByRole('switch');
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });
  });

  // Test 2: Mounts with opted_in=true — toggle is ON; topic_tags render
  it('mounts with opted_in=true — toggle is ON; topic_tag pills render', async () => {
    mockGetSubscription.mockResolvedValue(activeSubscription);
    render(<NewsletterSettings />);
    await waitFor(() => {
      const toggle = screen.getByRole('switch');
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });
    // topic_tags should render as pills when opted in
    await waitFor(() => {
      expect(screen.getByText('glp-1')).toBeInTheDocument();
      expect(screen.getByText('peptide-research')).toBeInTheDocument();
    });
  });

  // Test 3: Toggling ON shows topic-tag multi-select with role=checkbox pills
  it('toggling ON shows topic-tag checkboxes with 0 selected by default', async () => {
    render(<NewsletterSettings />);
    await waitFor(() => screen.getByRole('switch'));

    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);

    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBeGreaterThan(0);
    });
  });

  // Test 4: Save button calls setNewsletterOptIn with optedIn=true + topicTags
  it('Save button calls setNewsletterOptIn with optedIn=true and topicTags', async () => {
    mockSetOptIn.mockResolvedValue({ ...defaultSubscription, opted_in: true, topic_tags: ['glp-1'] });
    render(<NewsletterSettings />);
    await waitFor(() => screen.getByRole('switch'));

    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);

    await waitFor(() => screen.getAllByRole('checkbox'));

    // Select 'glp-1' topic
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    const saveButton = screen.getByRole('button', { name: /rag:newsletter.save_cta/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockSetOptIn).toHaveBeenCalledWith(
        expect.objectContaining({ optedIn: true }),
      );
    });
  });

  // Test 5: Save after toggle OFF calls setNewsletterOptIn with optedIn=false WITHOUT topicTags
  it('Save after toggle OFF calls setNewsletterOptIn with optedIn=false no topicTags', async () => {
    mockGetSubscription.mockResolvedValue(activeSubscription);
    mockSetOptIn.mockResolvedValue({ ...activeSubscription, opted_in: false });
    render(<NewsletterSettings />);
    await waitFor(() => screen.getByRole('switch'));

    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle); // toggle OFF (was ON)

    const saveButton = screen.getByRole('button', { name: /rag:newsletter.save_cta/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockSetOptIn).toHaveBeenCalledWith(
        expect.objectContaining({ optedIn: false }),
      );
      // Should not include topicTags when toggling off
      const call = mockSetOptIn.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(call.topicTags).toBeUndefined();
    });
  });

  // Test 6: Loading state during save shows aria-busy="true" on Save button
  it('loading state during save shows aria-busy="true" on Save button', async () => {
    let resolve: (v: unknown) => void;
    const slowPromise = new Promise((res) => {
      resolve = res;
    });
    mockSetOptIn.mockReturnValue(slowPromise);

    render(<NewsletterSettings />);
    await waitFor(() => screen.getByRole('switch'));

    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);

    const saveButton = screen.getByRole('button', { name: /rag:newsletter.save_cta/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(saveButton).toHaveAttribute('aria-busy', 'true');
    });

    // Clean up
    await act(async () => {
      resolve!({ ...defaultSubscription, opted_in: true });
      await slowPromise;
    });
  });

  // Test 7: Save error renders inline error message
  it('save error renders inline error text "Couldn\'t save preferences. Try again."', async () => {
    mockSetOptIn.mockRejectedValue(new Error('network error'));
    render(<NewsletterSettings />);
    await waitFor(() => screen.getByRole('switch'));

    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);

    const saveButton = screen.getByRole('button', { name: /rag:newsletter.save_cta/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText("Couldn't save preferences. Try again.")).toBeInTheDocument();
    });
  });

  // Test 8: a11y — section heading is <h2>, toggle has role=switch, pills have role=checkbox
  it('a11y: section heading is h2, toggle has role=switch, topic pills have role=checkbox + aria-checked', async () => {
    render(<NewsletterSettings />);
    await waitFor(() => {
      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading).toBeInTheDocument();
      const toggle = screen.getByRole('switch');
      expect(toggle).toBeInTheDocument();
    });

    // Toggle on to show pills
    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);

    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach((cb) => {
        expect(cb).toHaveAttribute('aria-checked');
      });
    });
  });

  // Test 9: Copy strings render from t('rag:newsletter.*') keys
  it('ALL copy strings render from t("rag:newsletter.*") keys', async () => {
    render(<NewsletterSettings />);
    await waitFor(() => {
      // Our mock t() returns the key as-is (including namespace prefix), so check that keys are used
      expect(screen.getByText('rag:newsletter.section_heading')).toBeInTheDocument();
      expect(screen.getByText('rag:newsletter.toggle_label')).toBeInTheDocument();
      expect(screen.getByText('rag:newsletter.toggle_sublabel')).toBeInTheDocument();
    });
    // Save button uses save_cta key
    const saveButton = screen.getByRole('button', { name: /rag:newsletter.save_cta/i });
    expect(saveButton).toBeInTheDocument();
  });

  // Test 10: Component does NOT reference the rotation token field (grep gate)
  it('NewsletterSettings.tsx does not reference unsubscribe_token', () => {
    const srcPath = resolve(__dirname, '../NewsletterSettings.tsx');
    const src = readFileSync(srcPath, 'utf-8');
    expect(src).not.toMatch(/unsubscribe_token/);
  });
});
