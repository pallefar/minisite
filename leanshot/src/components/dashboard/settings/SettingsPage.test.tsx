import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { SettingsPage } from './SettingsPage';

/**
 * Phase 4 D-03 regression: the AI section + its nav entry must be gone
 * from Settings. The proxy-based AI flow needs no per-user key, so the
 * BYO UX is fully retired. This test guards the deletion across future
 * refactors of SettingsPage (a re-add would silently break SC#1).
 */
describe('SettingsPage — Phase 4 D-03 BYO key removal', () => {
  beforeEach(() => {
    useStore.setState({
      user: {
        name: 'Test',
        medication: 'tirzepatide',
        startDate: '2026-01-01',
        startWeight: 100,
        goalWeight: 80,
        dose: 2.5,
        doseUnit: 'mg',
        units: 'metric',
        proteinTarget: 130,
        calorieTarget: 1800,
        fiberTarget: 30,
        waterTarget: 8,
        goal: 'fat-loss',
        liftingLevel: 'beginner',
        sex: 'male',
        activityLevel: 'moderate',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
  });

  it('does not render an "AI" or "AI assistant" nav entry', () => {
    render(<SettingsPage open onClose={() => {}} />);
    // The nav list lives inside the <nav aria-label="Settings sections">.
    const nav = screen.getByRole('navigation', { name: /settings sections/i });
    expect(nav.textContent ?? '').not.toMatch(/\bAI\b/);
  });

  it('does not render the "AI assistant" section heading anywhere', () => {
    render(<SettingsPage open onClose={() => {}} />);
    expect(screen.queryByText(/AI assistant/i)).toBeNull();
  });

  it('does not render an Anthropic API key input', () => {
    render(<SettingsPage open onClose={() => {}} />);
    expect(screen.queryByLabelText(/anthropic api key/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/sk-ant-/i)).toBeNull();
  });
});

/**
 * Phase 7 Plan 07-10 (D-05): Recovery section — restore from local backup.
 *
 * Phase 6 D-03 wrote `leanshot_v4_pre_cloud_backup` to localStorage with shape
 * `{state, version, snapshotAt}` before any cloud write. This plan ships the
 * consume-side: a Recovery section in Settings that gates a destructive restore
 * action behind typed confirmation + signs the user out afterwards so the next
 * sign-in resolves LWW deterministically.
 *
 * RESEARCH §6 LWW guardrail: signOut() MUST run AFTER setState — sign-out first
 * would race the persist middleware against a cleared session.
 */

// Mock auth.signOut so tests don't hit a real Supabase client.
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return {
    ...actual,
    signOut: vi.fn(async () => ({ error: null })),
  };
});

// Mock @/lib/auth-actions if such re-exports exist; the production handler
// imports `signOut` directly from '@/lib/auth' (see plan action step 1).

const MIN_USER = {
  name: 'Test',
  medication: 'tirzepatide',
  startDate: '2026-01-01',
  startWeight: 100,
  goalWeight: 80,
  dose: 2.5,
  doseUnit: 'mg',
  units: 'metric',
  proteinTarget: 130,
  calorieTarget: 1800,
  fiberTarget: 30,
  waterTarget: 8,
  goal: 'fat-loss',
  liftingLevel: 'beginner',
  sex: 'male',
  activityLevel: 'moderate',
} as const;

const SEED_BACKUP = {
  state: {
    user: { ...MIN_USER, name: 'BACKUP_SENTINEL_USER' },
    injections: [],
    weights: [],
    measurements: [],
    meals: [],
    symptoms: [],
    workouts: [],
    water: {},
    foodNoise: {},
    steps: {},
    supplements: {},
    mood: [],
    sleep: [],
    nsvs: [],
    photos: [],
    vials: [],
    aiHistory: [],
    costs: [],
  },
  version: 7,
  snapshotAt: '2026-01-15T10:30:00.000Z',
};

describe('SettingsPage — Phase 7 D-05 Recovery / restore-from-backup', () => {
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    onClose = vi.fn();
    // Seed a minimum store user so SettingsPage's early-return doesn't fire.
    useStore.setState({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      user: { ...MIN_USER } as any,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('hides the Restore button when no local backup is present', async () => {
    render(<SettingsPage open={true} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /^recovery$/i }));
    expect(screen.getByText(/no local backup found/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restore from local backup/i })).toBeNull();
  });

  it('renders the snapshot date when a backup is present', async () => {
    localStorage.setItem('leanshot_v4_pre_cloud_backup', JSON.stringify(SEED_BACKUP));
    render(<SettingsPage open={true} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /^recovery$/i }));
    // toLocaleString() in jsdom emits the year regardless of locale.
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /restore from local backup/i }),
    ).toBeInTheDocument();
  });

  it('gates the confirm button on a case-sensitive typed RESTORE', async () => {
    localStorage.setItem('leanshot_v4_pre_cloud_backup', JSON.stringify(SEED_BACKUP));
    render(<SettingsPage open={true} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /^recovery$/i }));
    await userEvent.click(screen.getByRole('button', { name: /restore from local backup/i }));
    const confirmBtn = await screen.findByRole('button', { name: /confirm restore/i });
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByLabelText(/type "?RESTORE"? to confirm/i);
    await userEvent.type(input, 'restore'); // wrong case
    expect(confirmBtn).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, 'RESTORE');
    expect(confirmBtn).toBeEnabled();
  });

  it('calls useStore.setState(backup.state, true) + signOut + onClose on confirm', async () => {
    localStorage.setItem('leanshot_v4_pre_cloud_backup', JSON.stringify(SEED_BACKUP));
    // Replace setState with a no-op spy so the real replace-call doesn't wipe
    // the store's action methods (which the post-restore toast() relies on).
    // We only need to assert the call signature here.
    const setStateSpy = vi.spyOn(useStore, 'setState').mockImplementation(() => {});
    const { signOut } = await import('@/lib/auth');
    render(<SettingsPage open={true} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /^recovery$/i }));
    await userEvent.click(screen.getByRole('button', { name: /restore from local backup/i }));
    const input = screen.getByLabelText(/type "?RESTORE"? to confirm/i);
    await userEvent.type(input, 'RESTORE');
    await userEvent.click(screen.getByRole('button', { name: /confirm restore/i }));

    await waitFor(() => {
      // The setState replace-call should land with the parsed backup.state and replace=true.
      const replaceCall = setStateSpy.mock.calls.find((call) => call[1] === true);
      expect(replaceCall).toBeDefined();
      expect(replaceCall?.[0]).toEqual(SEED_BACKUP.state);
      expect(signOut).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows the corrupted-backup empty state and never calls setState on malformed JSON', async () => {
    localStorage.setItem('leanshot_v4_pre_cloud_backup', '{not valid json');
    const setStateSpy = vi.spyOn(useStore, 'setState');
    render(<SettingsPage open={true} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /^recovery$/i }));
    expect(screen.getByText(/backup file is corrupted/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restore from local backup/i })).toBeNull();
    // setState may be called by the beforeEach seeding before the spy, so filter
    // for the replace-call signature we care about.
    const replaceCalls = setStateSpy.mock.calls.filter((call) => call[1] === true);
    expect(replaceCalls).toHaveLength(0);
  });
});
