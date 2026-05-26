/**
 * Phase 60 Plan 60-13 — KnowledgeRootPage tests.
 *
 * Task 1 Test 5: KnowledgeRoute renders without crashing under MemoryRouter.
 * Task 2 Tests 6-8: H1 Fraunces italic 28px, topic grid, newsletter signup.
 */

import { render, screen } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeRootPage } from '../KnowledgeRootPage';

// ─── Mock the API module (vi.mock is hoisted by vitest — safe to call here) ──

vi.mock('@/lib/knowledge/api', () => ({
  listTopics: vi.fn().mockResolvedValue([
    { slug: 'glp-1', display_name: 'GLP-1 Agonists', chunk_count: 12 },
    { slug: 'tirzepatide', display_name: 'Tirzepatide', chunk_count: 8 },
    { slug: 'semaglutide', display_name: 'Semaglutide', chunk_count: 5 },
  ]),
  getFeaturedChunk: vi.fn().mockResolvedValue({
    id: 'chunk-001',
    topic_tag: 'glp-1',
    slug: 'tirzepatide-fda-approval-2023',
    summary: 'Tirzepatide received FDA approval for chronic weight management in adults.',
    canonical_url: 'https://www.fda.gov/tirzepatide',
    source_tier: 'A',
    published_at: '2024-01-15T00:00:00Z',
    title: 'Tirzepatide FDA Approval 2023',
    source: { name: 'FDA', source_type: 'regulatory' },
  }),
}));

function renderKnowledgeRoot() {
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <KnowledgeRootPage />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

// ─── Task 1 Test 5 ───────────────────────────────────────────────────────────

describe('60-13 Task 1 Test 5: KnowledgeRoute renders without crashing', () => {
  it('KnowledgeRootPage renders without throwing', () => {
    expect(() => renderKnowledgeRoot()).not.toThrow();
  });
});

// ─── Task 2 Tests 6-8 ────────────────────────────────────────────────────────

describe('60-13 Task 2: KnowledgeRootPage', () => {

  it('Test 6: renders Fraunces italic H1 Knowledge Base with text-heading class', async () => {
    renderKnowledgeRoot();

    const heading = await screen.findByRole('heading', { level: 1, name: /knowledge base/i });
    expect(heading).toBeInTheDocument();
    // Assert font-display italic and text-heading classes for Fraunces 28px
    expect(heading.className).toMatch(/font-display/);
    expect(heading.className).toMatch(/text-heading/);
  });

  it('Test 7: renders topic grid cards from mocked listTopics()', async () => {
    renderKnowledgeRoot();
    // Wait for topic cards to appear (multiple matches OK — topic name appears in grid + featured)
    const glpElements = await screen.findAllByText('GLP-1 Agonists');
    expect(glpElements.length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText('Tirzepatide')).toBeInTheDocument();
    expect(await screen.findByText('Semaglutide')).toBeInTheDocument();
  });

  it('Test 8: renders newsletter signup with Subscribe button and email input', async () => {
    renderKnowledgeRoot();
    expect(await screen.findByRole('button', { name: /subscribe to digest/i })).toBeInTheDocument();
    expect(await screen.findByRole('textbox')).toBeInTheDocument();
  });
});
