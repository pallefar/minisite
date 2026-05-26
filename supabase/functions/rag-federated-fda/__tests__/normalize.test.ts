/**
 * normalize.test.ts — Vitest unit tests for OpenFDA normalizer.
 *
 * Phase 60 Plan 60-07. Task 3 (TDD RED → GREEN).
 *
 * 5 tests:
 *  T1: OpenFDADrugLabelSchema parses valid label fixture → ok
 *  T2: Missing effective_time → zod throws (stale-label drift detection)
 *  T3: normalizeOpenFDADrugLabel returns correct rag_chunks payload with boxed_warning
 *  T4: OpenFDADrugEventSchema parses valid event fixture → ok
 *  T5: normalizeOpenFDADrugEvent strips PII fields (patientweight etc. NOT in excerpt)
 */

import { describe, expect, it } from 'vitest';
import {
  OpenFDADrugLabelSchema,
  OpenFDADrugEventSchema,
  normalizeOpenFDADrugLabel,
  normalizeOpenFDADrugEvent,
  parseFdaEffectiveTime,
  SYSTEM_FEDERATED_UUID,
} from '../normalize.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const VALID_LABEL = {
  set_id: 'abc123-set-id',
  version: '5',
  effective_time: '20260526',
  openfda: {
    brand_name: ['Mounjaro'],
    generic_name: ['tirzepatide'],
  },
  boxed_warning: ['WARNING: Risk of thyroid C-cell tumors. Do not use in patients with MEN2.'],
  warnings: ['Monitor for pancreatitis. Discontinue if suspected.'],
  indications_and_usage: ['Indicated as an adjunct to diet and exercise to improve glycemic control.'],
  dosage_and_administration: ['Initial dose 2.5 mg weekly.'],
};

const VALID_EVENT = {
  safetyreportid: 'US-12345678',
  receivedate: '20260526',
  patient: {
    drug: [
      { medicinalproduct: 'MOUNJARO', drugindication: 'TYPE 2 DIABETES MELLITUS' },
    ],
    reaction: [
      { reactionmeddrapt: 'Nausea' },
      { reactionmeddrapt: 'Vomiting' },
    ],
    // These PII fields exist in real FDA data but MUST NOT appear in normalized output:
    patientonsetage: '45',
    patientweight: '85',
    patientsex: '2',
    patientonsetagegroup: '5',
  },
};

const TOPIC_TAG = 'tirzepatide';
const TOPIC_ID = '11111111-1111-1111-1111-111111111111';
const SOURCE_ID = '33333333-3333-3333-3333-333333333333';

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('OpenFDADrugLabelSchema', () => {
  it('T1: parses a valid drug label fixture', () => {
    const result = OpenFDADrugLabelSchema.safeParse(VALID_LABEL);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.set_id).toBe('abc123-set-id');
      expect(result.data.effective_time).toBe('20260526');
      expect(result.data.boxed_warning?.[0]).toContain('thyroid');
    }
  });

  it('T2: missing effective_time → zod validation fails', () => {
    const withoutDate = { ...VALID_LABEL, effective_time: '' };
    const result = OpenFDADrugLabelSchema.safeParse(withoutDate);
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = result.error.format();
      expect(formatted.effective_time?._errors).toBeDefined();
    }
  });
});

describe('normalizeOpenFDADrugLabel', () => {
  it('T3: returns rag_chunks payload with boxed_warning preserved', async () => {
    const label = OpenFDADrugLabelSchema.parse(VALID_LABEL);
    const payload = await normalizeOpenFDADrugLabel(label, TOPIC_TAG, TOPIC_ID, SOURCE_ID);

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

    // Evidence date from effective_time
    expect(payload.canonical_url).toContain('abc123-set-id');
  });
});

describe('OpenFDADrugEventSchema', () => {
  it('T4: parses a valid adverse event fixture', () => {
    const result = OpenFDADrugEventSchema.safeParse(VALID_EVENT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.safetyreportid).toBe('US-12345678');
      expect(result.data.patient.drug?.[0]?.medicinalproduct).toBe('MOUNJARO');
      expect(result.data.patient.reaction?.[0]?.reactionmeddrapt).toBe('Nausea');
    }
  });
});

describe('normalizeOpenFDADrugEvent — PII guard', () => {
  it('T5: strips patient demographic fields (allowlist-based PII guard)', async () => {
    const event = OpenFDADrugEventSchema.parse(VALID_EVENT);
    const payload = await normalizeOpenFDADrugEvent(event, TOPIC_TAG, TOPIC_ID, SOURCE_ID);

    // Reaction terms and drug names ARE included
    expect(payload.source_text_excerpt).toContain('Nausea');
    expect(payload.source_text_excerpt).toContain('MOUNJARO');

    // PII fields MUST NOT appear in the excerpt (T-60-07-03)
    // These were in the original VALID_EVENT.patient object but should not be visible
    expect(payload.source_text_excerpt).not.toContain('85'); // patientweight = 85
    expect(payload.source_text_excerpt).not.toContain('patientweight');
    expect(payload.source_text_excerpt).not.toContain('patientonsetage');
    expect(payload.source_text_excerpt).not.toContain('patientsex');
    expect(payload.source_text_excerpt).not.toContain('patientonsetagegroup');

    expect(payload.source_tier).toBe('A');
    expect(payload.status).toBe('queued');
    expect(payload.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('parseFdaEffectiveTime', () => {
  it('parses YYYYMMDD to ISO date string', () => {
    expect(parseFdaEffectiveTime('20260526')).toBe('2026-05-26');
    expect(parseFdaEffectiveTime('20230101')).toBe('2023-01-01');
  });
});
