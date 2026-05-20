/**
 * Phase 34 Plan 34-08 ONBOARD-07 — OnboardingBuilderModule unit tests.
 *
 * Covers the Save-button gate (Pattern S1 client layer), the placeholder
 * seams for Plan 34-09, and the supabase.rpc save path including the
 * 42501-superadmin-required branch.
 */
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingBuilderModule from './OnboardingBuilderModule';

// -------- mocks (vi.mock is hoisted by vitest before the import above) --------
const mockToast = vi.fn();
vi.mock('@/hooks/useToast', () => ({
  useToast: () => mockToast,
}));

const mockGetUser = vi.fn();
const mockFromMaybeSingle = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: (...args: unknown[]) => mockGetUser(...args),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => mockFromMaybeSingle(table),
        }),
      }),
    }),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

// Mock SortableTreePanel to avoid mounting dnd-kit in jsdom (heavy + irrelevant
// to the assertions here; coverage of the actual sortable behavior lives in
// SortableTreePanel's own tests under src/components/ui/__tests__/).
vi.mock('@/components/ui/SortableTreePanel', () => ({
  SortableTreePanel: ({
    items,
    renderItem,
    getId,
    onReorder,
  }: {
    items: Array<{ id: string }>;
    renderItem: (item: { id: string }, i: number, dragging: boolean) => React.ReactNode;
    getId: (item: { id: string }) => string;
    onReorder: (next: Array<{ id: string }>) => void;
  }) => (
    <div data-testid="mock-sortable-tree-panel">
      <button
        data-testid="mock-reorder-trigger"
        onClick={() => onReorder([...items].reverse())}
      >
        reorder
      </button>
      {items.map((item, i) => (
        <div key={getId(item)} data-testid={`mock-tree-row-${i}`}>
          {renderItem(item, i, false)}
        </div>
      ))}
    </div>
  ),
}));

// -------- helpers --------
function primeSupabase(opts: {
  adminRole: 'superadmin' | 'admin' | null;
  flowConfig: unknown;
}): void {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } });
  mockFromMaybeSingle.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return Promise.resolve({
        data: opts.adminRole === null ? null : { admin_role: opts.adminRole },
        error: null,
      });
    }
    if (table === 'onboarding_flows') {
      return Promise.resolve({ data: { config: opts.flowConfig }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

beforeEach(() => {
  mockToast.mockReset();
  mockGetUser.mockReset();
  mockFromMaybeSingle.mockReset();
  mockRpc.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('OnboardingBuilderModule (Plan 34-08) — Save gate', () => {
  it('Save button enabled when profiles.admin_role = superadmin', async () => {
    primeSupabase({ adminRole: 'superadmin', flowConfig: [] });
    render(<OnboardingBuilderModule />);

    const btn = await screen.findByRole('button', { name: /save flow/i });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    expect(btn.getAttribute('title')).toBeNull();
  });

  it('Save button disabled when profiles.admin_role = admin (non-superadmin)', async () => {
    primeSupabase({ adminRole: 'admin', flowConfig: [] });
    render(<OnboardingBuilderModule />);

    const btn = await screen.findByRole('button', { name: /save flow/i });
    await waitFor(() => {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });
    expect(btn.getAttribute('title')).toBe('Superadmin only');
  });

  it('Save button disabled when admin_role is null', async () => {
    primeSupabase({ adminRole: null, flowConfig: [] });
    render(<OnboardingBuilderModule />);

    const btn = await screen.findByRole('button', { name: /save flow/i });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));
  });
});

describe('OnboardingBuilderModule — RPC behavior', () => {
  it('clicking Save calls rpc("save_consumer_onboarding_flow") with current steps', async () => {
    primeSupabase({ adminRole: 'superadmin', flowConfig: [] });
    mockRpc.mockResolvedValue({ data: 'flow-uuid', error: null });
    render(<OnboardingBuilderModule />);

    const btn = await screen.findByRole('button', { name: /save flow/i });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));

    // Add a single step via the palette.
    fireEvent.click(screen.getByLabelText('Add Text input step'));

    fireEvent.click(btn);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(mockRpc).toHaveBeenCalledWith(
      'save_consumer_onboarding_flow',
      expect.objectContaining({
        p_steps: expect.arrayContaining([expect.objectContaining({ type: 'text' })]),
      }),
    );
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Saved as new version', 'success'));
  });

  it('RPC returns 42501 → toast "Superadmin role required to save"', async () => {
    primeSupabase({ adminRole: 'superadmin', flowConfig: [] });
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'forbidden_not_superadmin' },
    });
    render(<OnboardingBuilderModule />);

    const btn = await screen.findByRole('button', { name: /save flow/i });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith('Superadmin role required to save', 'error'),
    );
  });
});

