/**
 * Gamification deferred-load helper (Phase 35 Plan 35-06 D-claude-discretion).
 *
 * Mirrors leanshot/src/lib/sync-defer.ts (Phase 6 D-12 idle-deferred-init pattern):
 *   - Pre-init: callers push GamificationCall entries into a FIFO buffer (cap 16;
 *     oldest dropped on overflow).
 *   - On load: dynamic-import canvas-confetti, then drain the buffer.
 *   - Post-init: subsequent calls bypass the buffer and dispatch directly.
 *
 * THREAT MITIGATIONS:
 *   T-35-06-01 (DoS / confetti spam): 60s cooldown via localStorage `leanshot_confetti_cooldown_until`.
 *   T-35-06-02 (a11y): React-level useReducedMotion gate is defense-in-depth #1 (in ConfettiBurst);
 *     canvas-confetti `disableForReducedMotion: true` is defense-in-depth #2 (library-level gate, here).
 *   T-35-06-03 (entry-chunk bloat): type-only import of canvas-confetti; dynamic import inside
 *     loadGamification() keeps canvas-confetti OUT of the entry chunk.
 *   T-35-06-06 (hardcoded colors): brand colors read via getComputedStyle(--color-primary),
 *     never hardcoded hex.
 *
 * Type-only import of canvas-confetti is mandatory: a value import here defeats the deferral
 * (mirrors the sync-defer.ts type-only @supabase/supabase-js pattern).
 */
import type confettiType from 'canvas-confetti';

type GamificationCall =
  | { kind: 'levelUpBurst'; level: number }
  | { kind: 'challengeCompleteBurst'; rewardKind: 'xp' | 'badge' | 'freeze' | 'combo' };

const BUFFER_CAP = 16;
const buffer: GamificationCall[] = [];

const COOLDOWN_KEY = 'leanshot_confetti_cooldown_until';
const COOLDOWN_MS = 60_000; // Pitfall 11 + D-claude-discretion: 1 burst per 60s anti-spam

let loadedConfetti: typeof confettiType | null = null;
let loadingPromise: Promise<typeof confettiType | null> | null = null;

async function loadGamification(): Promise<typeof confettiType | null> {
  if (loadedConfetti) return loadedConfetti;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      const mod = await import('canvas-confetti');
      loadedConfetti = mod.default;
      return loadedConfetti;
    } catch (e) {
      console.error('[gamification-defer] failed to load canvas-confetti', e);
      return null;
    }
  })();
  return loadingPromise;
}

function isOnCooldown(): boolean {
  try {
    const until = Number(localStorage.getItem(COOLDOWN_KEY) ?? 0);
    return Date.now() < until;
  } catch {
    return false;
  }
}

function setCooldown(): void {
  try {
    localStorage.setItem(COOLDOWN_KEY, String(Date.now() + COOLDOWN_MS));
  } catch {
    // silent — private-mode browsers don't support localStorage
  }
}

function fireBurst(confetti: typeof confettiType, _call: GamificationCall): void {
  try {
    // Brand colors via CSS variables — NEVER hardcoded (CLAUDE.md anti-pattern + T-35-06-06)
    const root = document.documentElement;
    const primary = getComputedStyle(root).getPropertyValue('--color-primary').trim() || '#22c55e';
    const accent = getComputedStyle(root).getPropertyValue('--color-accent').trim() || '#f59e0b';
    confetti({
      particleCount: 80,
      spread: 60,
      origin: { y: 0.6 },
      colors: [primary, accent],
      disableForReducedMotion: true, // defense-in-depth #2 (library-level gate — T-35-06-02)
    });
  } catch (e) {
    console.error('[gamification-defer] burst failed', e);
  }
}

function dispatch(confetti: typeof confettiType, call: GamificationCall): void {
  // Caller MUST have already verified !reducedMotion at React level (defense-in-depth #1 in ConfettiBurst)
  if (isOnCooldown()) return; // T-35-06-01: 60s anti-spam
  setCooldown();
  fireBurst(confetti, call);
}

function drainBuffer(confetti: typeof confettiType): void {
  while (buffer.length > 0) {
    const next = buffer.shift();
    if (next) dispatch(confetti, next);
  }
}

/**
 * Fire a level-up confetti burst (defense-in-depth #1 check is the caller's responsibility).
 * Lazy-loads canvas-confetti on first invocation.
 */
export function fireLevelUpBurst(level: number): void {
  const call: GamificationCall = { kind: 'levelUpBurst', level };
  if (loadedConfetti) {
    dispatch(loadedConfetti, call);
    return;
  }
  if (buffer.length >= BUFFER_CAP) buffer.shift();
  buffer.push(call);
  void loadGamification().then((confetti) => {
    if (!confetti) return;
    drainBuffer(confetti);
  });
}

/**
 * Fire a challenge-complete confetti burst.
 * Lazy-loads canvas-confetti on first invocation.
 */
export function fireChallengeCompleteBurst(rewardKind: 'xp' | 'badge' | 'freeze' | 'combo'): void {
  const call: GamificationCall = { kind: 'challengeCompleteBurst', rewardKind };
  if (loadedConfetti) {
    dispatch(loadedConfetti, call);
    return;
  }
  if (buffer.length >= BUFFER_CAP) buffer.shift();
  buffer.push(call);
  void loadGamification().then((confetti) => {
    if (!confetti) return;
    drainBuffer(confetti);
  });
}

/** Test-only reset hook. */
export function _resetForTests(): void {
  buffer.length = 0;
  loadedConfetti = null;
  loadingPromise = null;
}
