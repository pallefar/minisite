/**
 * Tests for the no-raw-service-role-client custom ESLint rule.
 *
 * Phase 28 Plan 28-02 Task 2 (D-06 / ADDENDUM A6).
 *
 * Tests cover:
 *   1. createClient(url, SUPABASE_SERVICE_ROLE_KEY) outside allowed file → 1 error.
 *   2. Same code inside supabase/functions/_shared/supabase-server.ts → 0 errors.
 *   3. createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) outside → 1 error.
 *   4. createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY) outside → 1 error.
 *   5. createClient(url, SUPABASE_ANON_KEY) → 0 errors (anon key not matched).
 *   6. createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) inside allowed file → 0 errors.
 *
 * Runs with Node.js built-in test runner: `node --test eslint-rules/__tests__/no-raw-service-role-client.test.cjs`
 *
 * Uses ESLint's RuleTester (flat config variant) for AST-accurate testing.
 * The RuleTester invokes rule.create() on parsed AST — not string matching.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { RuleTester } = require('eslint');

const rule = require('../no-raw-service-role-client.cjs');

// ---------------------------------------------------------------------------
// RuleTester setup (ESLint v9 flat config shape)
// ---------------------------------------------------------------------------

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe('no-raw-service-role-client', () => {
  test('Test 1: identifier SERVICE_ROLE_KEY arg outside allowed file → 1 error', () => {
    tester.run('no-raw-service-role-client', rule, {
      valid: [],
      invalid: [
        {
          filename: 'src/lib/some-server-util.ts',
          code: `const client = createClient(url, SUPABASE_SERVICE_ROLE_KEY);`,
          errors: [{ messageId: 'raw-service-role-client' }],
        },
      ],
    });
  });

  test('Test 2: same code inside allowed file → 0 errors', () => {
    tester.run('no-raw-service-role-client', rule, {
      valid: [
        {
          filename: 'supabase/functions/_shared/supabase-server.ts',
          code: `const client = createClient(url, SUPABASE_SERVICE_ROLE_KEY);`,
        },
      ],
      invalid: [],
    });
  });

  test('Test 3: Deno.env.get(SERVICE_ROLE_KEY) outside allowed file → 1 error', () => {
    tester.run('no-raw-service-role-client', rule, {
      valid: [],
      invalid: [
        {
          filename: 'supabase/functions/my-function/index.ts',
          code: `const client = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));`,
          errors: [{ messageId: 'raw-service-role-client' }],
        },
      ],
    });
  });

  test('Test 4: process.env.SUPABASE_SERVICE_ROLE_KEY outside allowed file → 1 error', () => {
    tester.run('no-raw-service-role-client', rule, {
      valid: [],
      invalid: [
        {
          filename: 'src/server/some-util.ts',
          code: `const client = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);`,
          errors: [{ messageId: 'raw-service-role-client' }],
        },
      ],
    });
  });

  test('Test 5: createClient with ANON key → 0 errors', () => {
    tester.run('no-raw-service-role-client', rule, {
      valid: [
        {
          filename: 'src/lib/supabase.ts',
          code: `const client = createClient(url, SUPABASE_ANON_KEY);`,
        },
        {
          filename: 'src/lib/supabase.ts',
          code: `const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY'));`,
        },
      ],
      invalid: [],
    });
  });

  test('Test 6: Deno.env.get(SERVICE_ROLE_KEY) inside allowed file → 0 errors', () => {
    tester.run('no-raw-service-role-client', rule, {
      valid: [
        {
          filename: 'supabase/functions/_shared/supabase-server.ts',
          code: `const client = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));`,
        },
      ],
      invalid: [],
    });
  });

  test('Test 7: non-createClient call with SERVICE_ROLE_KEY → 0 errors', () => {
    tester.run('no-raw-service-role-client', rule, {
      valid: [
        {
          filename: 'src/lib/some-util.ts',
          code: `const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');`,
        },
        {
          filename: 'src/lib/some-util.ts',
          code: `const val = process.env.SUPABASE_SERVICE_ROLE_KEY;`,
        },
      ],
      invalid: [],
    });
  });
});
