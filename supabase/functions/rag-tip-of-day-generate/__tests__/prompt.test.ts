/**
 * prompt.test.ts — Deno unit tests for prompt.ts
 *
 * Phase 60 Plan 60-11 Task 3 (TDD RED → GREEN).
 *
 * Verifies: system-prompt shape (chunk injection, non-prescriptive clause,
 * verbatim-substring contract), user-prompt AI-04 fence behavior,
 * no-fence when no user context, token budget.
 *
 * Run: $HOME/.deno/bin/deno test --no-check --allow-env __tests__/prompt.test.ts
 */

import { assertEquals, assertMatch, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildTipSystemPrompt, buildTipUserPrompt } from '../prompt.ts';
import type { RagRetrievedChunk } from '../../_shared/rag-retrieve.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Test fixture
// ──────────────────────────────────────────────────────────────────────────────

const typicalChunk: RagRetrievedChunk = {
  chunk_id: '11111111-1111-1111-1111-111111111111',
  source_id: '22222222-2222-2222-2222-222222222222',
  source_type: 'fda_label',
  tier: 'A',
  topic_tag: 'glp1-mechanism',
  source_text_excerpt:
    'GLP-1 receptor agonists slow gastric emptying, which can affect oral medication absorption timing and overall gastrointestinal motility in clinical trials.',
  summary: 'GLP-1 receptor agonists affect gastric emptying and oral drug absorption.',
  similarity: 0.9,
  rerank_score: 0.95,
  evidence_date: '2024-01-15',
  freshness_reweight_applied: false,
  public_visibility: true,
};

// ──────────────────────────────────────────────────────────────────────────────
// Test 1: chunk_id present in system prompt exactly once
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('buildTipSystemPrompt includes chunk id exactly once', () => {
  const prompt = buildTipSystemPrompt(typicalChunk);
  const tag = `<chunk id="${typicalChunk.chunk_id}"`;
  const occurrences = prompt.split(tag).length - 1;
  assertEquals(occurrences, 1);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 2: non-prescriptive clause + 1-sentence/30-word cap
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('buildTipSystemPrompt contains "informational, NOT prescriptive"', () => {
  const prompt = buildTipSystemPrompt(typicalChunk);
  assertEquals(prompt.includes('informational, NOT prescriptive'), true);
});

Deno.test('buildTipSystemPrompt contains "1 sentence, max 30 words"', () => {
  const prompt = buildTipSystemPrompt(typicalChunk);
  assertEquals(prompt.includes('1 sentence, max 30 words'), true);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 3: verbatim-substring contract clause
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('buildTipSystemPrompt contains verbatim-substring contract clause', () => {
  const prompt = buildTipSystemPrompt(typicalChunk);
  assertEquals(prompt.includes('must be a verbatim substring of the chunk text'), true);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 4: user_data fence wraps user_drug + active_themes
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('buildTipUserPrompt wraps user_drug + active_themes in <user_data> fence', () => {
  const prompt = buildTipUserPrompt({
    user_drug: 'tirzepatide',
    active_themes: ['muscle-loss'],
    query: 'summarize one insight',
  });
  assertMatch(prompt, /<user_data>\n[\s\S]*tirzepatide[\s\S]*muscle-loss[\s\S]*<\/user_data>/);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 5: no user_data fence when user_drug=null and active_themes=[]
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('buildTipUserPrompt has no <user_data> fence when no user context', () => {
  const prompt = buildTipUserPrompt({
    user_drug: null,
    active_themes: [],
  });
  assertEquals(prompt.includes('<user_data>'), false);
  assertEquals(prompt.includes('</user_data>'), false);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 6: system prompt token budget (rough: length / 4 < 1200)
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('buildTipSystemPrompt token budget is within ~1200 tokens', () => {
  const prompt = buildTipSystemPrompt(typicalChunk);
  const roughTokenEstimate = prompt.length / 4;
  assertEquals(roughTokenEstimate < 1200, true);
});
