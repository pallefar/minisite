/**
 * Phase 31 Plan 04 — Unit tests for `public._validate_onboarding_steps` SQL function.
 *
 * These tests call the DB function directly via service-role client.
 * The validator is an internal SECDEF (underscore-prefixed) NOT exposed in
 * the generated types; invoked via untyped admin.rpc('_validate_onboarding_steps', ...).
 *
 * Skipped automatically when SUPABASE_* env vars are not set (CI without live DB).
 *
 * TDD note: Tests are RED until Migration 1 (20270601400005_p31_04_org_onboarding_flows.sql)
 * is pushed to the live DB in Task 4.
 */

import { describe, expect, it } from 'vitest';
import { getAdmin, SHOULD_RUN } from './_fixtures/p28-rls-fixture';

// Helper: build a minimal valid step
function makeStep(
  type: string,
  opts?: { id?: string; skip?: boolean; custom?: Record<string, string> },
) {
  return {
    id: opts?.id ?? crypto.randomUUID(),
    type,
    ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
    ...(opts?.custom !== undefined ? { custom: opts.custom } : {}),
  };
}

// Minimal valid flow: must contain medication + consent
const VALID_STEPS = [
  makeStep('welcome'),
  makeStep('intro_card'),
  makeStep('medication'),
  makeStep('consent'),
];

const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('_validate_onboarding_steps', () => {
  let admin: ReturnType<typeof getAdmin>;

  beforeAll(() => {
    admin = getAdmin();
  });

  async function validate(steps: unknown): Promise<{ data: unknown; error: unknown }> {
    // Cast as any — function not in generated types (internal SECDEF)

    return admin.rpc('_validate_onboarding_steps', { p_steps: steps as any } as any);
  }

  it('Test 1: empty array raises MISSING_MANDATORY_STEP', async () => {
    const { error } = await validate([]);
    expect(error).not.toBeNull();
    expect((error as { message: string }).message).toMatch(/MISSING_MANDATORY_STEP/);
  }, 15_000);

  it('Test 2: only welcome step (missing both mandatory) raises MISSING_MANDATORY_STEP', async () => {
    const { error } = await validate([makeStep('welcome')]);
    expect(error).not.toBeNull();
    expect((error as { message: string }).message).toMatch(/MISSING_MANDATORY_STEP/);
  }, 15_000);

  it('Test 3: medication present but consent missing raises MISSING_MANDATORY_STEP', async () => {
    const { error } = await validate([makeStep('medication'), makeStep('welcome')]);
    expect(error).not.toBeNull();
    expect((error as { message: string }).message).toMatch(/MISSING_MANDATORY_STEP/);
  }, 15_000);

  it('Test 4: unknown step type raises UNKNOWN_STEP_TYPE', async () => {
    const steps = [makeStep('foobar'), makeStep('medication'), makeStep('consent')];
    const { error } = await validate(steps);
    expect(error).not.toBeNull();
    expect((error as { message: string }).message).toMatch(/UNKNOWN_STEP_TYPE/);
  }, 15_000);

  it('Test 5: medication step with custom field raises INVALID_CUSTOM_ON_LOCKED_STEP', async () => {
    const steps = [makeStep('medication', { custom: { title: 'foo' } }), makeStep('consent')];
    const { error } = await validate(steps);
    expect(error).not.toBeNull();
    expect((error as { message: string }).message).toMatch(/INVALID_CUSTOM_ON_LOCKED_STEP/);
  }, 15_000);

  it('Test 6: consent step with custom field raises INVALID_CUSTOM_ON_LOCKED_STEP', async () => {
    const steps = [makeStep('medication'), makeStep('consent', { custom: { body: 'bar' } })];
    const { error } = await validate(steps);
    expect(error).not.toBeNull();
    expect((error as { message: string }).message).toMatch(/INVALID_CUSTOM_ON_LOCKED_STEP/);
  }, 15_000);

  it('Test 7: valid happy path — welcome+intro_card+medication+consent with custom only on editable types', async () => {
    const steps = [
      makeStep('welcome', { custom: { title: 'Welcome!', body: 'Hello' } }),
      makeStep('intro_card', { custom: { title: 'Intro', body: 'Body text' } }),
      makeStep('medication'),
      makeStep('consent'),
    ];
    const { data, error } = await validate(steps);
    expect(error).toBeNull();
    // void returns null from RPC
    expect(data === null || data === undefined).toBe(true);
  }, 15_000);

  it('Test 8: intro_card.custom.image_url is accepted (per D-09)', async () => {
    const steps = [
      makeStep('intro_card', {
        custom: { title: 'Intro', body: 'Body', image_url: 'https://example.com/img.png' },
      }),
      makeStep('medication'),
      makeStep('consent'),
    ];
    const { data, error } = await validate(steps);
    expect(error).toBeNull();
    expect(data === null || data === undefined).toBe(true);
  }, 15_000);
});

describe('_validate_onboarding_steps — env gating check', () => {
  it('skips live DB tests when SUPABASE_SERVICE_ROLE_KEY is not set', () => {
    if (!SHOULD_RUN) {
      console.warn('[validate-onboarding-steps.test] SKIPPED — env not set.');
    }
    expect(true).toBe(true);
  });
});
