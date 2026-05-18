/**
 * Phase 32 Plan 32-04 — LocaleOverridesModule render + interaction tests.
 *
 * Mocks the locale-overrides-client functions so the module's CRUD flow can
 * be exercised without a live Supabase connection.
 *
 * Boundaries:
 *   - Empty state renders with "New override" CTA.
 *   - Clicking "New override" opens the inline editor.
 *   - Rendering populated rows shows columns (lng, ns, key, value, status).
 *   - Per T-32-04-01 (XSS mitigation): the value cell renders as plain text;
 *     a value containing "<script>" is NOT executed (verified via DOM probe).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../locale-overrides-client', () => ({
  listOverrides: vi.fn(async () => []),
  upsertOverride: vi.fn(async (input: unknown) => ({ id: 'new-id', ...(input as object) })),
  deleteOverride: vi.fn(async () => undefined),
  publishOverride: vi.fn(async (id: string) => ({ id, published: true })),
  broadcastPublish: vi.fn(async () => undefined),
}));
// react-i18next is widely used; mock useTranslation so the test doesn't need
// a real i18next instance bootstrap. Returns the defaultValue (2nd arg).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));
import * as client from '../locale-overrides-client';
import LocaleOverridesModule from '../LocaleOverridesModule';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Plan 32-04 LocaleOverridesModule — empty state', () => {
  it('renders title, subtitle, and the "New override" CTA when the list is empty', async () => {
    (client.listOverrides as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    render(<LocaleOverridesModule />);

    expect(screen.getByText('Locale Overrides')).toBeInTheDocument();
    expect(
      screen.getByText('Hot-patch translations per-org or globally without redeploying.'),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('No overrides found.')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'New override' })).toBeInTheDocument();
  });

  it('clicking "New override" opens the OverrideEditor inline', async () => {
    (client.listOverrides as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    render(<LocaleOverridesModule />);

    await waitFor(() => expect(screen.getByText('No overrides found.')).toBeInTheDocument());

    const button = screen.getByRole('button', { name: 'New override' });
    fireEvent.click(button);

    // Editor surfaces input fields. "New override" text appears in both the
    // CTA button and the editor card header — assert at least one match exists
    // (we don't care which), then assert the editor-specific Save/Cancel pair.
    expect(screen.getAllByText('New override').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});

describe('Plan 32-04 LocaleOverridesModule — populated list', () => {
  it('renders rows with lng / ns / key / value columns', async () => {
    (client.listOverrides as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'r1',
        org_id: null,
        lng: 'es',
        ns: 'common',
        key: 'action.save',
        value: 'Guardado',
        published: true,
        created_by: 'admin-uid',
        created_at: '2026-05-18T00:00:00Z',
        updated_at: '2026-05-18T00:00:00Z',
      },
    ]);
    render(<LocaleOverridesModule />);

    await waitFor(() => {
      expect(screen.getByText('action.save')).toBeInTheDocument();
    });
    expect(screen.getByText('Guardado')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByText('Global')).toBeInTheDocument();
  });

  it('T-32-04-01 — value containing <script> tag is rendered as plain text (no DOM execution)', async () => {
    const xssPayload = '<script>window.__xss=true</script>';
    (client.listOverrides as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'r2',
        org_id: null,
        lng: 'en',
        ns: 'common',
        key: 'hello',
        value: xssPayload,
        published: true,
        created_by: null,
        created_at: '2026-05-18T00:00:00Z',
        updated_at: '2026-05-18T00:00:00Z',
      },
    ]);
    render(<LocaleOverridesModule />);

    await waitFor(() => {
      // Plain-text rendering: the literal payload string appears in the DOM,
      // proving React escaped it (no <script> element was injected).
      expect(screen.getByText(xssPayload)).toBeInTheDocument();
    });
    // Probe: the global flag must NOT have been set; React JSX text escapes safely.
    expect((window as unknown as { __xss?: boolean }).__xss).toBeUndefined();
    // Defense-in-depth: no <script> element was injected into the rendered tree.
    const scripts = document.querySelectorAll('script');
    for (const s of Array.from(scripts)) {
      expect(s.textContent ?? '').not.toContain('window.__xss');
    }
  });
});
