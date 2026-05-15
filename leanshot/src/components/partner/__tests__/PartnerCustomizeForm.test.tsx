/**
 * Phase 19 Plan 19-06b — PartnerCustomizeForm vitest tests.
 *
 * 4 assertions covering the customize-form behavior:
 *   T1: selectedTemplate='story' → testimonial_quote field VISIBLE
 *   T2: selectedTemplate='coach' → testimonial_quote field HIDDEN
 *   T3: invalid calendly_url → form-level error + partner-profile-update NOT called
 *   T4: valid save → partner-profile-update called with the 6-field body
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PartnerCustomizeForm } from '@/components/partner/PartnerCustomizeForm';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'fake-jwt' } },
        error: null,
      }),
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: null }),
      }),
    },
  },
}));

// Mock the store-backed toast hook (no Zustand involvement).
vi.mock('@/hooks/useToast', () => ({
  useToast: () => () => {
    // no-op
  },
}));

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

const USER_ID = '22222222-2222-2222-2222-222222222222';
const INITIAL = {
  display_name: 'Alice',
  photo_path: '',
  blurb: 'GLP-1 nurse coach',
  calendly_url: '',
  testimonial_quote: 'LeanShot changed my game.',
};

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true }),
  } as Response);
  // @ts-expect-error — test fetch mock
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('PartnerCustomizeForm', () => {
  // ── T1 ──
  it("T1 — selectedTemplate='story' → testimonial_quote VISIBLE", () => {
    render(
      <PartnerCustomizeForm
        userId={USER_ID}
        selectedTemplate="story"
        initial={INITIAL}
      />,
    );
    // Story template surfaces the pull-quote textarea
    expect(screen.queryByLabelText(/Pull-quote/i)).toBeTruthy();
  });

  // ── T2 ──
  it("T2 — selectedTemplate='coach' → testimonial_quote HIDDEN", () => {
    render(
      <PartnerCustomizeForm
        userId={USER_ID}
        selectedTemplate="coach"
        initial={INITIAL}
      />,
    );
    expect(screen.queryByLabelText(/Pull-quote/i)).toBeNull();
  });

  // ── T3 ──
  it('T3 — invalid calendly_url → error + partner-profile-update NOT called', async () => {
    render(
      <PartnerCustomizeForm
        userId={USER_ID}
        selectedTemplate="coach"
        initial={{ ...INITIAL, calendly_url: 'https://evil.example.com/me' }}
      />,
    );
    const submit = screen.getByRole('button', { name: /Save changes/i });
    fireEvent.click(submit);

    // Form-level error surface
    await waitFor(() => {
      expect(screen.getByText(/Use a calendly\.com link/i)).toBeTruthy();
    });
    // No POST should have fired.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── T4 ──
  it('T4 — valid save → partner-profile-update called with 6-field body', async () => {
    render(
      <PartnerCustomizeForm
        userId={USER_ID}
        selectedTemplate="story"
        initial={{ ...INITIAL, calendly_url: 'https://calendly.com/alice/30min' }}
      />,
    );
    const submit = screen.getByRole('button', { name: /Save changes/i });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect((url as string).endsWith('/functions/v1/partner-profile-update')).toBe(true);
    const reqInit = init as RequestInit;
    expect(reqInit.method).toBe('POST');
    expect((reqInit.headers as Record<string, string>).Authorization).toBe('Bearer fake-jwt');

    const body = JSON.parse(reqInit.body as string) as Record<string, unknown>;
    // 6-field body — exactly the allowlist
    const keys = Object.keys(body).sort();
    expect(keys).toEqual(
      [
        'blurb',
        'calendly_url',
        'display_name',
        'photo_path',
        'template_choice',
        'testimonial_quote',
      ].sort(),
    );
    expect(body.template_choice).toBe('story');
    expect(body.calendly_url).toBe('https://calendly.com/alice/30min');
    expect(body.display_name).toBe('Alice');
  });
});
