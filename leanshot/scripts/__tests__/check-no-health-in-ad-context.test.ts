/**
 * scripts/__tests__/check-no-health-in-ad-context.test.ts
 *
 * Phase 55 Plan 55-01 Task 3 (HEALTH-04/HEALTH-08 — Layer 3 of 3).
 *
 * Vitest tests for the CI grep gate check-no-health-in-ad-context.sh.
 *
 * Test cases:
 *   1. Violation: ad-context file contains health import -- exits 1
 *   2. Clean:     no ad-context file -- exits 0
 *   3. Comment-strip proof: health import inside block comment -- exits 0
 *
 * The gate is invoked as a subprocess with a temporary directory acting as
 * the "src root", following the pattern from scripts/__tests__/audit-sentry-mask.test.ts.
 *
 * Layer 3 of 3: this test proves the grep gate catches a violation that
 * an eslint-disable comment could hide in layer 1.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';

const LEANSHOT_ROOT = resolve(__dirname, '../..');
const SCRIPT_PATH = join(LEANSHOT_ROOT, 'scripts/check-no-health-in-ad-context.sh');

// ---------------------------------------------------------------------------
// Per-test isolated tmp dir management
// ---------------------------------------------------------------------------
const createdDirs: string[] = [];

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `check-no-health-in-ad-context-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of createdDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function runGate(srcRoot: string) {
  return spawnSync('bash', [SCRIPT_PATH, srcRoot], { encoding: 'utf-8' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('check-no-health-in-ad-context.sh (Layer 3 CI grep gate)', () => {
  it('exits 1 when an analytics directory file imports health.ts (violation fixture)', () => {
    const tmpDir = makeTmpDir();
    // Create a fake analytics directory with a file that imports health.ts
    const analyticsDir = join(tmpDir, 'analytics');
    mkdirSync(analyticsDir, { recursive: true });
    writeFileSync(
      join(analyticsDir, 'tracker.ts'),
      // The import string that should be detected after comment-stripping
      "import { readHealthSamples } from '../native/health';\n",
    );

    const result = runGate(tmpDir);
    expect(result.status).toBe(1);
    // stderr should contain the error annotation
    expect(result.stderr).toContain('::error::');
    expect(result.stderr).toContain('tracker.ts');
  });

  it('exits 0 on a clean tree (no ad-context file imports health)', () => {
    const tmpDir = makeTmpDir();
    // Create a non-ad-context directory with a health import — should NOT trigger
    const healthkitDir = join(tmpDir, 'components', 'healthkit');
    mkdirSync(healthkitDir, { recursive: true });
    writeFileSync(
      join(healthkitDir, 'HealthKitConsentModal.tsx'),
      "import { isHealthKitAvailable } from '../../lib/native/health';\n",
    );

    const result = runGate(tmpDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK');
  });

  it('exits 0 when health import appears only inside a block comment (comment-strip proof)', () => {
    const tmpDir = makeTmpDir();
    // Create a marketing file where the health reference is ONLY in a block comment
    const marketingDir = join(tmpDir, 'marketing');
    mkdirSync(marketingDir, { recursive: true });
    writeFileSync(
      join(marketingDir, 'campaign.ts'),
      [
        '/*',
        " * IMPORTANT: do NOT import from native/health — firewall enforced.",
        " * See check-no-health-in-ad-context.sh for the gate.",
        ' */',
        "import { detectPlatform } from '../native/platform';",
        "export function getCampaignData() { return detectPlatform(); }",
      ].join('\n') + '\n',
    );

    const result = runGate(tmpDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK');
  });

  it('exits 2 when src root does not exist', () => {
    const result = runGate('/nonexistent/path/that/does/not/exist');
    expect(result.status).toBe(2);
  });
});
