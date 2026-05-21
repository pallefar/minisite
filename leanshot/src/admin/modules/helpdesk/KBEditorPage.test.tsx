/**
 * Phase 37 Plan 37-08 Task 2 — KBEditorPage tests (HELP-07 + HELP-08).
 *
 * Behavior gates:
 *   T1 — renders list of articles + "New article" button
 *   T2 — selecting an article loads it into the editor (title + body in inputs)
 *   T3 — clicking Publish calls supabase.rpc('publish_kb_article', ...) with edited fields
 *   T4 — locale toggle (EN → ES) routes textarea typing to body_es, NOT body
 *   T5 — non-admin role disables Publish button
 *   T6 — version history list renders prior versions
 *
 * Pattern follows HelpdeskInboxPage.test.tsx — chainable supabase mock + dynamic
 * import after vi.doMock.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock row shapes ─────────────────────────────────────────────────────────
interface MockArticle {
  id: string;
  org_id: string | null;
  slug: string;
  title: string;
  body: string;
  title_es: string | null;
  body_es: string | null;
  locale_set: string[];
  published_at: string | null;
  published_version: number;
  created_by: string | null;
  updated_at: string | null;
}

interface MockVersion {
  id: string;
  article_id: string;
  version: number;
  title: string;
  body: string;
  title_es: string | null;
  body_es: string | null;
  published_by: string | null;
  published_at: string;
}

interface MockMember {
  user_id: string;
  org_id: string;
  role: string;
}

let mockArticles: MockArticle[] = [];
let mockVersions: MockVersion[] = [];
let mockMember: MockMember | null = null;
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

function mkArticle(overrides: Partial<MockArticle> = {}): MockArticle {
  return {
    id: `kb-${Math.random().toString(36).slice(2, 8)}`,
    org_id: 'org-1',
    slug: 'sample-slug',
    title: 'Sample article',
    body: '# Body',
    title_es: null,
    body_es: null,
    locale_set: ['en'],
    published_at: null,
    published_version: 0,
    created_by: 'user-1',
    updated_at: null,
    ...overrides,
  };
}

function makeBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {
    _table: table,
    _filters: [] as Array<[string, unknown]>,
    select: vi.fn(function (this: { _filters: Array<[string, unknown]> }) {
      return this;
    }),
    insert: vi.fn(function (this: { _table: string }, row: Record<string, unknown>) {
      if (this._table === 'kb_articles') {
        const article = mkArticle({
          id: `kb-new-${Date.now()}`,
          slug: (row.slug as string) ?? 'untitled',
          title: (row.title as string) ?? 'Untitled',
          body: (row.body as string) ?? '',
          org_id: (row.org_id as string) ?? 'org-1',
        });
        mockArticles.push(article);
        return {
          select: () => ({
            single: () =>
              Promise.resolve({ data: article, error: null }),
          }),
        };
      }
      return this;
    }),
    eq: vi.fn(function (
      this: { _filters: Array<[string, unknown]> },
      col: string,
      val: unknown,
    ) {
      this._filters.push([col, val]);
      return this;
    }),
    order: vi.fn(function (this: unknown) {
      return this;
    }),
    limit: vi.fn(function (this: unknown) {
      return this;
    }),
    single: vi.fn(function (this: {
      _table: string;
      _filters: Array<[string, unknown]>;
    }) {
      if (this._table === 'kb_articles') {
        const idFilter = this._filters.find((f) => f[0] === 'id');
        const found = idFilter
          ? mockArticles.find((a) => a.id === idFilter[1])
          : mockArticles[0];
        return Promise.resolve({ data: found ?? null, error: null });
      }
      if (this._table === 'org_members') {
        return Promise.resolve({ data: mockMember, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    then: function (
      this: { _table: string },
      resolve: (v: { data: unknown[]; error: null }) => void,
    ) {
      if (this._table === 'kb_articles') {
        resolve({ data: mockArticles, error: null });
        return Promise.resolve({ data: mockArticles, error: null });
      }
      if (this._table === 'kb_article_versions') {
        resolve({ data: mockVersions, error: null });
        return Promise.resolve({ data: mockVersions, error: null });
      }
      resolve({ data: [], error: null });
      return Promise.resolve({ data: [], error: null });
    },
  };
  return builder;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => makeBuilder(table),
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === 'publish_kb_article') {
        return Promise.resolve({ data: 1, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }),
    },
  },
}));

// react-markdown is ESM-only and pulls heavy graph; mock to a div containing
// the raw text so locale assertions can look at the rendered preview.
vi.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => (
    <div data-testid="md-preview">{children}</div>
  ),
}));
vi.mock('remark-gfm', () => ({ __esModule: true, default: () => null }));
vi.mock('rehype-raw', () => ({ __esModule: true, default: () => null }));
vi.mock('dompurify', () => ({
  __esModule: true,
  default: { sanitize: (s: string) => s },
}));

describe('KBEditorPage', () => {
  beforeEach(() => {
    mockArticles = [];
    mockVersions = [];
    mockMember = { user_id: 'user-1', org_id: 'org-1', role: 'support_admin' };
    rpcCalls.length = 0;
    vi.clearAllMocks();
  });

  it('T1: renders article list + New article button', async () => {
    mockArticles = [
      mkArticle({ id: 'kb-1', title: 'Intro to dosing' }),
      mkArticle({ id: 'kb-2', title: 'Refund policy' }),
    ];
    const { default: KBEditorPage } = await import('./KBEditorPage');
    render(<KBEditorPage />);
    await waitFor(() => {
      expect(screen.getByText('Intro to dosing')).toBeTruthy();
      expect(screen.getByText('Refund policy')).toBeTruthy();
      expect(screen.getByRole('button', { name: /new article/i })).toBeTruthy();
    });
  });

  it('T2: selecting an article loads it into editor', async () => {
    mockArticles = [
      mkArticle({ id: 'kb-1', title: 'Intro to dosing', body: '# Dose body' }),
    ];
    const { default: KBEditorPage } = await import('./KBEditorPage');
    render(<KBEditorPage />);
    await waitFor(() => screen.getByText('Intro to dosing'));
    fireEvent.click(screen.getByText('Intro to dosing'));
    await waitFor(() => {
      const titleInput = screen.getByLabelText(/title/i) as HTMLInputElement;
      const bodyTextarea = screen.getByLabelText(/body/i) as HTMLTextAreaElement;
      expect(titleInput.value).toBe('Intro to dosing');
      expect(bodyTextarea.value).toBe('# Dose body');
    });
  });

  it('T3: Publish calls publish_kb_article RPC with edited fields', async () => {
    mockArticles = [
      mkArticle({ id: 'kb-pub', title: 'Old title', body: 'old body' }),
    ];
    const { default: KBEditorPage } = await import('./KBEditorPage');
    render(<KBEditorPage />);
    await waitFor(() => screen.getByText('Old title'));
    fireEvent.click(screen.getByText('Old title'));
    await waitFor(() => screen.getByLabelText(/title/i));
    const titleInput = screen.getByLabelText(/title/i) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'New title' } });
    const bodyTextarea = screen.getByLabelText(/body/i) as HTMLTextAreaElement;
    fireEvent.change(bodyTextarea, { target: { value: 'new body' } });
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    await waitFor(() => {
      const call = rpcCalls.find((c) => c.fn === 'publish_kb_article');
      expect(call).toBeTruthy();
      expect(call?.args.p_article_id).toBe('kb-pub');
      expect(call?.args.p_title).toBe('New title');
      expect(call?.args.p_body).toBe('new body');
    });
  });

  it('T4: locale toggle routes typing to body_es not body', async () => {
    mockArticles = [
      mkArticle({
        id: 'kb-i18n',
        title: 'English title',
        body: 'EN body',
        title_es: 'Título',
        body_es: 'Cuerpo',
        locale_set: ['en', 'es'],
      }),
    ];
    const { default: KBEditorPage } = await import('./KBEditorPage');
    render(<KBEditorPage />);
    await waitFor(() => screen.getByText('English title'));
    fireEvent.click(screen.getByText('English title'));
    await waitFor(() => screen.getByLabelText(/body/i));

    // Switch to ES.
    fireEvent.click(screen.getByRole('button', { name: /^es$/i }));
    await waitFor(() => {
      const bodyTextarea = screen.getByLabelText(/body/i) as HTMLTextAreaElement;
      expect(bodyTextarea.value).toBe('Cuerpo');
    });
    const bodyTextarea = screen.getByLabelText(/body/i) as HTMLTextAreaElement;
    fireEvent.change(bodyTextarea, { target: { value: 'Cuerpo nuevo' } });

    // Switch back to EN — EN body must remain unchanged.
    fireEvent.click(screen.getByRole('button', { name: /^en$/i }));
    await waitFor(() => {
      const en = screen.getByLabelText(/body/i) as HTMLTextAreaElement;
      expect(en.value).toBe('EN body');
    });

    // Publish: assert RPC carries both EN (unchanged) and ES (edited).
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    await waitFor(() => {
      const call = rpcCalls.find((c) => c.fn === 'publish_kb_article');
      expect(call?.args.p_body).toBe('EN body');
      expect(call?.args.p_body_es).toBe('Cuerpo nuevo');
    });
  });

  it('T5: non-admin role disables Publish button', async () => {
    mockArticles = [mkArticle({ id: 'kb-1', title: 'Sample' })];
    mockMember = { user_id: 'user-1', org_id: 'org-1', role: 'support_agent' };
    const { default: KBEditorPage } = await import('./KBEditorPage');
    render(<KBEditorPage />);
    await waitFor(() => screen.getByText('Sample'));
    fireEvent.click(screen.getByText('Sample'));
    await waitFor(() => screen.getByLabelText(/title/i));
    const pubBtn = screen.getByRole('button', {
      name: /^publish$/i,
    }) as HTMLButtonElement;
    expect(pubBtn.disabled).toBe(true);
  });

  it('T6: version history renders prior versions', async () => {
    mockArticles = [mkArticle({ id: 'kb-1', title: 'Sample', published_version: 2 })];
    mockVersions = [
      {
        id: 'v-2',
        article_id: 'kb-1',
        version: 2,
        title: 'Sample',
        body: 'v2 body',
        title_es: null,
        body_es: null,
        published_by: 'user-1',
        published_at: '2026-05-01T00:00:00Z',
      },
      {
        id: 'v-1',
        article_id: 'kb-1',
        version: 1,
        title: 'Sample old',
        body: 'v1 body',
        title_es: null,
        body_es: null,
        published_by: 'user-1',
        published_at: '2026-04-01T00:00:00Z',
      },
    ];
    const { default: KBEditorPage } = await import('./KBEditorPage');
    render(<KBEditorPage />);
    await waitFor(() => screen.getByText('Sample'));
    fireEvent.click(screen.getByText('Sample'));
    await waitFor(() => {
      expect(screen.getAllByText(/^v2$/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/^v1$/).length).toBeGreaterThan(0);
    });
  });
});
