/**
 * Phase 9 Plan 09-04 — ClinicInvitePage RTL coverage.
 *
 * Covers State A (loading), States B/C/D dispatch on lookup response,
 * States E/F/G/H copy + CTAs, retry CTA refires lookup, fetch error
 * collapses to State H, and zero-useStore invariant (grep test).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicInvitePage } from './ClinicInvitePage';

const baseInvite = {
  id: 'inv-1',
  email: 'alice@example.com',
  requested_scope: {
    injections: true,
    weights: true,
    photos: true,
    symptoms: true,
    meals: true,
    workouts: true,
    supplements: true,
    mood: true,
    sleep: true,
    doctor_report: true,
  },
  org: { id: 'org-1', name: 'Acme Clinic', logo_storage_path: null },
  operator_first_name: 'Bob',
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: () => {} } },
      })),
      signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
    },
  },
}));

// Make the consent dialog's RPCs no-op so it's stable as a child here.
vi.mock('@/lib/clinic', () => ({
  acceptInviteExisting: vi.fn(async () => ({
    ok: true,
    data: { membership_id: 'm-1', org_id: 'org-1' },
  })),
  acceptInviteNew: vi.fn(async () => ({
    ok: true,
    data: { membership_id: 'm-2', org_id: 'org-1' },
  })),
  rejectInvite: vi.fn(async () => ({ ok: true })),
  hashInviteToken: vi.fn(async (t: string) => `hash-of-${t}`),
}));

const ORIGINAL_FETCH = globalThis.fetch;

function mockLookupResponse(body: unknown, status = 200): void {
  globalThis.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

function setPathname(path: string): void {
  window.history.replaceState({}, '', path);
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
  setPathname('/clinic-invite/abc123');
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('ClinicInvitePage — Plan 09-04', () => {
  it('State A: renders loading heading + skeleton during lookup', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    globalThis.fetch = vi.fn(
      () =>
        new Promise((r) => {
          resolveFetch = (v: unknown) => r(v as Response);
        }),
    ) as unknown as typeof fetch;
    render(<ClinicInvitePage />);
    expect(screen.getByRole('heading', { name: /Opening invitation…/i })).toBeInTheDocument();
    // Cleanup the suspended fetch so the unmount doesn't leak.
    resolveFetch({
      ok: true,
      status: 200,
      json: async () => ({ state: 'load_error' }),
    });
  });

  it('State B: lookup → valid_logged_in renders ConsentDialog', async () => {
    mockLookupResponse({ state: 'valid_logged_in', invite: baseInvite });
    render(<ClinicInvitePage />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Choose what to share/i })).toBeInTheDocument(),
    );
    expect(screen.getAllByRole('checkbox')).toHaveLength(10);
  });

  it('State C: lookup → valid_logged_out_existing renders sign-in prompt', async () => {
    mockLookupResponse({ state: 'valid_logged_out_existing', invite: baseInvite });
    render(<ClinicInvitePage />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Sign in to continue/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Sign in with magic link/i })).toBeInTheDocument();
  });

  it('State D: lookup → valid_new_user renders InviteSignupForm with pre-filled email', async () => {
    mockLookupResponse({ state: 'valid_new_user', invite: baseInvite });
    render(<ClinicInvitePage />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /Create your LeanShot account/i }),
      ).toBeInTheDocument(),
    );
    const email = screen.getByDisplayValue('alice@example.com') as HTMLInputElement;
    expect(email.readOnly).toBe(true);
  });

  it('State E: expired heading + body', async () => {
    mockLookupResponse({ state: 'expired', invite: baseInvite });
    render(<ClinicInvitePage />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /This invitation has expired/i }),
      ).toBeInTheDocument(),
    );
  });

  it('State F: already_used heading + Done CTA', async () => {
    mockLookupResponse({ state: 'already_used' });
    render(<ClinicInvitePage />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', {
          name: /This invitation has already been accepted or declined/i,
        }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Done/i })).toBeInTheDocument();
  });

  it('State G: canceled heading', async () => {
    mockLookupResponse({ state: 'canceled', invite: baseInvite });
    render(<ClinicInvitePage />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /This invitation was canceled by the clinic/i }),
      ).toBeInTheDocument(),
    );
  });

  it('State H: load_error → retry CTA refires lookup', async () => {
    const fetchMock = vi.fn();
    // First call: load_error. Second call (retry): valid_logged_in.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ state: 'load_error' }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ state: 'valid_logged_in', invite: baseInvite }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    render(<ClinicInvitePage />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /Something went wrong loading this invitation/i }),
      ).toBeInTheDocument(),
    );
    await userEvent.setup().click(screen.getByRole('button', { name: /Retry/i }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Choose what to share/i })).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('State H: no token in URL → renders load_error without fetching', async () => {
    setPathname('/clinic-invite/');
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    render(<ClinicInvitePage />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /Something went wrong loading this invitation/i }),
      ).toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetch throws → collapses to State H', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    render(<ClinicInvitePage />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /Something went wrong loading this invitation/i }),
      ).toBeInTheDocument(),
    );
  });

  // Strip JSDoc + line comments before scanning so the JSDoc that names
  // the forbidden tokens (to explain WHY they're forbidden) doesn't fail
  // its own invariant. The production-source rule applies to executable
  // code, not its documentation.
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments incl. JSDoc
      .replace(/^\s*\/\/.*$/gm, ''); // single-line comments
  }

  it('Pitfall #9: zero useStore calls anywhere under src/components/clinic-invite/', () => {
    const dir = resolve(__dirname);
    // Exclude test files: this test itself names the forbidden token.
    const files = readdirSync(dir).filter(
      (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f),
    );
    for (const f of files) {
      const src = stripComments(readFileSync(resolve(dir, f), 'utf8'));
      expect(src, `${f} must not import useStore`).not.toMatch(/\buseStore\b/);
    }
  });

  it('Pitfall: zero `s.user!` non-null assertions in this tree', () => {
    const dir = resolve(__dirname);
    const files = readdirSync(dir).filter(
      (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f),
    );
    for (const f of files) {
      const src = stripComments(readFileSync(resolve(dir, f), 'utf8'));
      expect(src, `${f} must not contain s.user!`).not.toMatch(/s\.user!/);
    }
  });
});
