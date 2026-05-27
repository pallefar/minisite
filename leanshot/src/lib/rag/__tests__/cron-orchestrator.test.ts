/**
 * Phase 50 Plan 50-04 — cron orchestrator behavior tests.
 *
 * Covers D-09 (per-topic cadence advancement) + cron-tick claim semantics
 * (next_scrape_at <= now() AND deleted_at IS NULL).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  nextScrapeAtFromCadence,
  type Cadence,
} from '../scrape/runner-helpers';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const CRON_MIGRATION_PATH = resolve(
  REPO_ROOT,
  'supabase/migrations/20260519000011_rag_scrape_cron.sql',
);
const RUNNER_INDEX_PATH = resolve(
  REPO_ROOT,
  'supabase/functions/rag-scrape-runner/index.ts',
);

describe('Phase 50 Plan 50-04 — cron orchestrator', () => {
  describe('D-09: next_scrape_at computed from cadence', () => {
    const now = new Date('2026-05-19T12:00:00Z');

    it('daily → +1 day', () => {
      const r = nextScrapeAtFromCadence('daily', now);
      expect(r).toBe('2026-05-20T12:00:00.000Z');
    });

    it('weekly → +7 days', () => {
      const r = nextScrapeAtFromCadence('weekly', now);
      expect(r).toBe('2026-05-26T12:00:00.000Z');
    });

    it('monthly → +30 days', () => {
      const r = nextScrapeAtFromCadence('monthly', now);
      expect(r).toBe('2026-06-18T12:00:00.000Z');
    });

    it('manual → NULL (do not auto-schedule)', () => {
      const r = nextScrapeAtFromCadence('manual', now);
      expect(r).toBeNull();
    });

    it('fallback (unknown cadence) defaults to weekly', () => {
      const r = nextScrapeAtFromCadence('unrecognized' as Cadence, now);
      expect(r).toBe('2026-05-26T12:00:00.000Z');
    });
  });

  describe('cron migration: every-5-min schedule + correct edge fn URL', () => {
    it('registers rag-scrape-tick with `*/5 * * * *`', () => {
      const sql = readFileSync(CRON_MIGRATION_PATH, 'utf-8');
      expect(sql).toMatch(/cron\.schedule\(\s*'rag-scrape-tick'\s*,\s*'\*\/5 \* \* \* \*'/);
    });

    it('invokes the rag-scrape-runner Edge Fn URL on the canonical project ref', () => {
      const sql = readFileSync(CRON_MIGRATION_PATH, 'utf-8');
      expect(sql).toContain('https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/rag-scrape-runner');
    });

    it('reads service-role bearer from vault.decrypted_secrets (NOT a GUC)', () => {
      const sql = readFileSync(CRON_MIGRATION_PATH, 'utf-8');
      // Per [[reference_supabase_pg_cron_vault_service_role_pattern]] —
      // `app.service_role_key` GUC does NOT exist on this project; must
      // read from vault.decrypted_secrets.
      expect(sql).toContain('vault.decrypted_secrets');
      expect(sql).not.toMatch(/current_setting\(['"]app\.service_role_key['"]/);
    });

    it('uses a named dollar-quote tag for the inner cron body ($cron$ not $$)', () => {
      // Per [[reference_postgres_dollar_quote_nesting_in_cron_body]] — $$
      // inside cron.schedule() body closes the outer quote prematurely.
      const sql = readFileSync(CRON_MIGRATION_PATH, 'utf-8');
      expect(sql).toMatch(/cron\.schedule\(.*?\$cron\$/s);
    });

    it('is idempotent: unschedules existing rag-scrape-tick before re-registering', () => {
      const sql = readFileSync(CRON_MIGRATION_PATH, 'utf-8');
      expect(sql).toMatch(/cron\.unschedule\(\s*'rag-scrape-tick'\s*\)/);
    });
  });

  describe('cron tick picks topics where next_scrape_at <= now() AND deleted_at IS NULL', () => {
    it('runner pickTopicsToScrape filters deleted_at IS NULL', () => {
      const src = readFileSync(RUNNER_INDEX_PATH, 'utf-8');
      expect(src).toMatch(/\.is\(['"]deleted_at['"],\s*null\)/);
    });

    it('runner pickTopicsToScrape filters next_scrape_at IS NULL OR next_scrape_at <= now()', () => {
      const src = readFileSync(RUNNER_INDEX_PATH, 'utf-8');
      // Either form is acceptable — we just want both `next_scrape_at.is.null`
      // and an `lte.` comparison present.
      expect(src).toMatch(/next_scrape_at\.is\.null/);
      expect(src).toMatch(/next_scrape_at\.lte\./);
    });

    it('claimTopic uses UPDATE-with-RETURNING for idempotency under concurrent ticks', () => {
      const src = readFileSync(RUNNER_INDEX_PATH, 'utf-8');
      expect(src).toMatch(/async function claimTopic/);
      expect(src).toMatch(/\.update\(\{\s*last_scraped_at/);
      expect(src).toMatch(/\.select\(/);
    });
  });

  describe('cadence advancement after run', () => {
    it('runner advances next_scrape_at on non-failed runs only', () => {
      const src = readFileSync(RUNNER_INDEX_PATH, 'utf-8');
      expect(src).toMatch(/overallStatus !== ['"]failed['"]/);
      expect(src).toMatch(/next_scrape_at:\s*nextScrapeAtFromCadence/);
    });
  });
});
