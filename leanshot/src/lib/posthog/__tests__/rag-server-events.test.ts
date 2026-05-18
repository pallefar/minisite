/**
 * Tests for captureRagEvent (Phase 50 Plan 50-03 Task 3).
 *
 * Test scope is the same as the future Deno-runtime port — we exercise:
 * - capture() is called with the correct event name + cleaned properties
 * - shutdown() is awaited even when capture() throws (try/finally)
 * - PHI scrub removes user_id + patient_id but preserves all other keys
 * - Empty distinctId throws before factory() is invoked
 */
import { describe, it, expect, vi } from 'vitest';
import {
  type PostHogClientLike,
  captureRagEvent,
  scrubPhi,
} from '../posthog-server';

function makeMockClient(): {
  client: PostHogClientLike;
  capture: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
} {
  const capture = vi.fn();
  const shutdown = vi.fn().mockResolvedValue(undefined);
  return {
    capture,
    shutdown,
    client: {
      capture: (payload) => capture(payload),
      shutdown: () => shutdown(),
    },
  };
}

describe('scrubPhi — defensive PHI strip', () => {
  it('strips user_id', () => {
    expect(scrubPhi({ user_id: 'x', chunk_id: 'c1' })).toEqual({ chunk_id: 'c1' });
  });

  it('strips patient_id', () => {
    expect(scrubPhi({ patient_id: 'p', chunk_id: 'c1' })).toEqual({ chunk_id: 'c1' });
  });

  it('preserves all non-PHI keys', () => {
    const input = {
      chunk_id: 'c1',
      topic_tag: 'glp-1',
      surface: 'tip-of-day',
      cost_usd: 0.0123,
      nested: { foo: 'bar' },
    };
    expect(scrubPhi(input)).toEqual(input);
  });

  it('returns empty object for input with only PHI keys', () => {
    expect(scrubPhi({ user_id: 'x', patient_id: 'p' })).toEqual({});
  });

  it('does not mutate the input object', () => {
    const input = { user_id: 'x', chunk_id: 'c1' };
    const result = scrubPhi(input);
    expect(input).toEqual({ user_id: 'x', chunk_id: 'c1' });
    expect(result).not.toBe(input);
  });
});

describe('captureRagEvent', () => {
  it('calls posthog capture and awaits shutdown', async () => {
    const { client, capture, shutdown } = makeMockClient();
    await captureRagEvent(
      'user-uuid-123',
      'rag_tip_impression',
      { chunk_id: 'c1', topic_tag: 'glp-1', surface: 'tip-of-day' },
      () => client,
    );
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith({
      distinctId: 'user-uuid-123',
      event: 'rag_tip_impression',
      properties: { chunk_id: 'c1', topic_tag: 'glp-1', surface: 'tip-of-day' },
    });
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('strips user_id from properties before capture', async () => {
    const { client, capture } = makeMockClient();
    await captureRagEvent(
      'user-uuid-123',
      'rag_citation_clicked',
      {
        user_id: 'leaked-uuid',
        chunk_id: 'c1',
        source_tier: 'A',
        topic_tag: 'glp-1',
        surface: 'coach',
      },
      () => client,
    );
    const callArgs = capture.mock.calls[0][0];
    expect(callArgs.properties).not.toHaveProperty('user_id');
    expect(callArgs.properties).toEqual({
      chunk_id: 'c1',
      source_tier: 'A',
      topic_tag: 'glp-1',
      surface: 'coach',
    });
  });

  it('strips patient_id from properties before capture', async () => {
    const { client, capture } = makeMockClient();
    await captureRagEvent(
      'user-uuid-123',
      'rag_hub_pageview',
      { patient_id: 'p-leaked', chunk_id: 'c1' },
      () => client,
    );
    expect(capture.mock.calls[0][0].properties).not.toHaveProperty('patient_id');
    expect(capture.mock.calls[0][0].properties).toEqual({ chunk_id: 'c1' });
  });

  it('throws on empty distinctId (empty string)', async () => {
    const { client } = makeMockClient();
    await expect(
      captureRagEvent('', 'rag_tip_impression', { chunk_id: 'c1' }, () => client),
    ).rejects.toThrow(/distinctId is required/);
  });

  it('throws on whitespace-only distinctId', async () => {
    const { client } = makeMockClient();
    await expect(
      captureRagEvent('   ', 'rag_tip_impression', { chunk_id: 'c1' }, () => client),
    ).rejects.toThrow(/distinctId is required/);
  });

  it('does NOT invoke factory when distinctId is empty (fail fast)', async () => {
    const factory = vi.fn();
    await expect(
      captureRagEvent('', 'rag_tip_impression', {}, factory),
    ).rejects.toThrow();
    expect(factory).not.toHaveBeenCalled();
  });

  it('awaits shutdown even when capture throws (try/finally)', async () => {
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const failingClient: PostHogClientLike = {
      capture: () => {
        throw new Error('posthog network down');
      },
      shutdown: () => shutdown(),
    };
    await expect(
      captureRagEvent('user-uuid', 'rag_scrape_run', { topic_id: 't1' }, () => failingClient),
    ).rejects.toThrow('posthog network down');
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('supports all 6 server-side event names (compile-time check)', async () => {
    const { client, capture } = makeMockClient();
    const names = [
      'rag_tip_impression',
      'rag_tip_clicked',
      'rag_citation_clicked',
      'rag_hub_pageview',
      'rag_scrape_run',
      'rag_chunk_published',
    ] as const;
    for (const name of names) {
      await captureRagEvent('user-uuid', name, { chunk_id: 'c1' }, () => client);
    }
    expect(capture).toHaveBeenCalledTimes(names.length);
  });
});
