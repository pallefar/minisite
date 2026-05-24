/**
 * Phase 39 Plan 39-08 Task 1 — PharmaVersionList tests.
 *
 * Contract per <interfaces>:
 *   (a) renders one row per PharmaContentVersion with author_name +
 *       created_at (date string visible)
 *   (b) clinical_signoff_at null -> 'Pending sign-off' warning badge
 *   (c) clinical_signoff_at set -> 'Reviewed by {clinician}' success badge
 *   (d) versions are sorted descending by created_at
 *   (e) empty list renders a friendly placeholder
 *
 * Per UI-SPEC line 200-203 the column header literals are "Author" +
 * "Clinical review"; tests assert exact copy.
 *
 * UI-SPEC line 132 reserved-accent constraint: no teal class on signoff badges.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PharmaVersionList, type PharmaContentVersion } from './PharmaVersionList';

function makeVersion(overrides: Partial<PharmaContentVersion> = {}): PharmaContentVersion {
  return {
    id: 'ver-1',
    content_id: 'content-1',
    diff: { summary: 'edit 1' },
    author_id: 'auth-1',
    author_name: 'Alice Author',
    clinical_signoff_by: null,
    clinical_signoff_at: null,
    clinical_signoff_name: null,
    created_at: '2026-05-22T12:00:00Z',
    ...overrides,
  };
}

describe('PharmaVersionList', () => {
  it('(a) renders one row per version with author_name and date', () => {
    render(
      <PharmaVersionList
        contentId="content-1"
        versions={[
          makeVersion({ id: 'v1', author_name: 'Alice' }),
          makeVersion({ id: 'v2', author_name: 'Bob' }),
        ]}
      />,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    // UI-SPEC line 199 header
    expect(screen.getByText(/Pharma content versions/i)).toBeInTheDocument();
    // UI-SPEC line 200 + 201 column headers
    expect(screen.getByText('Author')).toBeInTheDocument();
    expect(screen.getByText('Clinical review')).toBeInTheDocument();
  });

  it('(b) clinical_signoff_at null renders Pending sign-off warning badge', () => {
    const { container } = render(
      <PharmaVersionList
        contentId="c1"
        versions={[makeVersion({ id: 'v1', clinical_signoff_at: null })]}
      />,
    );
    expect(screen.getByText('Pending sign-off')).toBeInTheDocument();
    // Warning tone class from Badge primitive
    const badge = screen.getByText('Pending sign-off');
    expect(badge.className).toMatch(/warning/);
  });

  it('(c) clinical_signoff_at set renders Reviewed by {clinician} success badge', () => {
    render(
      <PharmaVersionList
        contentId="c1"
        versions={[
          makeVersion({
            id: 'v1',
            clinical_signoff_by: 'clin-1',
            clinical_signoff_at: '2026-05-22T13:00:00Z',
            clinical_signoff_name: 'Dr. Carol',
          }),
        ]}
      />,
    );
    const badge = screen.getByText('Reviewed by Dr. Carol');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/success/);
  });

  it('(d) versions sorted descending by created_at', () => {
    const { container } = render(
      <PharmaVersionList
        contentId="c1"
        versions={[
          makeVersion({
            id: 'old',
            author_name: 'Older',
            created_at: '2026-04-01T00:00:00Z',
          }),
          makeVersion({
            id: 'new',
            author_name: 'Newer',
            created_at: '2026-05-22T00:00:00Z',
          }),
        ]}
      />,
    );
    const rows = container.querySelectorAll('[data-row="pharma-version"]');
    expect(rows.length).toBe(2);
    // First rendered row is the newest
    expect(within(rows[0] as HTMLElement).getByText('Newer')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('Older')).toBeInTheDocument();
  });

  it('(e) empty list renders placeholder', () => {
    render(<PharmaVersionList contentId="c1" versions={[]} />);
    expect(screen.getByText(/No versions yet/i)).toBeInTheDocument();
  });

  it('(f) no teal/accent class on signoff badges (UI-SPEC line 132)', () => {
    const { container } = render(
      <PharmaVersionList
        contentId="c1"
        versions={[
          makeVersion({ id: 'v1' }),
          makeVersion({
            id: 'v2',
            clinical_signoff_at: '2026-05-22T13:00:00Z',
            clinical_signoff_name: 'Dr. C',
          }),
        ]}
      />,
    );
    const html = container.innerHTML.toLowerCase();
    expect(html).not.toMatch(/teal/);
    expect(html).not.toMatch(/--color-accent[^-]/);
  });
});
