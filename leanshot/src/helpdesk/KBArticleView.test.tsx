/**
 * KBArticleView.test.tsx — Phase 37 Plan 06 Task 2 RED→GREEN.
 *
 * Verifies XSS trust-boundary mitigation (T-37-06-01):
 *  - `<script>alert(1)</script>` injected in body MUST be stripped by DOMPurify.
 *  - Markdown headings render normally.
 *  - Locale toggle swaps body_es when available.
 *  - Back button calls onBack prop.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KBArticleView from './KBArticleView';

// supabase.from('kb_articles').select(...).eq(...).single() returns the article row.
const singleMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          single: () => singleMock(),
        }),
      }),
    }),
  },
}));

describe('KBArticleView', () => {
  beforeEach(() => {
    singleMock.mockReset();
  });

  it('strips <script> tags from body before rendering (T-37-06-01)', async () => {
    singleMock.mockResolvedValueOnce({
      data: {
        id: 'a-xss',
        slug: 'xss',
        title: 'Hello',
        body: '# Hello\n<script>alert(1)</script>\n\nSafe text here.',
        title_es: null,
        body_es: null,
        locale_set: ['en'],
      },
      error: null,
    });
    render(<KBArticleView articleId="a-xss" onBack={() => {}} />);

    // Markdown heading renders
    await screen.findByText('Safe text here.');

    // No <script> tag should remain in the DOM (DOMPurify stripped it).
    expect(document.querySelector('script')).toBeNull();
    // The injected text "alert(1)" should not be in the rendered document either.
    expect(document.body.innerHTML).not.toContain('alert(1)');
  });

  it('renders body_es when locale toggle is switched to ES', async () => {
    singleMock.mockResolvedValueOnce({
      data: {
        id: 'a-es',
        slug: 'es',
        title: 'English Title',
        body: 'English body',
        title_es: 'Título español',
        body_es: 'Cuerpo en español',
        locale_set: ['en', 'es'],
      },
      error: null,
    });
    render(<KBArticleView articleId="a-es" onBack={() => {}} />);
    await screen.findByText('English body');
    await userEvent.click(screen.getByRole('button', { name: 'ES' }));
    await screen.findByText('Cuerpo en español');
    expect(screen.getByText('Título español')).toBeInTheDocument();
  });

  it('Back button calls onBack', async () => {
    singleMock.mockResolvedValueOnce({
      data: {
        id: 'a-1',
        slug: 's',
        title: 'T',
        body: 'b',
        title_es: null,
        body_es: null,
        locale_set: null,
      },
      error: null,
    });
    const onBack = vi.fn();
    render(<KBArticleView articleId="a-1" onBack={onBack} />);
    const back = await screen.findByRole('button', { name: 'Back to search' });
    await userEvent.click(back);
    expect(onBack).toHaveBeenCalled();
  });
});
