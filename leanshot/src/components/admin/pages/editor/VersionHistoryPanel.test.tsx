/**
 * Phase 15 Plan 09 — VersionHistoryPanel contract tests (TDD RED).
 *
 * D-07 invariant: restore RE-POINTS landing_pages.published_revision_id
 * (via the page-publish Edge Function); the landing_page_revisions row
 * itself is NEVER mutated. This test file proves the UI surface honors
 * the contract:
 *   1. One row per revision, newest first.
 *   2. Empty state copy when no revisions exist.
 *   3. Restore button opens a confirmation Modal (not an immediate call).
 *   4. Confirming calls the injected restore callback exactly once with
 *      THIS row's revision id; cancelling never calls it.
 *   5. Invariant guard: the restore callback is only ever invoked with a
 *      revisionId that is IN the panel's own `revisions` prop — the panel
 *      never fabricates or accepts an out-of-list id.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VersionHistoryPanel } from './VersionHistoryPanel';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.style.overflow = '';
});

const REVISIONS = [
  // Intentionally out-of-order — component must sort newest-first.
  { id: 'rev-older', created_at: '2026-05-10T08:00:00Z', created_by_email: 'alice@example.com' },
  { id: 'rev-newest', created_at: '2026-05-14T10:30:00Z', created_by_email: 'bob@example.com' },
  { id: 'rev-middle', created_at: '2026-05-12T12:00:00Z', created_by_email: 'alice@example.com' },
];

describe('VersionHistoryPanel — render + ordering', () => {
  it('renders one row per revision, newest first', () => {
    render(
      <VersionHistoryPanel
        open
        onClose={() => {}}
        pageId="page-1"
        revisions={REVISIONS}
        restoreFn={vi.fn()}
      />,
    );
    const restoreButtons = screen.getAllByRole('button', { name: /restore/i });
    // 3 row Restore buttons (no confirm modal open yet)
    expect(restoreButtons).toHaveLength(3);
    // First row should be the newest revision — assert by author email proximity
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  it('renders the UI-SPEC empty-state copy when revisions=[]', () => {
    render(
      <VersionHistoryPanel
        open
        onClose={() => {}}
        pageId="page-1"
        revisions={[]}
        restoreFn={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/No saved versions yet\. Changes are saved automatically\./i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restore/i })).not.toBeInTheDocument();
  });
});

describe('VersionHistoryPanel — restore-with-confirm flow', () => {
  it('clicking Restore opens a confirmation Modal — does NOT invoke restoreFn yet', async () => {
    const restoreFn = vi.fn();
    const user = userEvent.setup();
    render(
      <VersionHistoryPanel
        open
        onClose={() => {}}
        pageId="page-1"
        revisions={REVISIONS}
        restoreFn={restoreFn}
      />,
    );
    const rowRestores = screen.getAllByRole('button', { name: /^restore$/i });
    await user.click(rowRestores[0]!);
    // Confirmation Modal title rendered:
    expect(screen.getByText(/Restore this version\?/i)).toBeInTheDocument();
    // restoreFn must NOT have been called yet
    expect(restoreFn).not.toHaveBeenCalled();
  });

  it('confirming in the Modal calls restoreFn exactly once with that row id; cancelling does not', async () => {
    const restoreFn = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <VersionHistoryPanel
        open
        onClose={() => {}}
        pageId="page-1"
        revisions={REVISIONS}
        restoreFn={restoreFn}
      />,
    );
    // Open confirm dialog from the newest row (rev-newest is sorted first).
    const rowRestores = screen.getAllByRole('button', { name: /^restore$/i });
    await user.click(rowRestores[0]!);
    // Cancel first — restoreFn must remain uncalled.
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(restoreFn).not.toHaveBeenCalled();
    // Re-open + confirm — restoreFn fires exactly once with rev-newest.
    await user.click(screen.getAllByRole('button', { name: /^restore$/i })[0]!);
    // Find the confirm button inside the dialog title region
    const dialog = screen.getByText(/Restore this version\?/i).closest('[role="dialog"]')!;
    const confirmBtn = within(dialog as HTMLElement).getByRole('button', { name: /^restore$/i });
    await user.click(confirmBtn);
    expect(restoreFn).toHaveBeenCalledTimes(1);
    expect(restoreFn).toHaveBeenCalledWith({ pageId: 'page-1', revisionId: 'rev-newest' });
  });
});

describe('VersionHistoryPanel — invariant guard (T-15-09-04)', () => {
  let restoreFn: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    restoreFn = vi.fn().mockResolvedValue(undefined);
  });

  it('the restore callback is only ever invoked with a revisionId from the panel`s own revisions prop', async () => {
    const user = userEvent.setup();
    render(
      <VersionHistoryPanel
        open
        onClose={() => {}}
        pageId="page-1"
        revisions={REVISIONS}
        restoreFn={restoreFn}
      />,
    );
    // Click EVERY row's Restore button in turn, confirm, then verify each
    // call's revisionId is one of the ids the panel was given.
    const allowedIds = new Set(REVISIONS.map((r) => r.id));
    const rowsCount = REVISIONS.length;
    for (let i = 0; i < rowsCount; i++) {
      const rowRestores = screen.getAllByRole('button', { name: /^restore$/i });
      await user.click(rowRestores[i]!);
      const dialog = screen
        .getByText(/Restore this version\?/i)
        .closest('[role="dialog"]') as HTMLElement;
      await user.click(within(dialog).getByRole('button', { name: /^restore$/i }));
    }
    expect(restoreFn).toHaveBeenCalledTimes(rowsCount);
    for (const call of restoreFn.mock.calls) {
      const arg = call[0] as { pageId: string; revisionId: string };
      expect(arg.pageId).toBe('page-1');
      expect(allowedIds.has(arg.revisionId)).toBe(true);
    }
  });
});
