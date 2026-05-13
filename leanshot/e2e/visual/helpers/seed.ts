// IMPORTANT: addInitScript only — never goto/evaluate/reload (see Phase 7 RC4
// forensic seam + memory `reference_playwright_state_seeding.md`). Seeding
// localStorage via page.goto + page.evaluate + page.reload races
// supabase-js INITIAL_SESSION and silently wipes the seed at the
// localStorage layer.
//
// Shared `addInitScript` payloads for the Phase 13 visual-regression suite.
// Helpers seed the v4 persisted store + the v4 theme key BEFORE the page
// mounts, so the first paint already matches the requested surface state
// (no flash of unauth/light theme).

import type { Page } from '@playwright/test';

const STORAGE_KEY = 'leanshot_v4';
const THEME_KEY = 'leanshot_theme_v4';

// Match `STORAGE_VERSION` in src/lib/storage.ts. Persist middleware compares
// this on hydrate; mismatched version triggers `migrate` (we want a clean
// passthrough — supply the current version so persist skips migration).
const STORAGE_VERSION = 8;

export interface SeedOptions {
  /** Force the dashboard tab the user lands on (`home` by default). */
  currentTab?: 'home' | 'medication' | 'body' | 'settings';
  /** Pre-open the AI panel for AIChatPanel snapshots. The opening is a click
   *  in the spec (state lives in App.tsx useState, NOT Zustand) — this flag
   *  is here for spec authors to know they should click after waitForReady. */
  aiPanelOpen?: boolean;
  /** Pre-open the settings drawer (same useState seam as aiPanelOpen). */
  settingsOpen?: boolean;
  /** Render the AIChatPanel in its "thinking" busy state by stubbing the
   *  ai-chat Edge Function with a hanging response (returned by Page route). */
  aiThinking?: boolean;
}

interface SeedUser {
  name: string;
  units: 'metric' | 'imperial';
  medication: string;
  dose: string;
  doseUnit: 'mg' | 'units' | 'ml';
  startDate: string;
  startWeight: number;
  height: number | null;
  age: number | null;
  sex: 'male' | 'female';
  bodyFat: number | null;
  goalWeight: number;
  goal: 'fat-loss' | 'recomp' | 'health' | 'maintenance';
  proteinTarget: number;
  calorieTarget: number;
  fiberTarget: number;
  waterTarget: number;
  injectionDay: number;
  activityLevel: 'sedentary' | 'light' | 'moderate' | 'very';
  liftingLevel: 'none' | 'beginner' | 'intermediate' | 'advanced';
  createdAt: string;
}

const seedUser: SeedUser = {
  name: 'Alex',
  units: 'metric',
  medication: 'mounjaro',
  dose: '5',
  doseUnit: 'mg',
  // Fixed date so curve + history slots line up identically every CI run.
  startDate: '2025-08-01',
  startWeight: 92.4,
  height: 178,
  age: 38,
  sex: 'male',
  bodyFat: 24,
  goalWeight: 80,
  goal: 'fat-loss',
  proteinTarget: 160,
  calorieTarget: 2100,
  fiberTarget: 35,
  waterTarget: 3000,
  injectionDay: 1, // Monday
  activityLevel: 'moderate',
  liftingLevel: 'beginner',
  createdAt: '2025-08-01T09:00:00.000Z',
};

// Deterministic injection history — three weekly Monday doses spanning
// the last ~3 weeks so the chart paints curve + history slots.
const seedInjections = [
  {
    log_id: '00000000-0000-4000-8000-000000000001',
    datetime: '2025-09-22T09:00:00.000Z',
    dose: '5',
    unit: 'mg' as const,
    site: 'abdomen-ul' as const,
    notes: '',
    pkEngineVersion: 1,
  },
  {
    log_id: '00000000-0000-4000-8000-000000000002',
    datetime: '2025-09-29T09:00:00.000Z',
    dose: '5',
    unit: 'mg' as const,
    site: 'abdomen-ur' as const,
    notes: '',
    pkEngineVersion: 1,
  },
  {
    log_id: '00000000-0000-4000-8000-000000000003',
    datetime: '2025-10-06T09:00:00.000Z',
    dose: '7.5',
    unit: 'mg' as const,
    site: 'thigh-l' as const,
    notes: '',
    pkEngineVersion: 1,
  },
];

const seedWeights = [
  { date: '2025-09-22', weight: 92.4, bodyFat: 24, ts: 1758531600000 },
  { date: '2025-09-25', weight: 92.0, bodyFat: null, ts: 1758790800000 },
  { date: '2025-09-29', weight: 91.6, bodyFat: null, ts: 1759136400000 },
  { date: '2025-10-02', weight: 91.2, bodyFat: 23.5, ts: 1759395600000 },
  { date: '2025-10-06', weight: 90.8, bodyFat: null, ts: 1759741200000 },
];

function buildPersistedState(opts: SeedOptions, includeUser: boolean) {
  return {
    user: includeUser ? seedUser : null,
    injections: includeUser ? seedInjections : [],
    symptoms: [],
    weights: includeUser ? seedWeights : [],
    measurements: [],
    meals: [],
    water: {},
    foodNoise: {},
    workouts: [],
    steps: {},
    supplements: {},
    mood: [],
    sleep: [],
    nsvs: [],
    // Body tab: empty photos so the empty-state illustration renders.
    photos: [],
    vials: [],
    aiHistory: [],
    costs: [],
    acknowledgedDisclaimer: 'v1',
    pendingOps: [],
    migration_state: null,
  };
}

