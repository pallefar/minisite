/**
 * normalize.test.ts — Vitest unit tests for DailyMed normalizer.
 *
 * Phase 60 Plan 60-07. Task 4 (TDD RED → GREEN).
 *
 * 4 tests:
 *  T1: DailyMedSPLSchema parses valid fixture → ok
 *  T2: Missing setid OR spl_version → zod throws
 *  T3: normalizeDailyMed returns correct rag_chunks payload with LOINC-filtered sections
 *  T4: spl_version=2 vs spl_version=1 → different content_hash (drift detection)
 */

import { describe, expect, it } from 'vitest';
import {
  DailyMedSPLSchema,
  normalizeDailyMed,
  SYSTEM_FEDERATED_UUID,
} from '../normalize.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const VALID_SPL = {
  setid: 'abc-setid-001',
  spl_version: 3,
  title: 'Mounjaro (tirzepatide) Injection',
  published_date: '2026-05-26',
  sections: [
    {
      code: '34066-1',
      title: 'BOXED WARNING',
      text: 'WARNING: Risk of thyroid C-cell tumors.',
    },
    {
      code: '34071-1',
      title: 'WARNINGS AND PRECAUTIONS',
      text: 'Monitor for signs of pancreatitis.',
    },
    {
      code: '34067-9',
      title: 'INDICATIONS AND USAGE',
      text: 'Indicated as adjunct to diet and exercise.',
    },
    {
      code: '34068-7',
      title: 'DOSAGE AND ADMINISTRATION',
      text: 'Initial dose: 2.5 mg weekly.',
    },
    {
      code: '51945-4',
      title: 'PACKAGE LABEL',
      text: 'Label content not relevant to clinical use.',
    },
  ],
};

const TOPIC_TAG = 'tirzepatide';
const TOPIC_ID = 'aaa-topic-id';
const SOURCE_ID = 'bbb-source-id';

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('DailyMedSPLSchema', () => {
  it('T1: parses a valid SPL fixture', () => {
    const result = DailyMedSPLSchema.safeParse(VALID_SPL);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.setid).toBe('abc-setid-001');
      expect(result.data.spl_version).toBe(3);
      expect(result.data.sections).toHaveLength(5);
    }
  });

  it('T2a: missing setid → zod throws', () => {
    const withoutSetid = { ...VALID_SPL, setid: '' };
    const result = DailyMedSPLSchema.safeParse(withoutSetid);
    expect(result.success).toBe(false);
  });

  it('T2b: spl_version = 0 (non-positive) → zod throws', () => {
    const withBadVersion = { ...VALID_SPL, spl_version: 0 };
    const result = DailyMedSPLSchema.safeParse(withBadVersion);
    expect(result.success).toBe(false);
  });
});

describe('normalizeDailyMed', () => {
  it('T3: filters to LOINC-relevant sections and preserves boxed warning', async () => {
    const spl = DailyMedSPLSchema.parse(VALID_SPL);
    const payload = await normalizeDailyMed(spl, TOPIC_TAG, TOPIC_ID, SOURCE_ID);

    expect(payload.source_tier).toBe('A');
    expect(payload.status).toBe('queued');
    expect(payload.topic_tag).toBe(TOPIC_TAG);
    expect(payload.topic_id).toBe(TOPIC_ID);
    expect(payload.source_id).toBe(SOURCE_ID);
    expect(payload.created_by).toBe(SYSTEM_FEDERATED_UUID);
    expect(payload.content_hash).toMatch(/^[0-9a-f]{64}$/);

    // Boxed warning MUST be in excerpt (AI-SPEC §1b regulatory)
    expect(payload.source_text_excerpt).toContain('BOXED WARNING');
    expect(payload.source_text_excerpt).toContain('thyroid');

    // PACKAGE LABEL section (code 51945-4, not in LOINC set) should be excluded
    expect(payload.source_text_excerpt).not.toContain('Label content not relevant');

    // canonical_url contains setid
    expect(payload.canonical_url).toContain('abc-setid-001');
  });

  it('T4: spl_version=1 vs spl_version=2 → different content_hash (drift detection)', async () => {
    const splV1 = DailyMedSPLSchema.parse({
      ...VALID_SPL,
      spl_version: 1,
      sections: [{ code: '34066-1', title: 'BOXED WARNING', text: 'Version 1 warning text.' }],
    });
    const splV2 = DailyMedSPLSchema.parse({
      ...VALID_SPL,
      spl_version: 2,
      sections: [{ code: '34066-1', title: 'BOXED WARNING', text: 'Version 2 updated warning text.' }],
    });

    const p1 = await normalizeDailyMed(splV1, TOPIC_TAG, TOPIC_ID, SOURCE_ID);
    const p2 = await normalizeDailyMed(splV2, TOPIC_TAG, TOPIC_ID, SOURCE_ID);

    // Different text → different content_hash (G10 stale-evidence relies on this)
    expect(p1.content_hash).not.toBe(p2.content_hash);
    expect(p1.source_text_excerpt).toContain('Version 1');
    expect(p2.source_text_excerpt).toContain('Version 2');
  });
});
