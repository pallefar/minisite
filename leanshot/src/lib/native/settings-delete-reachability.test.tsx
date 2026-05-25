// Phase 53 Plan 53-02 Task 3 — SettingsPage account-deletion mobile-viewport
// reachability test (MOBILE-08).
//
// Apple §5.1.1(v) + Play §13.7 require account deletion to be reachable from
// within the app. This test proves the "Delete account" affordance in SettingsPage
// is present and functional at a 375px mobile viewport — the minimum width a
// "mobile" user would encounter.
//
// Runs under vitest-mobile.config.ts (jsdom env + React plugin + @capacitor/* aliases).
// Test files under src/lib/native/ are auto-discovered by existing include globs.
//
// Setup mirrors src/test/account-delete.test.tsx:
//   - useStore.setState to inject a permanent (non-anon) signed-in user
//   - vi.mock for heavy or side-effectful dependencies (@/lib/auth, supabase, etc.)
//   - @testing-library/jest-dom matchers
//   - cleanup in afterEach

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// @/lib/auth — SettingsPage calls signOut, requestPasswordReset, attachEmailToAnon
vi.mock('@/lib/auth', () => ({
  signOut: vi.fn(async () => undefined),
  requestPasswordReset: vi.fn(async () => undefined),
  attachEmailToAnon: vi.fn(async () => ({ data: null, error: null })),
}));

// @/lib/mfa/patient-mfa — requireStepUp is called before opening DeleteAccountModal.
// Return ok=true so the modal opens immediately.
const mockRequireStepUp = vi.fn(async () => ({ ok: true as const, method: 'email_otp' as const }));
vi.mock('@/lib/mfa/patient-mfa', () => ({
  requireStepUp: (...args: unknown[]) => mockRequireStepUp(...args),
}));

// @/lib/supabase — SettingsPage uses supabase.from('profiles').update for locale changes.
// The language section is not visited in this test but the import must not throw.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
    functions: {
      invoke: vi.fn(async () => ({ data: { ok: true }, error: null })),
    },
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    })),
  },
}));

// @/lib/export-data — heavy jsPDF + Supabase queries; not needed for this test.
vi.mock('@/lib/export-data', () => ({
  buildJsonExport: vi.fn(() => ({ injections: [] })),
  buildPdfDoc: vi.fn(async () => ({ save: vi.fn() })),
  fetchAuditSummary: vi.fn(async () => ({ logs: [] })),
  fetchCloudExtras: vi.fn(async () => ({ cloudWeights: [] })),
}));

// react-i18next — SettingsPage calls useTranslation(['common', 'nav']).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: 'en',
      resolvedLanguage: 'en',
      changeLanguage: vi.fn(async () => undefined),
    },
  }),
}));

// @/lib/account-delete — DeleteAccountModal uses initiateAccountDeletion.
vi.mock('@/lib/account-delete', async () => {
  const mod = await vi.importActual<Record<string, unknown>>('@/lib/account-delete');
  return {
    ...mod,
    initiateAccountDeletion: vi.fn(async () => undefined),
  };
});

// @/hooks/useToast — prevent any toast side effects leaking into assertions.
const mockToast = vi.fn();
vi.mock('@/hooks/useToast', () => ({
  useToast: () => mockToast,
}));

// ---------------------------------------------------------------------------
// Store fixture — permanent (non-anon) signed-in user
// ---------------------------------------------------------------------------

const FIXTURE_USER_ID = 'deadbeef-0000-0000-0000-000000000001';
const FIXTURE_EMAIL = 'tester@example.com';

