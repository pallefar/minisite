/**
 * Phase 42 Plan 04 (D-16, Pitfall 2) — branded deferred install prompt
 * state machine.
 *
 * States:
 *   - 'fresh'     — no user action yet; eligible to show after engagement
 *                   signal (3rd dashboard visit AND beforeinstallprompt fired).
 *   - 'snoozed'   — user picked "Maybe later"; re-show after 30 days.
 *   - 'dismissed' — user picked "No thanks" in the branded card (90 days; not
 *                   used in Wave 1 UI but reserved for future refinement).
 *   - 'installed' — system reports `appinstalled` event OR matchMedia
 *                   '(display-mode: standalone)' matches.
 *
 * Per Pitfall 2: never write installed=true on "Maybe later". `beforeinstallprompt`
 * fires once per page-load; we capture the event so the InstallPromptCard's
 * Install button can call `event.prompt()` later in the lifecycle.
 *
 * Storage key namespace: `leanshot_install_state_v1` (per project namespacing
 * convention — see reference_minisite_monorepo_layout).
 *
 * TEST HOOK — leanshot e2e/pwa-install-prompt.spec.ts: Chromium may not allow
 * Playwright to synthesize a "real" beforeinstallprompt event with the
 * underlying BeforeInstallPromptEvent type. This module accepts a debug
 * injection via `window.__leanshot_simulate_install_prompt` that the e2e test
 * sets to a stub object; when present, `shouldShowCard()` treats it as having
 * captured a beforeinstallprompt. Per memory
 * reference_playwright_conditional_project_argv: env-var / runtime hook, NOT
 * argv-sniffing.
 */

const STATE_KEY = 'leanshot_install_state_v1';
const VISIT_KEY = 'leanshot_dashboard_visit_count_v1';
const SNOOZE_DAYS = 30;
const SNOOZE_MS = SNOOZE_DAYS * 24 * 60 * 60 * 1000;

export type InstallPromptStateName = 'fresh' | 'snoozed' | 'dismissed' | 'installed';

export interface InstallPromptState {
  state: InstallPromptStateName;
  /** ISO-8601 timestamp. Present only when state === 'snoozed'. */
  snoozed_until?: string;
  /** ISO-8601 timestamp of the last state transition. */
  last_event_at: string;
}

/**
 * Minimal shape we need from `BeforeInstallPromptEvent` — typed locally because
 * lib.dom.d.ts in TS 5.6 does not include it (it's a Chromium-only spec
 * extension).
 */
export interface BeforeInstallPromptEventLike extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Module-level captured event + listener install flag.
let capturedPromptEvent: BeforeInstallPromptEventLike | null = null;
let listenersInstalled = false;

function nowISO(): string {
  return new Date().toISOString();
}

function readState(): InstallPromptState {
  if (typeof window === 'undefined') {
    return { state: 'fresh', last_event_at: nowISO() };
  }
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (!raw) return { state: 'fresh', last_event_at: nowISO() };
    const parsed = JSON.parse(raw) as Partial<InstallPromptState>;
    const validStates: InstallPromptStateName[] = ['fresh', 'snoozed', 'dismissed', 'installed'];
    if (!parsed.state || !validStates.includes(parsed.state)) {
      return { state: 'fresh', last_event_at: nowISO() };
    }
    return {
      state: parsed.state,
      snoozed_until: parsed.snoozed_until,
      last_event_at: parsed.last_event_at ?? nowISO(),
    };
  } catch {
    return { state: 'fresh', last_event_at: nowISO() };
  }
}

function writeState(next: InstallPromptState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be unavailable in private mode; fail-soft.
  }
}

/** Read the current state (snapshot). */
export function getInstallPromptState(): InstallPromptState {
  return readState();
}

