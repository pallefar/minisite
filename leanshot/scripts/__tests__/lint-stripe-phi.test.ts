/**
 * scripts/__tests__/lint-stripe-phi.test.ts
 * Phase 25 Plan 25-05 — HIPAA-08 — Vitest tests for lint-stripe-phi.ts
 *
 * Invokes the script as a subprocess against fixture files written to isolated tmp dirs.
 *
 * Test cases:
 *  1. Clean file passes (exit 0)
 *  2. PHI keyword in stripe call site description fails (exit 1 + ::error)
 *  3. Allowlist comment WITH reason passes (exit 0)
 *  4. Allowlist comment WITHOUT reason= fails (exit 1)
 *  5. Keyword in non-stripe call passes (exit 0)
 *  6. Case-insensitive match fails (OZEMPIC → exit 1)
 *  7. Partial-word does NOT trigger (patientId word-boundary guard)
 *  8. Multi-word keyword "blood pressure" fails
 *  9. Test file excluded from scan (exit 0)
 * 10. JSON mode emits valid JSON array
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';

const LEANSHOT_ROOT = resolve(__dirname, '../..');
const SCRIPT_PATH = join(LEANSHOT_ROOT, 'scripts/lint-stripe-phi.ts');

// ---------------------------------------------------------------------------
// Per-test isolated tmp dir management
// ---------------------------------------------------------------------------
const createdDirs: string[] = [];

function makeTmpDir(): string {
  const dir = join(tmpdir(), `lint-stripe-phi-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, 'src'), { recursive: true });
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  // Clean up all dirs created in this test
  for (const dir of createdDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

function writeFixtureInSrc(tmpDir: string, filename: string, content: string): void {
  writeFileSync(join(tmpDir, 'src', filename), content, 'utf8');
}

function runScript(
  tmpDir: string,
  extraArgs: string[] = [],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    'npx',
    ['tsx', SCRIPT_PATH, `--root=${tmpDir}`, ...extraArgs],
    {
      cwd: LEANSHOT_ROOT,
      encoding: 'utf-8',
      timeout: 20_000,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lint-stripe-phi', () => {
  it('Test 1: clean stripe call passes (exit 0)', () => {
    const tmp = makeTmpDir();
    writeFixtureInSrc(
      tmp,
      'clean-stripe.ts',
      `
import Stripe from 'stripe';
const stripe = new Stripe('sk_test_xxx');

async function createCharge() {
  await stripe.charges.create({
    amount: 100,
    currency: 'usd',
    description: 'Subscription payment',
  });
}
`,
    );

    const { status } = runScript(tmp);
    expect(status).toBe(0);
  });

  it('Test 2: PHI keyword "Ozempic" in stripe description fails (exit 1)', () => {
    const tmp = makeTmpDir();
    writeFixtureInSrc(
      tmp,
      'phi-description.ts',
      `
import Stripe from 'stripe';
const stripe = new Stripe('sk_test_xxx');

async function badCharge() {
  await stripe.charges.create({
    description: 'Refund for Ozempic dose',
  });
}
`,
    );

    const { status, stderr } = runScript(tmp);
    expect(status).toBe(1);
    expect(stderr).toContain('::error');
    expect(stderr).toContain('Ozempic');
  });

  it('Test 3: allowlist comment with reason= passes (exit 0)', () => {
    const tmp = makeTmpDir();
    writeFixtureInSrc(
      tmp,
      'phi-with-allowlist.ts',
      `
import Stripe from 'stripe';
const stripe = new Stripe('sk_test_xxx');

async function allowedCharge() {
  // stripe-phi-lint:allow reason='patient-month metering label, not PHI'
  await stripe.charges.create({
    description: 'Refund for Ozempic dose',
  });
}
`,
    );

    const { status } = runScript(tmp);
    expect(status).toBe(0);
  });

  it('Test 4: allowlist comment WITHOUT reason= fails (exit 1)', () => {
    const tmp = makeTmpDir();
    writeFixtureInSrc(
      tmp,
      'phi-allowlist-no-reason.ts',
      `
import Stripe from 'stripe';
const stripe = new Stripe('sk_test_xxx');

async function badAllowlist() {
  // stripe-phi-lint:allow
  await stripe.charges.create({
    description: 'Refund for Ozempic dose',
  });
}
`,
    );

    const { status, stderr } = runScript(tmp);
    expect(status).toBe(1);
    // Should complain about missing reason=
    expect(stderr).toContain('::error');
  });

  it('Test 5: keyword in non-stripe call passes (exit 0)', () => {
    const tmp = makeTmpDir();
    writeFixtureInSrc(
      tmp,
      'non-stripe-call.ts',
      `
// File has no stripe references at all
async function unrelatedCall() {
  await otherService.charges.create({
    description: 'Ozempic refund',
  });
}
`,
    );

    const { status } = runScript(tmp);
    // Fast-path: file has no \bstripe\b token — skipped entirely
    expect(status).toBe(0);
  });

  it('Test 6: case-insensitive match — "OZEMPIC" fails (exit 1)', () => {
    const tmp = makeTmpDir();
    writeFixtureInSrc(
      tmp,
      'phi-uppercase.ts',
      `
import Stripe from 'stripe';
const stripe = new Stripe('sk_test_xxx');

async function upperCaseKeyword() {
  await stripe.charges.create({
    description: 'Refund for OZEMPIC treatment',
  });
}
`,
    );

    const { status, stderr } = runScript(tmp);
    expect(status).toBe(1);
    expect(stderr.toLowerCase()).toContain('ozempic');
  });

  it('Test 7: partial-word "patientId" does NOT trigger \\bpatient\\b (exit 0)', () => {
    const tmp = makeTmpDir();
    writeFixtureInSrc(
      tmp,
      'phi-partial-word.ts',
      `
import Stripe from 'stripe';
const stripe = new Stripe('sk_test_xxx');

async function partialWordCall() {
  await stripe.billingMeter.create({
    metadata: { type: 'patientId-token' },
  });
}
`,
    );

    const { status } = runScript(tmp);
    // patientId should NOT match \bpatient\b
    expect(status).toBe(0);
  });

  it('Test 8: multi-word keyword "blood pressure" fails (exit 1)', () => {
    const tmp = makeTmpDir();
    writeFixtureInSrc(
      tmp,
      'phi-multiword.ts',
      `
import Stripe from 'stripe';
const stripe = new Stripe('sk_test_xxx');

async function multiWordKeyword() {
  await stripe.charges.create({
    description: 'Monthly blood pressure tracker subscription',
  });
}
`,
    );

    const { status, stderr } = runScript(tmp);
    expect(status).toBe(1);
    expect(stderr.toLowerCase()).toContain('blood pressure');
  });

  it('Test 9: test file in __tests__ directory is excluded (exit 0)', () => {
    const tmp = makeTmpDir();
    // Create a __tests__ directory under src (should be excluded)
    const testsDir = join(tmp, 'src', '__tests__');
    mkdirSync(testsDir, { recursive: true });
    writeFileSync(
      join(testsDir, 'bad-stripe.test.ts'),
      `
import Stripe from 'stripe';
const stripe = new Stripe('sk_test_xxx');
async function testCharge() {
  await stripe.charges.create({
    description: 'Ozempic dose violation',
  });
}
`,
      'utf8',
    );

    // Also put a clean file in src/ to confirm src/ is still scanned
    writeFixtureInSrc(
      tmp,
      'clean.ts',
      `
import Stripe from 'stripe';
const stripe = new Stripe('sk_test_xxx');
async function ok() {
  await stripe.charges.create({ amount: 100 });
}
`,
    );

    const { status } = runScript(tmp);
    // The __tests__ dir is excluded; the clean file passes; expect 0
    expect(status).toBe(0);
  });

  it('Test 10: --json mode emits valid JSON array', () => {
    const tmp = makeTmpDir();
    writeFixtureInSrc(
      tmp,
      'phi-for-json.ts',
      `
import Stripe from 'stripe';
const stripe = new Stripe('sk_test_xxx');

async function jsonTestCharge() {
  await stripe.charges.create({
    description: 'Ozempic refund',
  });
}
`,
    );

    const result = runScript(tmp, ['--json']);

    // Should exit 1 (violation found)
    expect(result.status).toBe(1);

    // stdout should be valid JSON
    let parsed: unknown;
    expect(() => {
      parsed = JSON.parse(result.stdout);
    }).not.toThrow();

    // Should be an array
    expect(Array.isArray(parsed)).toBe(true);
    // Should have at least one violation
    expect((parsed as unknown[]).length).toBeGreaterThan(0);

    // Each violation should have expected shape
    const first = (parsed as Record<string, unknown>[])[0];
    expect(first).toHaveProperty('file');
    expect(first).toHaveProperty('line');
    expect(first).toHaveProperty('keyword');
  });
});
