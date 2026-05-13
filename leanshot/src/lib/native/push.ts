// Phase 12 D-01 stub — push notification bridge. Real implementation lands in Phase 17 (PUSH-01..05).
// DO NOT import from ./health — enforced by import-x/no-restricted-paths in eslint.config.js.

export type PushChannel = 'apns' | 'fcm' | 'web-push';

export function registerForPush(): never {
  throw new Error('Phase 12 stub — implemented by Phase 17 (PUSH-01..05)');
}