describe('OnboardingBuilderModule — palette + reordering', () => {
  it('adding a step via the palette grows the working flow with a uuid id', async () => {
    primeSupabase({ adminRole: 'superadmin', flowConfig: [] });
    render(<OnboardingBuilderModule />);

    await screen.findByRole('button', { name: /save flow/i });

    // Initially: empty-state copy.
    expect(screen.getByText(/no steps yet/i)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Add Scale step'));

    await waitFor(() => {
      expect(screen.queryByText(/no steps yet/i)).toBeNull();
    });
    // The mocked SortableTreePanel renders one row per step.
    expect(screen.getByTestId('mock-tree-row-0')).toBeTruthy();
  });

  it('SortableTreePanel reorder callback flows back to setSteps', async () => {
    primeSupabase({ adminRole: 'superadmin', flowConfig: [] });
    render(<OnboardingBuilderModule />);

    await screen.findByRole('button', { name: /save flow/i });

    fireEvent.click(screen.getByLabelText('Add Text input step'));
    fireEvent.click(screen.getByLabelText('Add NPS step'));

    await waitFor(() => {
      expect(screen.getByTestId('mock-tree-row-0')).toBeTruthy();
      expect(screen.getByTestId('mock-tree-row-1')).toBeTruthy();
    });

    // First row before reorder: text. Second: nps.
    expect(screen.getByTestId('mock-tree-row-0').textContent ?? '').toMatch(/text/i);

    fireEvent.click(screen.getByTestId('mock-reorder-trigger'));

    await waitFor(() => {
      // After reverse: first row is NPS, second is text.
      expect(screen.getByTestId('mock-tree-row-0').textContent ?? '').toMatch(/nps/i);
    });
  });
});

describe('OnboardingBuilderModule — tabs', () => {
  it('A/B and Funnel tabs render the Plan 34-09 placeholder seam', async () => {
    primeSupabase({ adminRole: 'admin', flowConfig: [] });
    render(<OnboardingBuilderModule />);
    await screen.findByRole('button', { name: /save flow/i });

    fireEvent.click(screen.getByRole('tab', { name: /a\/b/i }));
    await waitFor(() => {
      const ab = screen.getByText(/ships in Plan/i);
      expect(ab).toBeTruthy();
      expect(ab.parentElement?.getAttribute('data-tab-placeholder')).toBe('34-09');
    });

    fireEvent.click(screen.getByRole('tab', { name: /funnel/i }));
    await waitFor(() => {
      const funnel = screen.getByText(/ships in Plan/i);
      expect(funnel).toBeTruthy();
      expect(funnel.parentElement?.getAttribute('data-tab-placeholder')).toBe('34-09');
    });
  });
});

describe('OnboardingBuilderModule — initial flow load', () => {
  it('renders an existing active flow when onboarding_flows returns config[]', async () => {
    primeSupabase({
      adminRole: 'superadmin',
      flowConfig: [
        { id: 'existing-1', type: 'text', copy: { title: 'Existing step' } },
        { id: 'existing-2', type: 'nps' },
      ],
    });
    render(<OnboardingBuilderModule />);

    await screen.findByRole('button', { name: /save flow/i });

    await waitFor(() => {
      expect(screen.getByTestId('mock-tree-row-0')).toBeTruthy();
      expect(screen.getByTestId('mock-tree-row-1')).toBeTruthy();
    });
    expect(screen.queryByText(/no steps yet/i)).toBeNull();
  });
});

// Silence the unused-act warning in CI when no async work is pending.
void act;
