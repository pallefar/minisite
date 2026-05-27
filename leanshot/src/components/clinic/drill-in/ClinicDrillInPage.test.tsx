/**
 * Phase 10 Plan 10-07 — ClinicDrillInPage.test.tsx
 *
 * 9 Vitest assertions covering the ClinicDrillInPage composition root:
 *
 * Test 1 (snapshot fetch): hook calls Edge Function on mount; on 200, sets snapshot.
 * Test 2 (render with full permissions): all 6 sections visible via ReadOnlyPatientView.
 * Test 3 (permission absence): canViewPhotos=false → Photos section absent, 5 sections visible.
 * Test 4 (log_clinic_view fire): onSectionMount fires supabase.rpc('log_clinic_view') ONCE per section.
 * Test 5 (no duplicate fires): re-rendering does NOT re-fire log_clinic_view for already-mounted sections.
 * Test 6 (401 handling): 401 → useToast with "revoked access" copy; navigate to /clinic/{slug}.
 * Test 7 (403 handling): 403 with blocked_section → useToast with "updated what they share" copy.
 * Test 8 (back button): click "Back to roster" → navigates to /clinic/{slug}.
 * Test 9 (refresh): click Refresh IconButton → re-fires Edge Function fetch.
 *
 * vi.mock hoisting: factory functions MUST NOT reference outer variables — all mock state
 * is captured inside the factory closure. See Plan 10-06 RosterTable.test.tsx for precedent.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import type { ReadOnlyPermissionMap, SnapshotData } from '@/types/snapshot';
import { ClinicDrillInPage } from './ClinicDrillInPage';

// ---- Shared toast tracking at module level (accessible to all tests) ----------
// We use a module-level mock fn that the useToast mock returns. Tests can inspect
// calls to this fn directly.
const sharedToastFn = vi.fn();

// ---- Mock supabase ----------------------------------------------------------------
vi.mock('@/lib/supabase', () => {
  const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });

  // Chainable from().select().eq().maybeSingle()
  const maybeSingleFn = vi.fn();
  const eqFn = vi.fn().mockReturnValue({ maybeSingle: maybeSingleFn });
  const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
  const fromFn = vi.fn().mockReturnValue({ select: selectFn });

  const getSessionFn = vi.fn().mockResolvedValue({
    data: { session: { access_token: 'test-jwt' } },
  });

  return {
    supabase: {
      auth: { getSession: getSessionFn },
      from: fromFn,
      rpc: mockRpc,
    },
  };
});

// ---- Mock useToast ----------------------------------------------------------------
vi.mock('@/hooks/useToast', () => ({
  // Return the same shared fn on every call so tests can assert its calls
  useToast: () => sharedToastFn,
}));

// ---- Mock ReadOnlyPatientView -------------------------------------------------------
// We test ClinicDrillInPage's orchestration logic without rendering the full section tree.
// Mock calls onSectionMount for each visible section using a ref callback.
vi.mock('@/components/shared/ReadOnlyPatientView', () => ({
  ReadOnlyPatientView: ({
    permissionMap,
    onSectionMount,
  }: {
    snapshot: unknown;
    viewerMode: string;
    permissionMap?: {
      canViewInjections: boolean;
      canViewWeights: boolean;
      canViewSymptoms: boolean;
      canViewPhotos: boolean;
      canViewDoctorReport: boolean;
    };
    onSectionMount?: (name: string) => void;
  }) => {
    const sections: Array<[string, boolean]> = [
      ['chart', permissionMap?.canViewInjections ?? true],
      ['injections', permissionMap?.canViewInjections ?? true],
      ['weights', permissionMap?.canViewWeights ?? true],
      ['symptoms', permissionMap?.canViewSymptoms ?? true],
      ['photos', permissionMap?.canViewPhotos ?? true],
      ['doctor_report', permissionMap?.canViewDoctorReport ?? true],
    ];
    return (
      <div data-testid="read-only-patient-view">
        {sections.map(([name, visible]) =>
          visible ? (
            <div
              key={name}
              data-testid={`section-${name}`}
              ref={(el) => {
                if (el && onSectionMount && !el.dataset.mounted) {
                  el.dataset.mounted = '1';
                  onSectionMount(name);
                }
              }}
            >
              {name} section
            </div>
          ) : null,
        )}
      </div>
    );
  },
}));

// ---- Mock ClinicContextBar ----------------------------------------------------------
vi.mock('@/components/clinic/ClinicContextBar', () => ({
  ClinicContextBar: ({ org }: { org: { name: string } }) => (
    <header data-testid="clinic-context-bar">{org.name}</header>
  ),
}));

// ---- Import after mocks -------------------------------------------------------

// ---- Typed mock accessors -------------------------------------------------------
const mockRpc = supabase.rpc as ReturnType<typeof vi.fn>;
const mockFrom = supabase.from as ReturnType<typeof vi.fn>;

// ---- Fixtures ----------------------------------------------------------------

function buildSnapshot(overrides: Partial<SnapshotData> = {}): SnapshotData {
  return {
    patient_user_id: 'patient-user-1',
    display_name: 'Alice Baker',
    injections: [{ id: 'inj-1', dose_mg: 0.5, site: 'abdomen', created_at: '2024-01-01T10:00:00Z' }],
    weights: [{ id: 'w-1', weight_kg: 85, recorded_at: '2024-01-01T08:00:00Z' }],
    symptoms: [{ id: 's-1', name: 'nausea', severity: 2, recorded_at: '2024-01-01T12:00:00Z' }],
    photos: [{ id: 'p-1', storage_path: 'org/user/p-1.jpg', taken_at: '2024-01-01T09:00:00Z' }],
    doctor_report: { generated_at: '2024-01-01T10:00:00Z', markdown: '# Report' },
    viewer_context: 'clinic',
    org_id: 'org-1',
    permission_map: fullPermMap(),
    consent_scope: {
      injections: true,
      weights: true,
      symptoms: true,
      photos: true,
      doctor_report: true,
      meals: true,
      workouts: true,
      supplements: true,
      mood: true,
      sleep: true,
    },
    ...overrides,
  };
}

function fullPermMap(): ReadOnlyPermissionMap {
  return {
    canViewInjections: true,
    canViewWeights: true,
    canViewSymptoms: true,
    canViewPhotos: true,
    canViewDoctorReport: true,
    canViewMeals: true,
    canViewWorkouts: true,
    canViewSupplements: true,
    canViewMood: true,
    canViewSleep: true,
    canViewBreakdown: true,
  };
}

const FAKE_ORG = {
  id: 'org-1',
  slug: 'test-clinic',
  name: 'Test Clinic',
  description: null,
  website_url: null,
  logo_storage_path: null,
  created_by: 'op-1',
  created_at: '2024-01-01T00:00:00Z',
};

// ---- Setup helpers -----------------------------------------------------------

function setupOrgMock(orgData: typeof FAKE_ORG | null = FAKE_ORG) {
  const maybeSingleFn = vi.fn().mockResolvedValue({ data: orgData, error: null });
  const eqFn = vi.fn().mockReturnValue({ maybeSingle: maybeSingleFn });
  const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
  mockFrom.mockReturnValue({ select: selectFn });
}

function setupFetchMock(opts: {
  status?: number;
  body?: Partial<SnapshotData> | { blocked_section?: string } | null;
}) {
  const status = opts.status ?? 200;
  const body = opts.body ?? buildSnapshot();
  global.fetch = vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body),
  });
}

function setPathname(pathname: string) {
  Object.defineProperty(window, 'location', {
    value: { pathname, hash: '', search: '' },
    writable: true,
    configurable: true,
  });
}

let pushStateSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  sharedToastFn.mockClear();
  setPathname('/clinic/test-clinic/patient/patient-user-1');
  setupOrgMock();
  setupFetchMock({});
  mockRpc.mockResolvedValue({ data: null, error: null });
  pushStateSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => undefined);
   
  delete (window as any).posthog;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- Render helper -----------------------------------------------------------

function renderDrillIn() {
  return render(
    <Suspense fallback={<div>loading</div>}>
      <ClinicDrillInPage />
    </Suspense>
  );
}

// ============================================================================
// Test 1 — Snapshot fetch: hook calls Edge Function on mount; 200 → renders
// ============================================================================
describe('Test 1 — snapshot fetch and render', () => {
  it('calls clinic-snapshot Edge Function on mount and renders drill-in page', async () => {
    renderDrillIn();
    await waitFor(() => {
      expect(screen.getByTestId('drill-in-page')).toBeInTheDocument();
    }, { timeout: 8000 });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/functions/v1/clinic-snapshot'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-jwt' }),
      }),
    );
  });
});

// ============================================================================
// Test 2 — Render with full permissions: all 6 sections visible
// ============================================================================
describe('Test 2 — render with full permissions', () => {
  it('renders ClinicContextBar + sub-bar + ReadOnlyPatientView with all 6 sections', async () => {
    renderDrillIn();
    await waitFor(() => {
      expect(screen.getByTestId('drill-in-page')).toBeInTheDocument();
    }, { timeout: 8000 });

    expect(screen.getByTestId('clinic-context-bar')).toBeInTheDocument();
    expect(screen.getByTestId('drill-in-sub-bar')).toBeInTheDocument();
    expect(screen.getByTestId('read-only-patient-view')).toBeInTheDocument();
    expect(screen.getByTestId('section-chart')).toBeInTheDocument();
    expect(screen.getByTestId('section-injections')).toBeInTheDocument();
    expect(screen.getByTestId('section-weights')).toBeInTheDocument();
    expect(screen.getByTestId('section-symptoms')).toBeInTheDocument();
    expect(screen.getByTestId('section-photos')).toBeInTheDocument();
    expect(screen.getByTestId('section-doctor_report')).toBeInTheDocument();
  });
});

// ============================================================================
// Test 3 — Permission gating: canViewPhotos=false → Photos section absent
// ============================================================================
describe('Test 3 — permission gating (canViewPhotos=false)', () => {
  it('Photos section is absent when canViewPhotos=false; 5 other sections visible', async () => {
    const noPhotosSnapshot = buildSnapshot({
      permission_map: { ...fullPermMap(), canViewPhotos: false },
    });
    setupFetchMock({ body: noPhotosSnapshot });

    renderDrillIn();
    await waitFor(() => {
      expect(screen.getByTestId('drill-in-page')).toBeInTheDocument();
    }, { timeout: 8000 });

    expect(screen.queryByTestId('section-photos')).not.toBeInTheDocument();
    expect(screen.getByTestId('section-injections')).toBeInTheDocument();
    expect(screen.getByTestId('section-weights')).toBeInTheDocument();
    expect(screen.getByTestId('section-symptoms')).toBeInTheDocument();
    expect(screen.getByTestId('section-doctor_report')).toBeInTheDocument();
  });
});

// ============================================================================
// Test 4 — log_clinic_view fire: ONCE per section on first mount
// ============================================================================
describe('Test 4 — log_clinic_view fires ONCE per section on first mount', () => {
  it('supabase.rpc(log_clinic_view) called once per visible section with PostHog', async () => {
    const mockCapture = vi.fn();
     
    (window as any).posthog = { capture: mockCapture };

    renderDrillIn();
    await waitFor(() => {
      expect(screen.getByTestId('drill-in-page')).toBeInTheDocument();
    }, { timeout: 8000 });

    // Should have been called 6 times (once per section)
    await waitFor(() => {
      const logViewCalls = mockRpc.mock.calls.filter(
        ([name]: [string]) => name === 'log_clinic_view'
      );
      expect(logViewCalls.length).toBe(6);
    }, { timeout: 8000 });

    const logViewCalls = mockRpc.mock.calls.filter(([name]: [string]) => name === 'log_clinic_view');
    const sectionNames = logViewCalls.map(([, args]: [string, { p_section_name: string }]) => args.p_section_name);
    expect(sectionNames).toContain('chart');
    expect(sectionNames).toContain('injections');
    expect(sectionNames).toContain('weights');
    expect(sectionNames).toContain('symptoms');
    expect(sectionNames).toContain('photos');
    expect(sectionNames).toContain('doctor_report');

    // PostHog event fires for each section
    await waitFor(() => {
      const drillCalls = mockCapture.mock.calls.filter(
        ([event]: [string]) => event === 'clinic_drill_section_expanded'
      );
      expect(drillCalls.length).toBe(6);
    }, { timeout: 8000 });
  });
});

// ============================================================================
// Test 5 — No duplicate fires on re-render
// ============================================================================
describe('Test 5 — no duplicate log_clinic_view fires on re-render', () => {
  it('re-rendering ClinicDrillInPage does NOT re-fire log_clinic_view for already-mounted sections', async () => {
    const { rerender } = renderDrillIn();
    await waitFor(() => {
      expect(screen.getByTestId('drill-in-page')).toBeInTheDocument();
    }, { timeout: 8000 });

    await waitFor(() => {
      const calls = mockRpc.mock.calls.filter(([name]: [string]) => name === 'log_clinic_view');
      expect(calls.length).toBe(6);
    }, { timeout: 8000 });

    const callsBefore = mockRpc.mock.calls.filter(([name]: [string]) => name === 'log_clinic_view').length;

    rerender(
      <Suspense fallback={<div>loading</div>}>
        <ClinicDrillInPage />
      </Suspense>
    );
    await act(async () => {});

    const callsAfter = mockRpc.mock.calls.filter(([name]: [string]) => name === 'log_clinic_view').length;
    expect(callsAfter).toBe(callsBefore);
  });
});

// ============================================================================
// Test 6 — 401 handling: toast + redirect
// ============================================================================
describe('Test 6 — 401 handling', () => {
  it('401 from Edge Function → toast with revoked copy; navigate to /clinic/{slug} after 1s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setupFetchMock({ status: 401, body: null });

    renderDrillIn();

    // Wait for org to load (org fetch resolves immediately; snapshot returns 401)
    await act(async () => {
      // Flush microtasks by yielding to the event loop
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() => {
      const revokedCalls = sharedToastFn.mock.calls.filter(
        ([msg]: [string]) =>
          typeof msg === 'string' &&
          msg.includes('revoked access') &&
          msg.includes('Returning to roster')
      );
      expect(revokedCalls.length).toBeGreaterThan(0);
    }, { timeout: 8000 });

    // Advance timer to fire the 1s navigation
    await act(async () => {
      vi.advanceTimersByTime(1100);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(pushStateSpy).toHaveBeenCalledWith({}, '', '/clinic/test-clinic');
    vi.useRealTimers();
  });
});

// ============================================================================
// Test 7 — 403 handling: section unmount, toast
// ============================================================================
describe('Test 7 — 403 handling', () => {
  it('403 with blocked_section=photos → toast with updated-share copy', async () => {
    setupFetchMock({ status: 403, body: { blocked_section: 'photos' } });

    renderDrillIn();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() => {
      const updatedCalls = sharedToastFn.mock.calls.filter(
        ([msg]: [string]) =>
          typeof msg === 'string' && msg.includes('updated what they share')
      );
      expect(updatedCalls.length).toBeGreaterThan(0);
    }, { timeout: 8000 });
  });
});

// ============================================================================
// Test 8 — Back button: navigates to /clinic/{slug}
// ============================================================================
describe('Test 8 — back button navigation', () => {
  it('clicking Back to roster button navigates to /clinic/{slug}', async () => {
    renderDrillIn();
    await waitFor(() => {
      expect(screen.getByTestId('drill-in-sub-bar')).toBeInTheDocument();
    }, { timeout: 8000 });

    const backButton = screen.getByTestId('drill-in-back-button');
    await act(async () => {
      fireEvent.click(backButton);
    });

    expect(pushStateSpy).toHaveBeenCalledWith({}, '', '/clinic/test-clinic');
  });
});

// ============================================================================
// Test 9 — Refresh: re-fires Edge Function fetch
// ============================================================================
describe('Test 9 — refresh re-fires snapshot fetch', () => {
  it('clicking Refresh button calls clinic-snapshot Edge Function again', async () => {
    renderDrillIn();
    await waitFor(() => {
      expect(screen.getByTestId('drill-in-page')).toBeInTheDocument();
    }, { timeout: 8000 });

    const fetchCallsBefore = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    const refreshButton = screen.getByTestId('drill-in-refresh-button');
    await act(async () => {
      fireEvent.click(refreshButton);
    });

    await waitFor(() => {
      const fetchCallsAfter = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(fetchCallsAfter).toBeGreaterThan(fetchCallsBefore);
    }, { timeout: 8000 });
  });
});