/** Read the dashboard visit count. */
export function getDashboardVisitCount(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(VISIT_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Increment the dashboard-visit counter. Call from HomeTab mount. */
export function recordDashboardVisit(): void {
  if (typeof window === 'undefined') return;
  try {
    const next = getDashboardVisitCount() + 1;
    window.localStorage.setItem(VISIT_KEY, String(next));
  } catch {
    // fail-soft
  }
}

/**
 * Whether to render the branded InstallPromptCard right now.
 * Gate: visits >= 3 AND beforeinstallprompt captured (or e2e test hook present)
 * AND state not installed/dismissed AND (not snoozed OR snooze expired).
 */
export function shouldShowCard(): boolean {
  if (typeof window === 'undefined') return false;
  const visits = getDashboardVisitCount();
  if (visits < 3) return false;

  const state = readState();
  if (state.state === 'installed' || state.state === 'dismissed') return false;
  if (state.state === 'snoozed' && state.snoozed_until) {
    if (Date.now() < new Date(state.snoozed_until).getTime()) return false;
  }

  // Need either a real captured event or the e2e debug hook.
  const w = window as unknown as { __leanshot_simulate_install_prompt?: unknown };
  if (capturedPromptEvent || w.__leanshot_simulate_install_prompt) return true;

  return false;
}

/** Trigger the captured browser prompt (or the e2e stub if present). */
export async function triggerInstallPrompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (typeof window === 'undefined') return 'unavailable';
  const w = window as unknown as {
    __leanshot_simulate_install_prompt?: { prompt?: () => Promise<void>; outcome?: string };
  };
  const target = (capturedPromptEvent ??
    (w.__leanshot_simulate_install_prompt as BeforeInstallPromptEventLike | undefined)) as
    | BeforeInstallPromptEventLike
    | undefined;
  if (!target) return 'unavailable';
  try {
    await target.prompt?.();
    const choice = await target.userChoice;
    capturedPromptEvent = null;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'dismissed';
  }
}

/**
 * "Maybe later" — set snoozed_until = now + 30 days. Per Pitfall 2:
 * REJECT this transition if the app is already installed (no downgrade).
 */
export function maybeLater(): void {
  const current = readState();
  if (current.state === 'installed') return;
  const snoozed_until = new Date(Date.now() + SNOOZE_MS).toISOString();
  writeState({ state: 'snoozed', snoozed_until, last_event_at: nowISO() });
}

/** User explicitly dismisses the branded card (longer suppression). */
export function dismiss(): void {
  const current = readState();
  if (current.state === 'installed') return;
  writeState({ state: 'dismissed', last_event_at: nowISO() });
}

/** Mark as installed. Called by the appinstalled / matchMedia listeners. */
function markInstalled(): void {
  writeState({ state: 'installed', last_event_at: nowISO() });
}

/**
 * Install the browser-event listeners that drive state transitions.
 * Idempotent (multiple calls install once). Called from App.tsx useEffect.
 *
 * NOTE: this is split from import-time so the test suite can re-init state
 * per `beforeEach`. The export name avoids the common `init()` clash.
 */
export function initializeInstallPromptModule(): void {
  if (typeof window === 'undefined') return;
  if (listenersInstalled) return;
  listenersInstalled = true;

  // Capture beforeinstallprompt so we can call event.prompt() later from the
  // InstallPromptCard's Install button.
  window.addEventListener('beforeinstallprompt', (event) => {
    // Per Chromium spec, calling preventDefault() suppresses the default
    // browser mini-info bar so we can render our branded card instead.
    (event as Event & { preventDefault?: () => void }).preventDefault?.();
    capturedPromptEvent = event as BeforeInstallPromptEventLike;
  });

  // appinstalled fires when the user completes install via any path
  // (our prompt, the omnibox menu, the OS settings). Per Pitfall 2 this
  // is the ONLY event that should set state='installed'.
  window.addEventListener('appinstalled', () => {
    markInstalled();
  });

  // If the app is already running in standalone display mode, treat as
  // installed (e.g. user re-opens after install across browser sessions).
  // Pitfall 2: only set installed when matchMedia actually matches.
  try {
    const mql = window.matchMedia('(display-mode: standalone)');
    if (mql.matches) {
      markInstalled();
    }
    // Listen for runtime transitions too (rare but possible).
    mql.addEventListener?.('change', (e: MediaQueryListEvent) => {
      if (e.matches) markInstalled();
    });
  } catch {
    // jsdom or older browser without matchMedia → ignore.
  }
}

/** Test-only reset for vitest `beforeEach` blocks. */
export function __resetForTests(): void {
  capturedPromptEvent = null;
  listenersInstalled = false;
}