function seedSignedInUser() {
  useStore.setState({
    // user must be non-null for SettingsPage not to return null immediately
    user: {
      id: FIXTURE_USER_ID,
      name: 'Test User',
      sex: 'other',
      dob: '1990-01-01',
      goalType: 'lose_fat',
      activityLevel: 'sedentary',
      liftingLevel: 'none',
      currentMedication: 'semaglutide',
      injectionDay: 0,
      units: 'metric',
      locale: 'en',
      timezone: 'UTC',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    signedIn: {
      user: {
        id: FIXTURE_USER_ID,
        email: FIXTURE_EMAIL,
        // is_anonymous: undefined / false → isPermanent = true
      } as unknown as NonNullable<ReturnType<typeof useStore.getState>['signedIn']>['user'],
      verified: true,
    },
  });
}

function clearUser() {
  useStore.setState({ user: null, signedIn: null });
}

// ---------------------------------------------------------------------------
// Viewport helpers
// ---------------------------------------------------------------------------

function setMobileViewport(width = 375) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 812 });
  // matchMedia is already stubbed in vitest-mobile-setup.ts; ensure it returns
  // mobile-accurate matches (max-width: 767px → matches: true for 375px).
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => {
      // Coarse heuristic: max-width queries below 768px match at 375px.
      const maxWidthMatch = /max-width:\s*(\d+)px/.exec(query);
      const matches = maxWidthMatch ? parseInt(maxWidthMatch[1]!, 10) >= width : false;
      return {
        matches,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('MOBILE-08 — SettingsPage account-deletion reachability at 375px', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedSignedInUser();
    setMobileViewport(375);
  });

  afterEach(() => {
    clearUser();
    cleanup();
  });

  async function renderSettingsAndGoToPrivacy() {
    // Lazy import after store is seeded.
    const { SettingsPage } = await import(
      '@/components/dashboard/settings/SettingsPage'
    );
    const user = userEvent.setup();
    render(<SettingsPage open={true} onClose={() => {}} />);

    // Click the "Privacy" nav item to navigate to the privacy section.
    const privacyBtn = screen.getByRole('button', { name: /^Privacy$/ });
    await user.click(privacyBtn);
    return user;
  }

  it('renders "Delete account" heading in Privacy section at 375px viewport', async () => {
    await renderSettingsAndGoToPrivacy();
    // The heading "Delete account" appears inside the isPermanent guard
    const heading = screen.getByText('Delete account', {
      // The heading is an h3; match exact text excluding the button which also says "Delete account"
      selector: 'h3',
    });
    expect(heading).toBeInTheDocument();
  });

  it('"Delete account" button is present and not hidden', async () => {
    await renderSettingsAndGoToPrivacy();
    // The button with text "Delete account" (variant="destructive" leadingIcon=Trash2)
    const buttons = screen.getAllByRole('button', { name: /Delete account/ });
    const deleteBtn = buttons.find(
      (b) =>
        b.tagName === 'BUTTON' &&
        // Not disabled at rest (it opens a step-up gate, not a typed-confirm gate)
        !b.hasAttribute('disabled'),
    );
    expect(deleteBtn).toBeDefined();
    expect(deleteBtn).not.toHaveStyle('display: none');
  });

  it('clicking "Delete account" button surfaces DeleteAccountModal (MOBILE-08)', async () => {
    const user = await renderSettingsAndGoToPrivacy();

    // requireStepUp is mocked to return ok=true → modal should open.
    const deleteBtn = screen.getAllByRole('button', { name: /Delete account/ }).find(
      (b) => b.tagName === 'BUTTON' && !b.hasAttribute('disabled'),
    );
    expect(deleteBtn).toBeDefined();
    await user.click(deleteBtn!);

    // Wait for requireStepUp to resolve and the modal to open.
    await waitFor(() => {
      expect(mockRequireStepUp).toHaveBeenCalledOnce();
    });

    // DeleteAccountModal should be reachable: it contains "DELETE MY ACCOUNT"
    // as the typed-confirm placeholder / label text.
    await waitFor(() => {
      expect(screen.getByLabelText(/Type DELETE MY ACCOUNT to confirm/)).toBeInTheDocument();
    });
  });

  it('DeleteAccountModal is reachable (role=dialog visible)', async () => {
    const user = await renderSettingsAndGoToPrivacy();

    const deleteBtn = screen.getAllByRole('button', { name: /Delete account/ }).find(
      (b) => b.tagName === 'BUTTON' && !b.hasAttribute('disabled'),
    );
    await user.click(deleteBtn!);

    await waitFor(() => {
      const dialogs = screen.getAllByRole('dialog');
      // The DeleteAccountModal should be the innermost dialog (there may be a
      // SettingsPage Modal wrapping the whole page).
      const deleteModal = dialogs.find((d) => within(d).queryByText(/DELETE MY ACCOUNT/) !== null);
      expect(deleteModal).toBeDefined();
    });
  });

  it('configureRC (web no-op) does not prevent SettingsPage from rendering', async () => {
    // Sanity guard: the RC bridge is a web no-op — the Settings page must render
    // without requiring a native bridge. This validates that the Capacitor plugin
    // aliases in vitest-mobile.config.ts keep the import graph intact.
    const { SettingsPage } = await import('@/components/dashboard/settings/SettingsPage');
    const { container } = render(<SettingsPage open={true} onClose={() => {}} />);
    expect(container.firstChild).not.toBeNull();
  });
});
