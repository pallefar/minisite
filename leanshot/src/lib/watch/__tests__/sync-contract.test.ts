/**
 * Phase 57 Plan 57-03 — sync-contract.test.ts
 * Coverage: WATCH-03, WATCH-07
 * Run: npx vitest run --config vite.config.ts src/lib/watch/__tests__/sync-contract.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dedupeAndMerge, makeDedupedId } from '../sync-contract';
import type { WatchQueuedLog } from '../sync-contract';

// ---------------------------------------------------------------------------
// Mock @/lib/native/healthAssert — no-op so assertHealthTunnel does not
// interfere with unit tests (mirrors health.test.ts pattern).
// ---------------------------------------------------------------------------
vi.mock('@/lib/native/healthAssert', () => ({
  assertHealthTunnel: vi.fn(),
}));

// ---------------------------------------------------------------------------
// makeDedupedId — determinism + UUID-v5 shape (WATCH-07)
// ---------------------------------------------------------------------------
describe('makeDedupedId', () => {
  it('returns the same ID for identical inputs (deterministic — WATCH-07)', () => {
    const a = makeDedupedId('apple_watch', '2026-05-25T10:30:00.000Z');
    const b = makeDedupedId('apple_watch', '2026-05-25T10:30:00.000Z');
    expect(a).toBe(b);
  });

  it('returns different IDs for different datetimes', () => {
    const a = makeDedupedId('apple_watch', '2026-05-25T10:30:00.000Z');
    const b = makeDedupedId('apple_watch', '2026-05-25T11:00:00.000Z');
    expect(a).not.toBe(b);
  });

  it('returns different IDs for different sources at the same datetime', () => {
    const a = makeDedupedId('apple_watch', '2026-05-25T10:30:00.000Z');
    const b = makeDedupedId('wear_os', '2026-05-25T10:30:00.000Z');
    expect(a).not.toBe(b);
  });

  it('output matches UUID-v5 shape (8-4-4-4-12 hex)', () => {
    const id = makeDedupedId('apple_watch', '2026-05-25T10:30:00.000Z');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('version nibble is 5 (UUID-v5)', () => {
    const id = makeDedupedId('apple_watch', '2026-05-25T10:30:00.000Z');
    // Third group first character must be '5'
    const thirdGroup = id.split('-')[2];
    expect(thirdGroup[0]).toBe('5');
  });

  it('variant bits are 10xx (RFC 4122 §4.3)', () => {
    const id = makeDedupedId('apple_watch', '2026-05-25T10:30:00.000Z');
    // Fourth group first byte: bits 10xx means hex 8, 9, a, b
    const fourthGroup = id.split('-')[3];
    const firstByte = parseInt(fourthGroup.slice(0, 2), 16);
    // Must be in range 0x80-0xBF (10xx xxxx)
    expect(firstByte).toBeGreaterThanOrEqual(0x80);
    expect(firstByte).toBeLessThanOrEqual(0xbf);
  });
});

// ---------------------------------------------------------------------------
// dedupeAndMerge — idempotent merge to Injection[] (WATCH-03)
// ---------------------------------------------------------------------------
describe('dedupeAndMerge', () => {
  const userId = 'user-abc-123';
  const baseLog: WatchQueuedLog = {
    deduped_id: makeDedupedId('apple_watch', '2026-05-25T10:30:00.000Z'),
    datetime: '2026-05-25T10:30:00.000Z',
    dose: '0.5',
    unit: 'mg',
    site: 'abdomen-ul',
    source: 'apple_watch',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an Injection for a new queued log not in existingLogIds (WATCH-03)', () => {
    const result = dedupeAndMerge([baseLog], userId, new Set());
    expect(result).toHaveLength(1);
    expect(result[0].log_id).toBe(baseLog.deduped_id);
  });

  it('drops a queued log whose deduped_id is already in existingLogIds', () => {
    const existing = new Set([baseLog.deduped_id]);
    const result = dedupeAndMerge([baseLog], userId, existing);
    expect(result).toHaveLength(0);
  });

  it('drops intra-batch duplicates (same deduped_id twice yields one output)', () => {
    const result = dedupeAndMerge([baseLog, { ...baseLog }], userId, new Set());
    expect(result).toHaveLength(1);
  });

  it('output element: log_id equals deduped_id', () => {
    const [inj] = dedupeAndMerge([baseLog], userId, new Set());
    expect(inj.log_id).toBe(baseLog.deduped_id);
  });

  it('output element: user_id equals passed userId (ALWAYS the phone-stamped userId — T-57-AUTH)', () => {
    const forged: WatchQueuedLog = { ...baseLog, user_id: 'forged-user-id' };
    const [inj] = dedupeAndMerge([forged], userId, new Set());
    expect(inj.user_id).toBe(userId);
    expect(inj.user_id).not.toBe('forged-user-id');
  });

  it('ignores a forged q.user_id — output user_id is the passed userId', () => {
    const forged: WatchQueuedLog = { ...baseLog, user_id: 'attacker-id' };
    const [inj] = dedupeAndMerge([forged], userId, new Set());
    expect(inj.user_id).toBe(userId);
  });

  it('output element: pkEngineVersion is 1', () => {
    const [inj] = dedupeAndMerge([baseLog], userId, new Set());
    expect(inj.pkEngineVersion).toBe(1);
  });

  it('output element: notes says "Apple Watch" for apple_watch source', () => {
    const [inj] = dedupeAndMerge([baseLog], userId, new Set());
    expect(inj.notes).toContain('Apple Watch');
  });

  it('output element: notes says "Wear OS" for wear_os source', () => {
    const wearLog: WatchQueuedLog = {
      ...baseLog,
      deduped_id: makeDedupedId('wear_os', '2026-05-25T10:30:00.000Z'),
      source: 'wear_os',
    };
    const [inj] = dedupeAndMerge([wearLog], userId, new Set());
    expect(inj.notes).toContain('Wear OS');
  });

  it('preserves datetime, dose, unit, site from the queued log', () => {
    const [inj] = dedupeAndMerge([baseLog], userId, new Set());
    expect(inj.datetime).toBe(baseLog.datetime);
    expect(inj.dose).toBe(baseLog.dose);
    expect(inj.unit).toBe(baseLog.unit);
    expect(inj.site).toBe(baseLog.site);
  });

  it('handles empty input gracefully', () => {
    const result = dedupeAndMerge([], userId, new Set());
    expect(result).toHaveLength(0);
  });

  it('handles null site value', () => {
    const nullSiteLog: WatchQueuedLog = { ...baseLog, site: null };
    const [inj] = dedupeAndMerge([nullSiteLog], userId, new Set());
    expect(inj.site).toBeNull();
  });
});
