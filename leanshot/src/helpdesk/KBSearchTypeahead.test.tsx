/**
 * KBSearchTypeahead.test.tsx — Phase 37 Plan 06 Task 2 RED→GREEN.
 *
 * Verifies behaviour from the plan:
 *  - Empty query → no RPC call
 *  - Typing >=2 chars → debounced (250ms) supabase.rpc('search_kb_articles')
 *  - Click result → onSelectArticle + helpdesk.kb_article.viewed analytics
 *  - track('helpdesk.kb_search.performed') uses length-only properties
 *  - Locale toggle defaults to 'en'; can switch to 'es'
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KBSearchTypeahead from './KBSearchTypeahead';

const trackMock = vi.fn();
vi.mock('@/lib/analytics', () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

const rpcMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));


describe('KBSearchTypeahead', () => {
  beforeEach(() => {
    trackMock.mockReset();
    rpcMock.mockReset();
  });

  it('does not call supabase.rpc on empty or 1-char queries', async () => {
    render(<KBSearchTypeahead onSelectArticle={() => {}} />);
    const input = screen.getByLabelText('Search the knowledge base');
    await userEvent.type(input, 'a');
    // Wait past the 250ms debounce window before asserting.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('calls supabase.rpc("search_kb_articles") after debounce with locale + limit', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ id: 'a-1', slug: 'foo', title: 'Foo article', locale: 'en', rank: 0.5 }],
      error: null,
    });
    render(<KBSearchTypeahead onSelectArticle={() => {}} />);
    const input = screen.getByLabelText('Search the knowledge base');
    await userEvent.type(input, 'hello');
    await waitFor(
      () => {
        expect(rpcMock).toHaveBeenCalledWith(
          'search_kb_articles',
          expect.objectContaining({ p_query: 'hello', p_locale: 'en', p_limit: 10 }),
        );
      },
      { timeout: 1500 },
    );
  });

  it('emits helpdesk.kb_search.performed with length-only properties (NO raw query)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ id: 'a-1', slug: 'foo', title: 'Foo', locale: 'en', rank: 0.1 }],
      error: null,
    });
    render(<KBSearchTypeahead onSelectArticle={() => {}} />);
    await userEvent.type(screen.getByLabelText('Search the knowledge base'), 'patient');
    await waitFor(
      () => {
        expect(trackMock).toHaveBeenCalledWith('helpdesk.kb_search.performed', {
          query_length: 'patient'.length,
          results_count: 1,
          locale: 'en',
        });
      },
      { timeout: 1500 },
    );
    // Defence-in-depth: assert raw query string never appears in any track call.
    for (const call of trackMock.mock.calls) {
      const props = call[1] ?? {};
      expect(JSON.stringify(props)).not.toContain('patient');
    }
  });

  it('clicking a result fires onSelectArticle + helpdesk.kb_article.viewed', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        { id: 'a-1', slug: 'first', title: 'First article', locale: 'en', rank: 0.2 },
      ],
      error: null,
    });
    const onSelectArticle = vi.fn();
    render(<KBSearchTypeahead onSelectArticle={onSelectArticle} />);
    await userEvent.type(screen.getByLabelText('Search the knowledge base'), 'first');
    const resultButton = await screen.findByRole(
      'button',
      { name: 'First article' },
      { timeout: 1500 },
    );
    await userEvent.click(resultButton);
    expect(onSelectArticle).toHaveBeenCalledWith('a-1');
    expect(trackMock).toHaveBeenCalledWith('helpdesk.kb_article.viewed', {
      article_id: 'a-1',
      slug: 'first',
      locale: 'en',
    });
  });

  it('locale toggle switches RPC p_locale to "es"', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    render(<KBSearchTypeahead onSelectArticle={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'ES' }));
    await userEvent.type(screen.getByLabelText('Search the knowledge base'), 'hola');
    await waitFor(
      () => {
        expect(rpcMock).toHaveBeenCalledWith(
          'search_kb_articles',
          expect.objectContaining({ p_locale: 'es' }),
        );
      },
      { timeout: 1500 },
    );
  });
});
