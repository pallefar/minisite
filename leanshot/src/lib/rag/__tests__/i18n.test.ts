/**
 * Phase 60 Plan 60-10 Task 1 — RAG i18n namespace tests.
 *
 * Run: npx vitest run --config vite.config.ts src/lib/rag/__tests__/i18n.test.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { RAG_I18N_KEYS, RAG_REFUSAL_KIND_TO_KEY, useRagTranslation } from '../i18n';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function loadJson(lang: string): Record<string, unknown> {
  const filePath = resolve(__dirname, '../../../../public/locales', lang, 'rag.json');
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

/** Recursively walk a nested object and resolve a dot-path key. */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[segment];
  }, obj);
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('RAG_I18N_KEYS exhaustiveness', () => {
  const en = loadJson('en');
  const es = loadJson('es');

  // Test 1: every key in RAG_I18N_KEYS exists in BOTH en and es rag.json
  it('all keys exist in en/rag.json', () => {
    for (const key of RAG_I18N_KEYS) {
      const val = getNestedValue(en, key);
      expect(val, `Missing EN key: ${key}`).toBeDefined();
      expect(typeof val, `EN key ${key} is not a string`).toBe('string');
    }
  });

  it('all keys exist in es/rag.json', () => {
    for (const key of RAG_I18N_KEYS) {
      const val = getNestedValue(es, key);
      expect(val, `Missing ES key: ${key}`).toBeDefined();
      expect(typeof val, `ES key ${key} is not a string`).toBe('string');
    }
  });
});

describe('PHARMA-02 locked copy (UI-SPEC invariant 3 — Phase 39 39-02 D-06)', () => {
  // Test 2: rag.refusal.pharma_02 EN value is BYTE-EXACT to the locked string
  it('rag.refusal.pharma_02 is the EXACT locked string', () => {
    const en = loadJson('en');
    const val = getNestedValue(en, 'refusal.pharma_02');
    expect(val).toBe('That topic requires clinician guidance — please ask your doctor.');
  });
});

describe('Disclaimer copy (UI-SPEC §3)', () => {
  // Test 3: rag.disclaimer EN value is the exact UI-SPEC §3 string
  it('rag.disclaimer is the exact UI-SPEC §3 string', () => {
    const en = loadJson('en');
    const val = getNestedValue(en, 'disclaimer');
    expect(val).toBe('Not medical advice — consult your clinician.');
  });
});

describe('attribution ICU interpolation', () => {
  // Test 4: attribution key accepts {source_name}, {date}, {tier} params
  it('rag.attribution is an ICU-format string with source_name, date, tier placeholders', () => {
    const en = loadJson('en');
    const val = getNestedValue(en, 'attribution') as string;
    expect(val).toContain('{{source_name}}');
    expect(val).toContain('{{date}}');
    expect(val).toContain('{{tier}}');
  });
});

describe('ES file structural parity', () => {
  // Test 5: ES file has the same key set as EN
  it('es/rag.json has the same key set as en/rag.json', () => {
    const en = loadJson('en');
    const es = loadJson('es');

    function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
      const keys: string[] = [];
      for (const [k, v] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'object' && v !== null) {
          keys.push(...collectKeys(v as Record<string, unknown>, fullKey));
        } else {
          keys.push(fullKey);
        }
      }
      return keys;
    }

    const enKeys = collectKeys(en).sort();
    const esKeys = collectKeys(es).sort();
    expect(esKeys).toEqual(enKeys);
  });
});

describe('useRagTranslation hook', () => {
  // Test 6: useRagTranslation is a function (thin wrapper around useTranslation('rag'))
  it('useRagTranslation is exported as a function', () => {
    expect(typeof useRagTranslation).toBe('function');
  });

  it('RAG_REFUSAL_KIND_TO_KEY maps all three kinds to string keys', () => {
    expect(RAG_REFUSAL_KIND_TO_KEY.pharma_02).toBe('refusal.pharma_02');
    expect(RAG_REFUSAL_KIND_TO_KEY.out_of_corpus).toBe('refusal.out_of_corpus');
    expect(RAG_REFUSAL_KIND_TO_KEY.citation_validation_failed).toBe('refusal.citation_validation_failed');
  });
});
