/**
 * Sentry beforeSend scrubber: redacts symptom/mood/note/aiHistory values
 * (D-10) while preserving event structure, stack frames, and error metadata
 * (D-09). Walks nested objects, arrays, and JSON-stringified breadcrumb bodies.
 *
 * Errors-only — no Replay, Tracing, or Profiling integrations (D-11).
 */

import type { ErrorEvent } from '@sentry/react';

export const REDACT_KEYS = new Set(['symptom', 'mood', 'note', 'aiHistory']);

function walkAndRedact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = redactValue(key, value);
  }
  return out;
}

function redactValue(key: string, value: unknown): unknown {
  if (REDACT_KEYS.has(key)) return '[Redacted]';
  if (typeof value === 'string') {
    // Detect JSON-stringified breadcrumb bodies (D-09)
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null) {
        const walked = Array.isArray(parsed)
          ? (parsed as Array<Record<string, unknown>>).map((item) =>
              typeof item === 'object' && item !== null
                ? walkAndRedact(item as Record<string, unknown>)
                : item,
            )
          : walkAndRedact(parsed as Record<string, unknown>);
        return JSON.stringify(walked);
      }
    } catch {
      // Not JSON — return as-is
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === 'object' && item !== null
        ? walkAndRedact(item as Record<string, unknown>)
        : item,
    );
  }
  if (typeof value === 'object' && value !== null) {
    return walkAndRedact(value as Record<string, unknown>);
  }
  return value;
}

/**
 * Sentry beforeSend hook. Mutates and returns the event.
 * MUST return event (not undefined) per Pitfall 3 — returning undefined drops the event.
 */
export function beforeSend(event: ErrorEvent): ErrorEvent {
  if (event.extra) {
    event.extra = walkAndRedact(event.extra as Record<string, unknown>);
  }
  if (event.contexts) {
    event.contexts = walkAndRedact(
      event.contexts as Record<string, unknown>,
    ) as typeof event.contexts;
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((bc) => ({
      ...bc,
      data: bc.data ? walkAndRedact(bc.data as Record<string, unknown>) : bc.data,
    }));
  }
  // Stack frames, error class, file/line/function are NOT touched (D-09)
  return event;
}
