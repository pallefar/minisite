import type { ErrorEvent } from '@sentry/react';
import { describe, expect, it } from 'vitest';
import { beforeSend, REDACT_KEYS } from './sentry';

function makeEvent(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    type: undefined,
    ...overrides,
  } as ErrorEvent;
}

describe('beforeSend', () => {
  it('exports REDACT_KEYS containing symptom/mood/note/aiHistory (D-10)', () => {
    expect(REDACT_KEYS.has('symptom')).toBe(true);
    expect(REDACT_KEYS.has('mood')).toBe(true);
    expect(REDACT_KEYS.has('note')).toBe(true);
    expect(REDACT_KEYS.has('aiHistory')).toBe(true);
    expect(REDACT_KEYS.size).toBe(4);
  });

  it('redacts top-level matching key in event.extra', () => {
    const event = makeEvent({ extra: { symptom: 'fatigue', feature: 'home' } });
    const out = beforeSend(event);
    expect(out.extra?.symptom).toBe('[Redacted]');
    expect(out.extra?.feature).toBe('home');
  });

  it('redacts nested matching keys (3 levels deep)', () => {
    const event = makeEvent({
      extra: { user: { profile: { mood: 'sad', name: 'Alex' } } },
    });
    const out = beforeSend(event);
    const profile = (out.extra?.user as { profile: { mood: string; name: string } }).profile;
    expect(profile.mood).toBe('[Redacted]');
    expect(profile.name).toBe('Alex');
  });

  it('redacts every matching key in an array of objects', () => {
    const event = makeEvent({
      extra: { aiHistory: [{ aiHistory: 'a' }, { aiHistory: 'b' }] },
    });
    const out = beforeSend(event);
    // Outer key matches REDACT_KEYS so outer value becomes [Redacted] string
    expect(out.extra?.aiHistory).toBe('[Redacted]');
  });

  it('redacts non-aiHistory keys inside arrays of objects', () => {
    const event = makeEvent({
      extra: {
        items: [
          { symptom: 'a', other: 'b' },
          { symptom: 'c', other: 'd' },
        ],
      },
    });
    const out = beforeSend(event);
    const items = out.extra?.items as Array<{ symptom: string; other: string }>;
    expect(items[0].symptom).toBe('[Redacted]');
    expect(items[0].other).toBe('b');
    expect(items[1].symptom).toBe('[Redacted]');
    expect(items[1].other).toBe('d');
  });

  it('redacts JSON-stringified breadcrumb body content', () => {
    const event = makeEvent({
      breadcrumbs: [
        {
          category: 'fetch',
          data: { body: '{"symptom":"X","keep":"Y"}' },
        },
      ],
    });
    const out = beforeSend(event);
    const body = (out.breadcrumbs?.[0].data as { body: string }).body;
    expect(body).toContain('[Redacted]');
    expect(body).toContain('Y');
  });

  it('does NOT touch event.message or event.exception', () => {
    const event = makeEvent({
      message: 'Synthetic error: symptom unavailable',
      exception: {
        values: [
          {
            type: 'Error',
            value: 'symptom unavailable',
            stacktrace: { frames: [{ filename: 'foo.ts', lineno: 10 }] },
          },
        ],
      },
    });
    const out = beforeSend(event);
    expect(out.message).toBe('Synthetic error: symptom unavailable');
    expect(out.exception?.values?.[0].stacktrace?.frames?.[0].filename).toBe('foo.ts');
    expect(out.exception?.values?.[0].stacktrace?.frames?.[0].lineno).toBe(10);
  });

  it('returns the event (NOT undefined) per Pitfall 3', () => {
    const event = makeEvent({ extra: {} });
    const out = beforeSend(event);
    expect(out).toBeDefined();
    expect(out).toBe(event);
  });

  it('handles null/undefined event.extra without crashing', () => {
    const event = makeEvent({});
    expect(() => beforeSend(event)).not.toThrow();
  });
});
