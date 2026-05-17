/**
 * Tests for the canonical event taxonomy registry (Phase 24 Plan 24-02 Task 1).
 *
 * Tests cover:
 * 1. EVENTS exports an object with required shape per entry.
 * 2. Each payload field is a zod schema (instanceof z.ZodType).
 * 3. Non-PHI events have phi === false; PHI events in events.phi.ts have phi === true.
 * 4. Type inference: PayloadOf<K> resolves to the correct shape.
 * 5. TAXO-06 reconciliation marker present in events.ts header.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { EVENTS, type EventName, type PayloadOf } from './events';
import { PHI_EVENTS } from './events.phi';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('events.ts — canonical event registry', () => {
  it('Test 1: EVENTS exports an object with required shape per entry', () => {
    expect(EVENTS).toBeDefined();
    expect(typeof EVENTS).toBe('object');

    for (const [key, def] of Object.entries(EVENTS)) {
      expect(def, `Event ${key} missing name`).toHaveProperty('name');
      expect(def, `Event ${key} missing version`).toHaveProperty('version');
      expect(def, `Event ${key} missing payload`).toHaveProperty('payload');
      expect(def, `Event ${key} missing phi`).toHaveProperty('phi');
      expect(def, `Event ${key} missing description`).toHaveProperty('description');
      expect(def, `Event ${key} missing owner`).toHaveProperty('owner');
      expect(def.name, `Event ${key} name mismatch`).toBe(key);
      expect(typeof def.description).toBe('string');
    }
  });

  it('Test 2: each payload field is a zod schema (instanceof z.ZodType)', () => {
    for (const [key, def] of Object.entries(EVENTS)) {
      expect(
        def.payload,
        `Event ${key} payload is not a ZodType instance`,
      ).toBeInstanceOf(z.ZodType);
    }
  });

  it('Test 3: every non-PHI event has phi === false', () => {
    for (const [key, def] of Object.entries(EVENTS)) {
      expect(
        def.phi,
        `Non-PHI event ${key} has phi !== false`,
      ).toBe(false);
    }
  });

  it('Test 3b: every PHI event in events.phi.ts has phi === true', () => {
    for (const [key, def] of Object.entries(PHI_EVENTS)) {
      expect(
        def.phi,
        `PHI event ${key} has phi !== true`,
      ).toBe(true);
    }
  });

  it('Test 4: type inference works — PayloadOf resolves to expected shape', () => {
    // Compile-time type check: if this compiles, the type utility works.
    type SignupPayload = PayloadOf<'signup_completed'>;
    const _valid: SignupPayload = { auth_provider: 'email' };
    expect(_valid).toBeDefined();

    // Runtime validation: zod parse succeeds on valid input, throws on invalid.
    const def = EVENTS['signup_completed'];
    const parsed = def.payload.parse({ auth_provider: 'email' });
    expect(parsed).toEqual({ auth_provider: 'email' });

    expect(() => def.payload.parse({ auth_provider: 'fax' })).toThrow();
  });

  it('Test 5: TAXO-06 reconciliation marker present in events.ts header', () => {
    const eventsPath = join(__dirname, 'events.ts');
    const source = readFileSync(eventsPath, 'utf8');
    expect(
      source,
      'TAXO-06 reconciliation: string not found in events.ts header',
    ).toContain('TAXO-06 reconciliation:');
  });

  it('Seed set: EVENTS contains at least 8 events', () => {
    expect(Object.keys(EVENTS).length).toBeGreaterThanOrEqual(8);
  });

  it('Seed set: PHI_EVENTS contains at least 3 events', () => {
    expect(Object.keys(PHI_EVENTS).length).toBeGreaterThanOrEqual(3);
  });

  it('EventName type is a key of EVENTS', () => {
    const key: EventName = 'signup_started';
    expect(EVENTS[key]).toBeDefined();
  });
});
