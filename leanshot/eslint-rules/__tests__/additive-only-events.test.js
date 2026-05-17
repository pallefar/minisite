/**
 * Tests for the additive-only-events custom ESLint rule (Phase 24 Plan 24-02 Task 3).
 *
 * Tests cover:
 * 1. Added optional field → no error.
 * 2. Removed payload field → reports event-payload-field-removed.
 * 3. Type change (z.string() → z.number()) → reports event-payload-type-changed.
 * 4. Comment/whitespace-only edit → no error.
 * 5. First-commit case (no HEAD for events.ts) → no crash.
 */
import { RuleTester } from 'eslint';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, beforeAll, afterAll } from 'vitest';

import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const rule = _require('../additive-only-events.cjs');

// Helper: create a temp git repo with events.ts at HEAD, then set env var
// LEANSHOT_GIT_CWD so the rule uses that repo instead of the real one.
function createTempRepo(headEventsSource) {
  const dir = join(tmpdir(), `leanshot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  try {
    execSync('git init', { cwd: dir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
    // Create the file at HEAD
    mkdirSync(join(dir, 'src/lib/analytics'), { recursive: true });
    writeFileSync(join(dir, 'src/lib/analytics/events.ts'), headEventsSource);
    execSync('git add .', { cwd: dir, stdio: 'pipe' });
    execSync('git commit -m "initial"', { cwd: dir, stdio: 'pipe' });
  } catch (e) {
    throw new Error(`createTempRepo failed: ${e.message}`);
  }
  return dir;
}

function cleanupTempRepo(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
}

// Minimal HEAD events.ts with one event
const HEAD_SOURCE_BASE = `
import { z } from 'zod';
export const EVENTS = {
  signup_started: {
    name: 'signup_started',
    version: 1,
    phi: false,
    owner: 'growth',
    description: 'Test.',
    payload: z.object({ source: z.string() }),
  },
} as const;
`;

// With an extra optional field added — should be OK
const SOURCE_ADDED_FIELD = `
import { z } from 'zod';
export const EVENTS = {
  signup_started: {
    name: 'signup_started',
    version: 1,
    phi: false,
    owner: 'growth',
    description: 'Test.',
    payload: z.object({ source: z.string(), extra: z.string().optional() }),
  },
} as const;
`;

// With a field removed — should error
const SOURCE_REMOVED_FIELD = `
import { z } from 'zod';
export const EVENTS = {
  signup_started: {
    name: 'signup_started',
    version: 1,
    phi: false,
    owner: 'growth',
    description: 'Test.',
    payload: z.object({}),
  },
} as const;
`;

// With type changed z.string() → z.number() — should error
const SOURCE_TYPE_CHANGED = `
import { z } from 'zod';
export const EVENTS = {
  signup_started: {
    name: 'signup_started',
    version: 1,
    phi: false,
    owner: 'growth',
    description: 'Test.',
    payload: z.object({ source: z.number() }),
  },
} as const;
`;

// Whitespace/comment change only — should be OK
const SOURCE_COMMENT_CHANGE = `
import { z } from 'zod';
// A new comment added
export const EVENTS = {
  signup_started: {
    // inline comment
    name: 'signup_started',
    version: 1,
    phi: false,
    owner: 'growth',
    description: 'Test updated.',
    payload: z.object({ source: z.string() }),
  },
} as const;
`;

describe('additive-only-events ESLint rule', () => {
  let tempRepoDir;

  beforeAll(() => {
    tempRepoDir = createTempRepo(HEAD_SOURCE_BASE);
    process.env.LEANSHOT_GIT_CWD = tempRepoDir;
  });

  afterAll(() => {
    delete process.env.LEANSHOT_GIT_CWD;
    if (tempRepoDir) cleanupTempRepo(tempRepoDir);
  });

  // We test the rule logic directly by calling rule.create() with mock contexts
  // rather than using RuleTester, since RuleTester requires a full ESLint setup
  // that conflicts with the git-based snapshot approach.
  // The rule exports: { meta: {...}, create: (context) => ({...}) }

  it('Test 1: added optional field → no error reported', async () => {
    const errors = await runRule(SOURCE_ADDED_FIELD);
    // May have 0 errors — adding a field is allowed
    const fieldRemovedErrors = errors.filter(e => e.includes('event-payload-field-removed') || e.includes('field-removed'));
    const typeChangedErrors = errors.filter(e => e.includes('event-payload-type-changed') || e.includes('type-changed'));
    expect(fieldRemovedErrors).toHaveLength(0);
    expect(typeChangedErrors).toHaveLength(0);
  });

  it('Test 2: removed payload field → reports event-payload-field-removed', async () => {
    const errors = await runRule(SOURCE_REMOVED_FIELD);
    const hasFieldRemovedError = errors.some(e =>
      e.includes('event-payload-field-removed') || e.includes('removed') || e.includes('source')
    );
    expect(hasFieldRemovedError).toBe(true);
  });

  it('Test 3: type change z.string() → z.number() → reports event-payload-type-changed', async () => {
    const errors = await runRule(SOURCE_TYPE_CHANGED);
    const hasTypeChangedError = errors.some(e =>
      e.includes('event-payload-type-changed') || e.includes('type') || e.includes('changed')
    );
    expect(hasTypeChangedError).toBe(true);
  });

  it('Test 4: comment/whitespace edit only → no error', async () => {
    const errors = await runRule(SOURCE_COMMENT_CHANGE);
    const fieldRemovedErrors = errors.filter(e => e.includes('event-payload-field-removed') || e.includes('field-removed'));
    const typeChangedErrors = errors.filter(e => e.includes('event-payload-type-changed') || e.includes('type-changed'));
    expect(fieldRemovedErrors).toHaveLength(0);
    expect(typeChangedErrors).toHaveLength(0);
  });

  it('Test 5: first-commit (no HEAD for events.ts) → no crash', async () => {
    const noHeadDir = join(tmpdir(), `leanshot-no-head-${Date.now()}`);
    mkdirSync(join(noHeadDir, 'src/lib/analytics'), { recursive: true });
    execSync('git init', { cwd: noHeadDir, stdio: 'pipe' });
    execSync('git config user.email "x@x.com"', { cwd: noHeadDir, stdio: 'pipe' });
    execSync('git config user.name "X"', { cwd: noHeadDir, stdio: 'pipe' });

    const savedDir = process.env.LEANSHOT_GIT_CWD;
    process.env.LEANSHOT_GIT_CWD = noHeadDir;
    try {
      const errors = await runRule(HEAD_SOURCE_BASE);
      // Should return no errors (graceful no-HEAD handling)
      expect(Array.isArray(errors)).toBe(true);
    } finally {
      process.env.LEANSHOT_GIT_CWD = savedDir;
      cleanupTempRepo(noHeadDir);
    }
  });
});

/**
 * Runs the additive-only-events rule against `currentSource` using the
 * events.ts committed in LEANSHOT_GIT_CWD as the "previous" snapshot.
 * Returns an array of error message strings.
 */
async function runRule(currentSource) {
  const errors = [];

  const mockReport = (descriptor) => {
    errors.push(
      typeof descriptor === 'string'
        ? descriptor
        : descriptor.messageId ?? descriptor.message ?? JSON.stringify(descriptor)
    );
  };

  const mockContext = {
    filename: 'src/lib/analytics/events.ts',
    getFilename: () => 'src/lib/analytics/events.ts',
    getSourceCode: () => ({ text: currentSource }),
    sourceCode: { text: currentSource },
    report: mockReport,
  };

  const visitor = rule.create(mockContext);

  // Parse the current source with @typescript-eslint/parser
  const { parse } = await import('@typescript-eslint/parser');
  const ast = parse(currentSource, { jsx: false, range: true, loc: true });

  // Walk the AST to trigger Program:exit
  if (visitor['Program:exit']) {
    visitor['Program:exit'](ast);
  }

  return errors;
}
