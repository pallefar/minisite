/**
 * Browser PostHog capture wrapper — Phase 24 D-12.
 *
 * Wraps posthog.capture() with a PHI gate:
 * - In DEV: throws Error on phi:true events (immediate developer feedback).
 * - In PROD: logs console.warn and drops the event (no data leaks).
 *
 * PHI events (events.phi.ts) are also import-blocked from client zones by the
 * ESLint `import-x/no-restricted-paths` rule in eslint.config.js.
 *
 * Note: posthog-node is the Edge-Fn-only client — NOT imported here.
 * See supabase/functions/_shared/posthog-server.ts for server-side capture.
 */
import posthog from 'posthog-js';
import { EVENTS, type EventName, type PayloadOf } from './events';

export function capture<K extends EventName>(name: K, payload: PayloadOf<K>): void {
  const def = EVENTS[name];
  if ((def as { phi: boolean }).phi === true) {
    const msg = `[analytics] PHI event "${String(name)}" cannot be captured from browser. Route through Edge Function (_shared/posthog-server.ts).`;
    if (import.meta.env.DEV) throw new Error(msg);
     
    console.warn(msg);
    return;
  }
  posthog.capture(String(name), payload as Record<string, unknown>);
}
