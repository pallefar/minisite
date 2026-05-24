/**
 * Phase 41 Plan 41-05 Task 3 — KBArticleView embed-block render tests (EMBED-06).
 *
 * 6 behavior cases per PLAN.md <behavior>:
 *   1. <embed-block type="youtube"> → renders YouTubeBlock wrapped in
 *      ConsentGatedEmbed with data-provider="youtube".
 *   2. <embed-block type="calendly"> → CalendlyBlock + data-provider="calendly".
 *   3. <embed-block type="tally"> → TallyBlock + data-provider="tally".
 *   4. <embed-block type="custom_iframe"> → CustomIframeBlock self-validates allowlist.
 *   5. <script> adjacent to embed-block → script stripped (dompurify html-profile).
 *   6. <embed-block onerror="alert(1)"> → onerror stripped (ADD_ATTR tight).
 */
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import KBArticleView from '../KBArticleView';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// Mock CookieConsent — return TRUE so HOC mounts iframe synchronously and we
// can read data-provider on the wrapper card.
vi.mock('vanilla-cookieconsent', () => ({
  acceptedCategory: () => true,
  show: vi.fn(),
}));

vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

// Mock listHostnames so custom_iframe test passes validation.
vi.mock('@/lib/admin/iframe-allowlist', () => ({
  listHostnames: vi.fn(async () => [
    {
      id: 'mock',
      hostname: 'meet.example.com',
      added_by_user_id: null,
      added_at: new Date().toISOString(),
      last_used_at: null,
    },
  ]),
}));

// Stub the kb_articles supabase fetch with a per-test body.
let testBody = '';
vi.mock('@/lib/supabase', () => {
  const single = () =>
    Promise.resolve({
      data: {
        id: 'art-1',
        slug: 's',
        title: 'T',
        body: testBody,
        title_es: null,
        body_es: null,
        locale_set: null,
      },
      error: null,
    });
  return {
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({ single }),
        }),
      }),
    } as unknown,
  };
});

async function renderWithBody(body: string): Promise<HTMLElement> {
  testBody = body;
  const { container } = render(<KBArticleView articleId="art-1" onBack={() => {}} />);
  await waitFor(() => {
    expect(container.querySelector('article')).not.toBeNull();
  });
  return container;
}

describe('KBArticleView embed-block render (Phase 41 41-05 Task 3)', () => {
  beforeEach(() => {
    testBody = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('Test 1: <embed-block type="youtube"> → YouTubeBlock with data-provider="youtube"', async () => {
    const container = await renderWithBody(
      `<embed-block type="youtube" data-url="https://www.youtube.com/embed/abc"></embed-block>`,
    );
    await waitFor(() => {
      const card = container.querySelector('[data-provider="youtube"]');
      expect(card).not.toBeNull();
    });
  });

  it('Test 2: <embed-block type="calendly"> → CalendlyBlock with data-provider="calendly"', async () => {
    const container = await renderWithBody(
      `<embed-block type="calendly" data-url="https://calendly.com/me/30min"></embed-block>`,
    );
    await waitFor(() => {
      const card = container.querySelector('[data-provider="calendly"]');
      expect(card).not.toBeNull();
    });
  });

  it('Test 3: <embed-block type="tally"> → TallyBlock with data-provider="tally"', async () => {
    const container = await renderWithBody(
      `<embed-block type="tally" data-url="https://tally.so/r/abc"></embed-block>`,
    );
    await waitFor(() => {
      const card = container.querySelector('[data-provider="tally"]');
      expect(card).not.toBeNull();
    });
  });

  it('Test 4: <embed-block type="custom_iframe"> → CustomIframeBlock renders after allowlist fetch', async () => {
    const container = await renderWithBody(
      `<embed-block type="custom_iframe" data-url="https://meet.example.com/foo"></embed-block>`,
    );
    await waitFor(
      () => {
        const card = container.querySelector('[data-provider="custom_iframe"]');
        expect(card).not.toBeNull();
      },
      { timeout: 2000 },
    );
  });

  it('Test 5 (security): <script> adjacent to <embed-block> is stripped, embed-block renders', async () => {
    const container = await renderWithBody(
      `<script>window.__pwned=true</script><embed-block type="tally" data-url="https://tally.so/r/xyz"></embed-block>`,
    );
    // Script tag must NOT have run.
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    // No <script> in the rendered article body.
    expect(container.querySelector('article script')).toBeNull();
    // Embed-block still resolved.
    await waitFor(() => {
      expect(container.querySelector('[data-provider="tally"]')).not.toBeNull();
    });
  });

  it('Test 6 (dompurify ADD_ATTR tight): <embed-block onerror="..."> strips onerror', async () => {
    // Inject the body, then assert that no node in the article has an onerror.
    const container = await renderWithBody(
      `<embed-block type="tally" data-url="https://tally.so/r/abc" onerror="alert(1)"></embed-block>`,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-provider="tally"]')).not.toBeNull();
    });
    // No node inside <article> may carry an onerror attribute.
    const offenders = container.querySelectorAll('article [onerror]');
    expect(offenders.length).toBe(0);
  });
});

// Silence unused-import lint.
void act;