function persistEnvelope(
  state: ReturnType<typeof buildPersistedState>,
  currentTab: SeedOptions['currentTab'],
) {
  // Zustand persist envelope shape — state + version. The actual
  // persisted slice is the `partialize`d subset (UI-only fields like
  // `currentTab` are NOT persisted; we set currentTab via a separate
  // sessionStorage seam below since the store hydrates `currentTab:
  // 'home'` by default).
  void currentTab;
  return JSON.stringify({ state, version: STORAGE_VERSION });
}

/**
 * Seed an UNAUTH (marketing / login) state. Clears all v4 keys before mount.
 * Use for landing-light, landing-dark, auth-login-light.
 */
export async function seedUnauth(page: Page): Promise<void> {
  const envelope = persistEnvelope(buildPersistedState({}, false), 'home');
  await page.addInitScript(
    ({ storageKey, themeKey, env }) => {
      try {
        // Wipe any namespaced leanshot_v4:<hash> keys from previous runs.
        const toDelete: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('leanshot_v4')) toDelete.push(k);
        }
        toDelete.forEach((k) => localStorage.removeItem(k));
        localStorage.removeItem('leanshot_anthropic_key');
        localStorage.setItem(storageKey, env);
        localStorage.setItem(themeKey, 'light');
      } catch {
        /* noop — private-mode browsers */
      }
    },
    { storageKey: STORAGE_KEY, themeKey: THEME_KEY, env: envelope },
  );
}

/**
 * Seed a fully-onboarded user with deterministic data.
 * Use for home / medication / body / settings / ai-chat snapshots.
 */
export async function seedOnboarded(page: Page, opts: SeedOptions = {}): Promise<void> {
  const state = buildPersistedState(opts, true);
  const envelope = persistEnvelope(state, opts.currentTab ?? 'home');
  const targetTab = opts.currentTab ?? 'home';
  await page.addInitScript(
    ({ storageKey, themeKey, env, tab }) => {
      try {
        const toDelete: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('leanshot_v4')) toDelete.push(k);
        }
        toDelete.forEach((k) => localStorage.removeItem(k));
        localStorage.setItem(storageKey, env);
        localStorage.setItem(themeKey, 'light');
        // Stash the target tab so a Zustand subscriber inside the app
        // (or a small inline reader) can `setTab` post-mount. We do NOT
        // poke into the store directly here — persist would overwrite.
        sessionStorage.setItem('__vr_target_tab__', tab);
      } catch {
        /* noop */
      }
    },
    { storageKey: STORAGE_KEY, themeKey: THEME_KEY, env: envelope, tab: targetTab },
  );
}

/**
 * Seed the dark theme alongside any other seed call. Writes BOTH the
 * pre-paint key (`leanshot_theme_v4`) and the `data-theme` attribute
 * on `<html>` so the very first paint already shows the dark palette.
 */
export async function seedThemeDark(page: Page): Promise<void> {
  await page.addInitScript(({ themeKey }) => {
    try {
      localStorage.setItem(themeKey, 'dark');
    } catch {
      /* noop */
    }
    // Apply data-theme synchronously so the pre-mount paint is correct.
    try {
      document.documentElement.setAttribute('data-theme', 'dark');
    } catch {
      /* noop */
    }
  }, { themeKey: THEME_KEY });
}

/**
 * Seed a partial onboarding state so the OnboardingFlow renders on its
 * FINAL summary step. The OnboardingFlow component holds `step` in local
 * React state (see src/components/onboarding/OnboardingFlow.tsx) — there
 * is no Zustand seam for it — so this helper just clears any persisted
 * `user` (so the App view selector lands on `'onboarding'`) and then the
 * spec drives step navigation via the Next button. For a deterministic
 * snapshot we click through to step 7 (the final OnboardReady screen).
 */
export async function seedOnboardingFinal(page: Page): Promise<void> {
  await seedUnauth(page);
}

/**
 * Stub the ai-chat Edge Function with a never-resolving fetch so the
 * AIChatPanel `busy=true` branch (AIAvatar pulse + thinking dots)
 * renders deterministically. Combine with `reducedMotion: 'reduce'`
 * to freeze the pulse animation at its static frame.
 */
export async function stubAiThinking(page: Page): Promise<void> {
  // Match any path containing /ai-chat (Edge Function URL). Hold the
  // response open so the panel sits in the thinking state forever.
  await page.route(/\/functions\/v1\/ai-chat/, () => {
    // Never call route.fulfill — the request hangs until test end.
  });
  // Also block direct anthropic.com calls in case the legacy path is hit.
  await page.route(/api\.anthropic\.com/, () => {
    // Hang.
  });
}

/**
 * Wait for fonts + network idle + a stable paint signal. Used by every
 * spec before `toHaveScreenshot` so font subpixel rendering + Chart.js
 * canvas paint settle before the diff is taken.
 */
export async function waitForReady(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  });
  // Extra rAF tick so framer-motion's first layout effect has flushed.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/**
 * Switch tabs by clicking the sidebar / mobile-nav button matching
 * the tab name. The dashboard mounts on `home` by default; specs that
 * want medication/body/settings call this after `waitForReady`.
 */
export async function gotoTab(
  page: Page,
  tab: 'home' | 'medication' | 'body',
): Promise<void> {
  // Sidebar nav buttons use `aria-label="<TabName>"` (see Sidebar.tsx TABS table:
  // home→'Today', medication→'Medication', body→'Body').
  const label = tab === 'home' ? 'Today' : tab === 'medication' ? 'Medication' : 'Body';
  await page.getByRole('button', { name: label }).first().click();
  await waitForReady(page);
}
