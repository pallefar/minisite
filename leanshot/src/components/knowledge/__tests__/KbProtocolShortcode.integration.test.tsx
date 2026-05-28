/**
 * Phase 61 Plan 07 Task 4 — Integration test: [protocol:<uuid>] shortcode wiring
 * in KnowledgeArticleDetailPage.
 *
 * Critical assertions:
 * 1. Raw [protocol:<uuid>] token is ABSENT from the rendered DOM.
 * 2. ProtocolSummaryCard renders in its place (tested via "View full protocol →" link).
 * 3. Surrounding markdown text segments still render correctly.
 *
 * Closes PROTOCOL-08 success criterion #6.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { supabase } from '@/lib/supabase';

// ─── Constants ────────────────────────────────────────────────────────────────

const PROTOCOL_UUID = '00000000-0000-0000-0000-000000000061';
const PROTOCOL_UUID_2 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// ─── Mock @/lib/knowledge/api ─────────────────────────────────────────────────

const mockGetChunkBySlug = vi.fn();
const mockListRelatedChunks = vi.fn().mockResolvedValue([]);

vi.mock('@/lib/knowledge/api', () => ({
  getChunkBySlug: (...args: unknown[]) => mockGetChunkBySlug(...args),
  listRelatedChunks: (...args: unknown[]) => mockListRelatedChunks(...args),
  isReservedSlug: vi.fn().mockReturnValue(false),
}));

// ─── Mock @/lib/rag/sanitize ──────────────────────────────────────────────────
// Sanitize runs first per T-60-13-XSS-1 — pass through unchanged in test.
vi.mock('@/lib/rag/sanitize', () => ({
  sanitizeRagMarkdown: (text: string) => text,
}));

// ─── Mock @/lib/supabase for ProtocolSummaryCard's own fetch ─────────────────

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CHUNK_WITH_SHORTCODE = {
  id: 'chunk-protocol-test-001',
  topic_tag: 'medication',
  slug: 'tirzepatide-titration',
  title: 'Tirzepatide titration guide',
  summary: `Intro paragraph.\n\nSee the canonical protocol: [protocol:${PROTOCOL_UUID}] for week-by-week dosing.\n\nClosing paragraph.`,
  canonical_url: null,
  source_tier: 'A' as const,
  source_id: 'src-001',
  scraped_at: '2026-05-01T00:00:00Z',
  published_at: '2026-05-01T00:00:00Z',
  reviewed_at: '2026-05-01T00:00:00Z',
  retracted_at: null,
  quote_blocks: [],
  public_visibility: true,
  source: {
    id: 'src-001',
    name: 'LeanShot Protocols',
    source_type: 'clinical',
  },
};

const CHUNK_WITHOUT_SHORTCODE = {
  ...CHUNK_WITH_SHORTCODE,
  id: 'chunk-plain-001',
  summary: 'Plain article with no protocol references. Just text.',
};

// ─── Setup supabase mock for ProtocolSummaryCard ──────────────────────────────

function setupProtocolSummaryCardMock() {
  const protocolsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({
      data: [
        {
          id: PROTOCOL_UUID,
          name: 'Tirzepatide 12-week titration',
          compound: 'tirzepatide',
          base_slug: 'tirzepatide-12-week-titration',
          version: 1,
        },
      ],
      error: null,
    }),
  };

  const stepsResolved = Promise.resolve({ count: 6, error: null });
  const stepsChain: Record<string, unknown> = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue(stepsResolved),
      }),
    }),
  };
  // Make stepsChain thenable so supabase.from('protocol_steps').select().eq().eq() works
  stepsChain['then'] = stepsResolved.then.bind(stepsResolved);

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === 'protocols') return protocolsChain as ReturnType<typeof supabase.from>;
    // protocol_steps: return a chain that resolves count
    const chain: Record<string, unknown> = {};
    chain['select'] = vi.fn().mockReturnValue(chain);
    chain['eq'] = vi.fn().mockReturnValue(chain);
    chain['then'] = stepsResolved.then.bind(stepsResolved);
    return chain as ReturnType<typeof supabase.from>;
  });
}

// ─── Render helper ────────────────────────────────────────────────────────────

async function renderArticlePage(route = '/medication/tirzepatide-titration') {
  const { KnowledgeArticleDetailPage } = await import('../KnowledgeArticleDetailPage');
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route
            path="/:topic/:slug"
            element={
              <Suspense fallback={<div data-testid="loading">loading</div>}>
                <KnowledgeArticleDetailPage />
              </Suspense>
            }
          />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('KB article with [protocol:<uuid>] shortcode (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('renders ProtocolSummaryCard inline; raw shortcode token ABSENT from DOM', async () => {
    mockGetChunkBySlug.mockResolvedValue(CHUNK_WITH_SHORTCODE);
    setupProtocolSummaryCardMock();

    await renderArticlePage();

    // Wait for article fetch + title to appear (may appear in breadcrumb + H1, use findAll)
    await waitFor(() => {
      const titles = screen.getAllByText('Tirzepatide titration guide');
      expect(titles.length).toBeGreaterThanOrEqual(1);
    });

    // CRITICAL ASSERTION 1: raw shortcode token MUST NOT appear in the rendered DOM
    expect(screen.queryByText(new RegExp(`\\[protocol:${PROTOCOL_UUID}\\]`))).toBeNull();

    // CRITICAL ASSERTION 2: ProtocolSummaryCard renders (via "View full protocol →" link)
    await waitFor(() => {
      expect(screen.getByText(/View full protocol/i)).toBeInTheDocument();
    });

    // Surrounding text segments still render
    expect(screen.getByText(/Intro paragraph/)).toBeInTheDocument();
    expect(screen.getByText(/Closing paragraph/)).toBeInTheDocument();
  });

  it('renders markdown text unchanged when no shortcode is present', async () => {
    mockGetChunkBySlug.mockResolvedValue(CHUNK_WITHOUT_SHORTCODE);
    setupProtocolSummaryCardMock();

    await renderArticlePage();

    await waitFor(() => {
      // Title appears in breadcrumb and/or H1
      const titles = screen.getAllByText('Tirzepatide titration guide');
      expect(titles.length).toBeGreaterThanOrEqual(1);
    });

    // Plain text renders correctly
    expect(screen.getByText(/Plain article with no protocol references/)).toBeInTheDocument();

    // No ProtocolSummaryCard should be present (no shortcodes in article)
    expect(screen.queryByText(/View full protocol/i)).toBeNull();
  });
});
