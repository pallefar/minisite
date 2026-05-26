/**
 * normalize.test.ts — Vitest unit tests for PubMed normalizer.
 *
 * Phase 60 Plan 60-07. Task 2 (TDD RED → GREEN).
 *
 * 4 tests:
 *  T1: PubMedArticleSchema parses valid article fixture → ok
 *  T2: Missing required title → zod throws TypeValidationError
 *  T3: normalizePubMedArticle returns correct rag_chunks insert payload
 *  T4: Null abstract → source_text_excerpt = title only (no trailing newlines)
 */

import { describe, expect, it } from 'vitest';
import {
  PubMedArticleSchema,
  normalizePubMedArticle,
  SYSTEM_FEDERATED_UUID,
} from '../normalize.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const VALID_ARTICLE = {
  pmid: '12345678',
  title: 'Tirzepatide Efficacy in Type 2 Diabetes: A Randomized Trial',
  abstract: 'Background: Tirzepatide is a dual GIP/GLP-1 receptor agonist. Methods: Randomized. Results: Significant HbA1c reduction. Conclusion: Effective.',
  authors: ['Smith J', 'Doe A'],
  journal: 'NEJM',
  year: '2026',
  doi: '10.1056/NEJMoa2100000',
  mesh_terms: ['Tirzepatide', 'GLP-1', 'Diabetes Mellitus Type 2'],
};

const TOPIC_TAG = 'tirzepatide';
const TOPIC_ID = '11111111-1111-1111-1111-111111111111';
const SOURCE_ID = '22222222-2222-2222-2222-222222222222';

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('PubMedArticleSchema', () => {
  it('T1: parses a valid article fixture successfully', () => {
    const result = PubMedArticleSchema.safeParse(VALID_ARTICLE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pmid).toBe('12345678');
      expect(result.data.title).toBe(VALID_ARTICLE.title);
      expect(result.data.abstract).toBe(VALID_ARTICLE.abstract);
      expect(result.data.year).toBe('2026');
      expect(result.data.mesh_terms).toContain('GLP-1');
    }
  });

  it('T2: missing required title → zod validation fails', () => {
    const withoutTitle = { ...VALID_ARTICLE, title: '' };
    const result = PubMedArticleSchema.safeParse(withoutTitle);
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = result.error.format();
      expect(formatted.title?._errors).toBeDefined();
    }
  });

  it('T2b: missing pmid → zod validation fails', () => {
    const withoutPmid = { ...VALID_ARTICLE, pmid: '' };
    const result = PubMedArticleSchema.safeParse(withoutPmid);
    expect(result.success).toBe(false);
  });
});

describe('normalizePubMedArticle', () => {
  it('T3: returns correct rag_chunks insert payload shape', async () => {
    const article = PubMedArticleSchema.parse(VALID_ARTICLE);
    const payload = await normalizePubMedArticle(article, TOPIC_TAG, TOPIC_ID, SOURCE_ID);

    expect(payload.canonical_url).toBe(`https://pubmed.ncbi.nlm.nih.gov/${VALID_ARTICLE.pmid}/`);
    expect(payload.source_tier).toBe('A');
    expect(payload.status).toBe('queued');
    expect(payload.topic_tag).toBe(TOPIC_TAG);
    expect(payload.topic_id).toBe(TOPIC_ID);
    expect(payload.source_id).toBe(SOURCE_ID);
    expect(payload.created_by).toBe(SYSTEM_FEDERATED_UUID);
    expect(payload.content_hash).toMatch(/^[0-9a-f]{64}$/);

    // source_text_excerpt = title + '\n\n' + abstract
    expect(payload.source_text_excerpt).toBe(
      `${VALID_ARTICLE.title}\n\n${VALID_ARTICLE.abstract}`,
    );
    expect(payload.scraped_at).toBeDefined();
  });

  it('T4: null abstract → source_text_excerpt = title only (no trailing newlines)', async () => {
    const noAbstractArticle = PubMedArticleSchema.parse({ ...VALID_ARTICLE, abstract: null });
    const payload = await normalizePubMedArticle(noAbstractArticle, TOPIC_TAG, TOPIC_ID, SOURCE_ID);

    expect(payload.source_text_excerpt).toBe(VALID_ARTICLE.title);
    expect(payload.source_text_excerpt).not.toContain('\n\n');
  });

  it('content_hash is deterministic for same excerpt', async () => {
    const article = PubMedArticleSchema.parse(VALID_ARTICLE);
    const p1 = await normalizePubMedArticle(article, TOPIC_TAG, TOPIC_ID, SOURCE_ID);
    const p2 = await normalizePubMedArticle(article, TOPIC_TAG, TOPIC_ID, SOURCE_ID);
    expect(p1.content_hash).toBe(p2.content_hash);
  });
});
