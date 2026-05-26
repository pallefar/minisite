/**
 * Phase 62 eval — consent schema assertions (INSIGHTS-05).
 *
 * Asserts that the research_consent_columns migration:
 *   1. Adds research_consent boolean NOT NULL DEFAULT false
 *   2. Adds consent_revoked_at timestamptz
 *   3. Adds last_purged_at timestamptz
 *   4. Creates the partial index for nightly cron efficiency
 *
 * These columns are privacy-critical: default false = opt-in required
 * (HIPAA Privacy Rule §164.508 patient authorization).
 *
 * Resolves path from __dirname (eval/phase62/) → ../../ = git root.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const GIT_ROOT = path.resolve(__dirname, '..', '..');
const CONSENT_FILE = path.join(
  GIT_ROOT,
  'supabase',
  'migrations',
  '20290102000003_research_consent_columns.sql',
);

describe('Research consent schema (INSIGHTS-05)', () => {
  it('consent columns migration file exists', () => {
    expect(
      fs.existsSync(CONSENT_FILE),
      `Expected consent columns migration at: ${CONSENT_FILE}`,
    ).toBe(true);
  });

  it('adds research_consent boolean NOT NULL DEFAULT false (opt-in)', () => {
    const body = fs.readFileSync(CONSENT_FILE, 'utf-8').toLowerCase();
    expect(body).toMatch(/research_consent\s+boolean\s+not\s+null\s+default\s+false/i);
  });

  it('adds consent_revoked_at timestamptz', () => {
    const body = fs.readFileSync(CONSENT_FILE, 'utf-8').toLowerCase();
    expect(body).toMatch(/consent_revoked_at\s+timestamptz/i);
  });

  it('adds last_purged_at timestamptz', () => {
    const body = fs.readFileSync(CONSENT_FILE, 'utf-8').toLowerCase();
    expect(body).toMatch(/last_purged_at\s+timestamptz/i);
  });

  it('creates partial index for nightly purge cron efficiency', () => {
    const body = fs.readFileSync(CONSENT_FILE, 'utf-8').toLowerCase();
    // Must create an index referencing consent_revoked_at for cron scan
    expect(body).toMatch(/create\s+index/i);
    expect(body).toMatch(/consent_revoked_at/i);
  });
});
