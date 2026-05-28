// DO NOT import from src/lib/native/health.ts or any ad-eligible surface —
// enforced by ESLint no-health-in-ad-context rule (Layer 1) and
// scripts/check-no-health-in-ad-context.sh (Layer 3, extended in WATCH-08).
// assertHealthTunnel('watchSyncContract') is called here for Layer 2 tracing.
import { assertHealthTunnel } from '@/lib/native/healthAssert';
import type { DoseUnit, Injection, InjectionSite } from '@/types';

/**
 * Phase 57 Plan 57-03 — Watch sync contract (WATCH-03, WATCH-07, WATCH-08).
 *
 * Offline-queue payload emitted by the native watch app (Apple Watch or Wear OS)
 * and consumed by the phone-side dedupeAndMerge function. The watch emits this
 * shape via WatchConnectivity (iOS) or DataClient (Android); the phone validates
 * and stamps the real user_id before writing to Supabase.
 *
 * Trust boundary: fields from the watch (a lower-trust surface) are type-checked
 * but NOT trusted for identity. user_id is ALWAYS stamped from the authenticated
 * phone session (T-57-AUTH). See dedupeAndMerge below.
 */
export interface WatchQueuedLog {
  /** Deterministic UUID-v5-shaped dedupe ID from makeDedupedId(source, datetime). */
  deduped_id: string;
  /** ISO 8601 timestamp of the injection. */
  datetime: string;
  /** Dose amount as a string (matches Injection.dose). */
  dose: string;
  /** Dose unit. */
  unit: DoseUnit;
  /** Injection site, or null if user skipped. */
  site: InjectionSite | null;
  /** Watch platform that originated the log. */
  source: 'apple_watch' | 'wear_os';
  /**
   * Optional user_id from the watch — if present, MUST be IGNORED.
   * The phone stamps the real user_id from the authenticated session (T-57-AUTH).
   * Accepting the watch-side user_id would allow a spoofed watch to write
   * injections under a different account.
   */
  user_id?: string;
}

/**
 * makeDedupedId — deterministic UUID-v5-shaped ID for a watch-logged injection.
 *
 * Algorithm: verbatim port of healthSampleId from src/lib/native/health.ts
 * (lines 71-107). Only the input string composition changes:
 *   health.ts:  `${userId}:${date}:${metric}:${sourceId}`
 *   watch:      `${source}:${datetime}`
 *
 * The output rides the public.injections composite primary key (user_id, log_id),
 * making repeated writes idempotent (T-57-REPLAY). No migration required.
 *
 * NOTE: Not RFC 4122 v5 compliant (XOR-based, not SHA-1) — see the comment
 * in health.ts:60-70 for the full collision-profile caveat.
 *
 * @param source  - 'apple_watch' or 'wear_os'
 * @param datetime - ISO 8601 timestamp of the injection
 * @returns Deterministic UUID-v5-shaped string
 */
export function makeDedupedId(source: string, datetime: string): string {
  assertHealthTunnel('watchSyncContract');
  // Deterministic UUID-v5 (RFC 4122) — DNS namespace: 6ba7b810-9dad-11d1-80b4-00c04fd430c8
  // XOR-based Fowler-Noll-Vo hash to keep this synchronous and dependency-free.
  const input = `${source}:${datetime}`;
  const bytes = new Uint8Array(16);
  // DNS namespace bytes
  const ns = [
    0x6b, 0xa7, 0xb8, 0x10, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8,
  ];
  // Seed bytes with namespace
  for (let i = 0; i < 16; i++) bytes[i] = ns[i];
  // XOR with UTF-16 encoded input bytes
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    bytes[i % 16] ^= code & 0xff;
    bytes[(i + 1) % 16] ^= (code >> 8) & 0xff;
    // Mix step: rotate + XOR
    const carry = bytes[(i + 2) % 16];
    bytes[(i + 2) % 16] = ((carry << 3) | (carry >> 5)) ^ bytes[i % 16];
  }
  // Apply v5 variant bits (RFC 4122 §4.3)
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version = 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant = 10xx

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * dedupeAndMerge — filter + transform queued watch logs into phone-stamped Injection[].
 *
 * Trust boundary enforcement (T-57-AUTH):
 *   user_id is ALWAYS stamped from the passed `userId` (authenticated phone session).
 *   Any user_id present on the watch-side WatchQueuedLog is silently ignored.
 *
 * Idempotency (T-57-REPLAY):
 *   Entries whose deduped_id is in existingLogIds are dropped. Intra-batch
 *   duplicates (same deduped_id appearing twice) are also deduplicated.
 *   The resulting Injection[] can be safely upserted — the (user_id, log_id)
 *   primary key on public.injections handles server-side idempotency.
 *
 * @param queued         - Array of queued logs from the watch.
 * @param userId         - Authenticated phone-session user ID (MUST be used for user_id).
 * @param existingLogIds - Set of log_ids already known on the phone; matching entries are dropped.
 * @returns Injection[] ready for the offline write queue or direct Supabase upsert.
 */
export function dedupeAndMerge(
  queued: WatchQueuedLog[],
  userId: string,
  existingLogIds: Set<string>,
): Injection[] {
  assertHealthTunnel('watchSyncContract');
  const seen = new Set<string>();
  const result: Injection[] = [];

  for (const q of queued) {
    // Drop if already persisted (server-side or local)
    if (existingLogIds.has(q.deduped_id)) continue;
    // Drop intra-batch duplicates
    if (seen.has(q.deduped_id)) continue;
    seen.add(q.deduped_id);

    const inj: Injection = {
      log_id: q.deduped_id,
      datetime: q.datetime,
      dose: q.dose,
      unit: q.unit,
      site: q.site,
      notes: `Logged from ${q.source === 'apple_watch' ? 'Apple Watch' : 'Wear OS'}`,
      pkEngineVersion: 1,
      updated_at: new Date().toISOString(),
      // T-57-AUTH: ALWAYS stamp phone-side userId. Never read from q.user_id.
      user_id: userId,
    };
    result.push(inj);
  }

  return result;
}
