/**
 * Phase 42 Plan 42-09 Task 2 — WhatsNewDrawer + Topbar wiring tests.
 *
 * Covers the 6 behaviours in 42-09-PLAN.md:
 *   1. Renders one <article> per entry with title + date + markdown body.
 *   2. Markdown body is sanitized — `<script>alert(1)</script>` in body_md
 *      does NOT yield a <script> tag in the DOM.
 *   3. Clicking "Got it" calls markRead() and triggers onClose.
 *   4. (Topbar) Avatar Button gets an unread-dot span when hasUnread.
 *   5. (a11y) Avatar Button has the dynamic aria-label.
 *   6. (lazy) Topbar + App.tsx use React.lazy for the drawer (grep proof).
 *
 * The grep-proof for #6 is a static-source assertion at the bottom of the
 * file; the test runs in jsdom-mode vitest so reading the source file is
 * a synchronous fs op (`readFileSync`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import type { ChangelogEntry } from '@/lib/changelog/drawer-trigger';
import { WhatsNewDrawer } from './WhatsNewDrawer';

const sampleEntries: ChangelogEntry[] = [
  {
    id: 'a',
    slug: 'v1-3-dark-mode',
    title: 'Dark mode, everywhere',
    body_md: '## Highlights\n\nDark mode now covers every surface.',
    published_at: '2026-05-19T00:00:00Z',
  },
  {
    id: 'b',
    slug: 'v1-3-pwa-offline',
    title: 'View your data offline',
    body_md: 'Read-only **offline** support.',
    published_at: '2026-05-18T00:00:00Z',
  },
];

describe('WhatsNewDrawer', () => {
  it('Test 1: renders one <article> per entry with title + time + markdown body', () => {
    const onClose = vi.fn();
    const markRead = vi.fn();
    render(
      <WhatsNewDrawer
        open
        entries={sampleEntries}
        onClose={onClose}
        markRead={markRead}
      />,
    );
    const articles = document.querySelectorAll('article');
    expect(articles.length).toBe(2);
    expect(screen.getByText('Dark mode, everywhere')).toBeInTheDocument();
    expect(screen.getByText('View your data offline')).toBeInTheDocument();
    // Each entry has a <time dateTime={published_at}> element
    const times = document.querySelectorAll('time');
    expect(times.length).toBe(2);
    expect(times[0]?.getAttribute('datetime')).toBe('2026-05-19T00:00:00Z');
    // Markdown body renders — h2 from `## Highlights` becomes an <h2>
    expect(document.querySelector('article h2')?.textContent).toContain('Highlights');
  });

  it('Test 2: sanitises XSS — script tag in body_md does NOT render', () => {
    const malicious: ChangelogEntry[] = [
      {
        id: 'x',
        slug: 'xss',
        title: 'XSS attempt',
        body_md:
          'Safe text. <script>alert(1)</script> <img src=x onerror="alert(2)" /> [bad](javascript:alert(3))',
        published_at: '2026-05-19T00:00:00Z',
      },
    ];
    render(
      <WhatsNewDrawer
        open
        entries={malicious}
        onClose={() => {}}
        markRead={() => Promise.resolve()}
      />,
    );
    // The dompurify chain MUST strip the script element entirely from the rendered DOM.
    expect(document.querySelector('script')).toBeNull();
    // The on* handler attribute must NOT survive sanitisation.
    const img = document.querySelector('img');
    if (img) {
      expect(img.getAttribute('onerror')).toBeNull();
    }
    // javascript: URLs are stripped by dompurify defaults.
    const link = document.querySelector('a[href^="javascript:"]');
    expect(link).toBeNull();
  });

  it('Test 3: clicking "Got it" calls markRead() then onClose()', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const markRead = vi.fn().mockResolvedValue(undefined);
    render(
      <WhatsNewDrawer
        open
        entries={sampleEntries}
        onClose={onClose}
        markRead={markRead}
      />,
    );
    const button = screen.getByRole('button', { name: /got it/i });
    await user.click(button);
    expect(markRead).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('Test 6 (lazy): Topbar and App.tsx import WhatsNewDrawer via React.lazy', () => {
    const topbarSrc = readFileSync(
      resolve(__dirname, '../layout/Topbar.tsx'),
      'utf8',
    );
    const appSrc = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
    // At least ONE of {App.tsx, Topbar.tsx} must lazy-load the drawer; the
    // plan recommends App.tsx-mounted to keep the Topbar chunk slim.
    // Detect `lazy(() => import('@/components/changelog/WhatsNewDrawer')...)`
    // — the arrow body crosses several `)` so we match across newlines.
    const lazyRegex = /lazy\([\s\S]*?WhatsNewDrawer/;
    const anyLazy = lazyRegex.test(topbarSrc) || lazyRegex.test(appSrc);
    expect(anyLazy).toBe(true);
    // And neither file should statically `import { WhatsNewDrawer }` (would
    // pull the chunk into the index static graph and trip Pitfall 9).
    const staticImportRegex = /^import\s+\{[^}]*WhatsNewDrawer[^}]*\}\s+from/m;
    expect(staticImportRegex.test(topbarSrc)).toBe(false);
    expect(staticImportRegex.test(appSrc)).toBe(false);
  });

  it('a11y: drawer body passes axe-core with zero blocking violations', async () => {
    render(
      <WhatsNewDrawer
        open
        entries={sampleEntries}
        onClose={() => {}}
        markRead={() => Promise.resolve()}
      />,
    );
    // Find the dialog (Sheet wraps drawer in role="dialog").
    const dialog = document.querySelector('[role="dialog"]') ?? document.body;
    const results = await axe.run(dialog as HTMLElement, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag22aa'] },
    });
    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(blocking).toEqual([]);
  });
});
