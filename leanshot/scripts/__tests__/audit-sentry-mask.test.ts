/**
 * scripts/__tests__/audit-sentry-mask.test.ts
 * Phase 25 Plan 25-06 — HIPAA-16 — Vitest tests for audit-sentry-mask.ts
 *
 * Invokes the script as a subprocess against fixture files written to isolated
 * tmp dirs (mirrors lint-stripe-phi.test.ts pattern from Plan 25-05).
 *
 * Test cases:
 *  1. Clean (input with data-sentry-mask passes) → exit 0
 *  2. Violation (input without mask fails) → exit 1 + stderr `patient.name`
 *  3. className shield (`sentry-mask` in className passes) → exit 0
 *  4. Allowlist with reason= passes → exit 0
 *  5. Allowlist WITHOUT reason= fails → exit 1
 *  6. Ancestor shielding (parent data-sentry-mask shields descendants) → exit 0
 *  7. Non-PHI prop unaffected (settings.theme) → exit 0
 *  8. Multi-violation per file → exit 1 + 3 separate ::error lines
 *  9. Test file in __tests__ dir excluded → exit 0
 * 10. JSON mode emits valid JSON array
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';

const LEANSHOT_ROOT = resolve(__dirname, '../..');
const SCRIPT_PATH = join(LEANSHOT_ROOT, 'scripts/audit-sentry-mask.ts');

// ---------------------------------------------------------------------------
// Per-test isolated tmp dir management
// ---------------------------------------------------------------------------
const createdDirs: string[] = [];

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `audit-sentry-mask-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(dir, 'src'), { recursive: true });
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
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
      timeout: 30_000,
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

describe('audit-sentry-mask', () => {
  it('Test 1: clean — element with data-sentry-mask passes (exit 0)', () => {
    const tmp = makeTmpDir();
    writeFixtureInSrc(
      tmp,
      'clean-masked.tsx',
      `
export function PatientCard({ patient }: { patient: { name: string } }) {
  return (
    <div>
      <input value={patient.name} data-sentry-mask />
    </div>
  );
}
`,
    );

    const { status } = runScript(tmp);
    expect(status).toBe(0);
  });

  it('Test 2: violation — input without mask fails (exit 1 + patient.name in stderr)', () => {
    const tmp = makeTmpDir();
    writeFixtureInSrc(
      tmp,
      'violation.tsx',
      `
export function PatientCard({ patient }: { patient: { name: string } }) {
  return (
    <div>
      <input value={patient.name} />
    </div>
  );
}
`,
    );

    const { status, stderr } = runScript(tmp);
    expect(status).toBe(1);
    expect(stderr).toContain('::error');
    expect(stderr).toContain('patient.name');
  });

  it('Test 3: className shield — sentry-mask in className passes (exit 0)', () => {
    const tmp = makeTmpDir();
    writeFixtureInSrc(
      tmp,
      'classname-shield.tsx',
      `
export function PatientCard({ patient }: { patient: { name: string } }) {
  return (
    <div>
      <input value={patient.name} className="form-input sentry-mask" />
    </div>
  );
}
`,
    );

    const { status } = runScript(tmp);
    expect(status).toBe(0);
  });

  it('Test 4: allowlist with reason= passes (exit 0)', () => {
    const tmp = makeTmpDir();
    writeFixtureInSrc(
      tmp,
      'allowlist-with-reason.tsx',
      `
export function PatientCard({ patient }: { patient: { name: string } }) {
  return (
    <div>
      {/* sentry-mask-lint:allow reason='display name shown to self only' */}
      <span>{patient.name}</span>
    </div>
  );
}
`,
    );

    const { status } = runScript(tmp);
    expect(status).toBe(0);
  });

  it('Test 5: allowlist WITHOUT reason= fails (exit 1)', () => {
    const tmp = makeTmpDir();
    writeFixtureInSrc(
      tmp,
      'allowlist-no-reason.tsx',
      `
export function PatientCard({ patient }: { patient: { name: string } }) {
  return (
    <div>
      {/* sentry-mask-lint:allow */}
      <span>{patient.name}</span>
    </div>
  );
}
`,
    );

    const { status, stderr } = runScript(tmp);
    expect(status).toBe(1);
    expect(stderr).toContain('::error');
  });

  it('Test 6: ancestor shielding — parent data-sentry-mask shields descendants (exit 0)', () => {
    const tmp = makeTmpDir();
    writeFixtureInSrc(
      tmp,
      'ancestor-shield.tsx',
      `
export function PatientCard({ patient }: { patient: { email: string } }) {
  return (
    <div data-sentry-mask>
      <span>{patient.email}</span>
    </div>
  );
}
`,
    );

    const { status } = runScript(tmp);
    expect(status).toBe(0);
  });

  it('Test 7: non-PHI prop unaffected — settings.theme passes (exit 0)', () => {
    const tmp = makeTmpDir();
    writeFixtureInSrc(
      tmp,
      'non-phi.tsx',
      `
export function ThemeDisplay({ settings }: { settings: { theme: string } }) {
  return (
    <div>
      <input value={settings.theme} />
    </div>
  );
}
`,
    );

    const { status } = runScript(tmp);
    expect(status).toBe(0);
  });

  it('Test 8: multi-violation per file — 3 violations → exit 1 + 3 ::error lines', () => {
    const tmp = makeTmpDir();
    writeFixtureInSrc(
      tmp,
      'multi-violation.tsx',
      `
export function PHIForm({ patient }: { patient: { name: string; email: string; dob: string } }) {
  return (
    <div>
      <input value={patient.name} />
      <input value={patient.email} />
      <input value={patient.dob} />
    </div>
  );
}
`,
    );

    const { status, stderr } = runScript(tmp);
    expect(status).toBe(1);
    // Should have at least 3 ::error annotations
    const errorLines = stderr.split('\n').filter((line) => line.includes('::error'));
    expect(errorLines.length).toBeGreaterThanOrEqual(3);
  });

  it('Test 9: test file in __tests__ dir is excluded from scan (exit 0)', () => {
    const tmp = makeTmpDir();
    // Violation inside __tests__ (should be excluded)
    const testsDir = join(tmp, 'src', '__tests__');
    mkdirSync(testsDir, { recursive: true });
    writeFileSync(
      join(testsDir, 'bad-phi.test.tsx'),
      `
export function TestFixture({ patient }: { patient: { name: string } }) {
  return <span>{patient.name}</span>;
}
`,
      'utf8',
    );

    // Clean file in src/ so the scanner has something to scan
    writeFixtureInSrc(
      tmp,
      'clean.tsx',
      `
export function CleanComponent({ user }: { user: { id: string } }) {
  return <div>{user.id}</div>;
}
`,
    );

    const { status } = runScript(tmp);
    // __tests__ excluded; clean.tsx has no PHI expressions → exit 0
    expect(status).toBe(0);
  });

  it('Test 10: --json mode emits valid JSON array', () => {
    const tmp = makeTmpDir();
    writeFixtureInSrc(
      tmp,
      'phi-for-json.tsx',
      `
export function EmailDisplay({ patient }: { patient: { email: string } }) {
  return <span>{patient.email}</span>;
}
`,
    );

    const result = runScript(tmp, ['--json']);

    expect(result.status).toBe(1);

    let parsed: unknown;
    expect(() => {
      parsed = JSON.parse(result.stdout);
    }).not.toThrow();

    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as unknown[]).length).toBeGreaterThan(0);

    const first = (parsed as Record<string, unknown>[])[0];
    expect(first).toHaveProperty('file');
    expect(first).toHaveProperty('line');
    expect(first).toHaveProperty('expression');
  });
});
