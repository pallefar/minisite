/**
 * eval-dimensions.test.ts — Unit tests for retrieval-recall + rerank-delta eval dimensions.
 *
 * Phase 60 Plan 60-06. 5 test cases (2 retrieval-recall + 3 rerank-delta).
 *
 * Uses injected retrieve functions (mock) to avoid needing live Fn or local Supabase stack.
 * Tests verify the metric computation logic, not live retrieval.
 */

import runRetrievalRecall from '../dimensions/retrieval-recall.ts';
import runRerankDelta from '../dimensions/rerank-delta.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Gold-set stub factory
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Write a minimal in-memory gold-set JSONL to a temp file.
 * Returns the file path.
 */
async function writeGoldSetTemp(
  examples: Array<{
    id: string;
    query: string;
    topic_tag?: string;
    relevant_chunk_ids?: string[];
  }>,
): Promise<string> {
  const lines = examples.map((ex) =>
    JSON.stringify({
      id: ex.id,
      bucket: 'titration',
      topic_tag: ex.topic_tag ?? 'titration_semaglutide',
      query: ex.query,
      relevant_chunk_ids: ex.relevant_chunk_ids ?? [],
      labels: {
        author: 'leanshot_internal',
        labeled_at: '2026-05-26',
      },
    }),
  );
  const path = `/tmp/eval-dim-test-${Date.now()}.jsonl`;
  await Deno.writeTextFile(path, lines.join('\n') + '\n');
  return path;
}

// ──────────────────────────────────────────────────────────────────────────────
// retrieval-recall tests
// ──────────────────────────────────────────────────────────────────────────────

Deno.test({ name: 'retrieval-recall: pass on synthetic gold-set with high-overlap mock retrieval', sanitizeOps: false, fn: async () => {
  const examples = [
    { id: 'q-001', query: 'semaglutide dosing', relevant_chunk_ids: ['chunk-A', 'chunk-B'] },
    { id: 'q-002', query: 'tirzepatide titration', relevant_chunk_ids: ['chunk-C', 'chunk-D'] },
    { id: 'q-003', query: 'GLP-1 side effects', relevant_chunk_ids: ['chunk-E'] },
  ];

  const goldSetPath = await writeGoldSetTemp(examples);

  // Mock: returns relevant chunks in top-3 (100% recall)
  const mockRetrieve = async (query: string, _k: number): Promise<string[]> => {
    if (query.includes('semaglutide')) return ['chunk-A', 'chunk-B', 'chunk-X'];
    if (query.includes('tirzepatide')) return ['chunk-C', 'chunk-D', 'chunk-Y'];
    return ['chunk-E', 'chunk-F'];
  };

  const result = await runRetrievalRecall({ goldSetPath, retrieveFn: mockRetrieve });

  if (!result.pass) throw new Error(`Expected pass=true; got pass=${result.pass}. Metrics: ${JSON.stringify(result.metrics)}`);
  if (result.metrics.recall_at_5_mean !== 1.0) {
    throw new Error(`Expected recall_at_5_mean=1.0; got ${result.metrics.recall_at_5_mean}`);
  }
  if (result.metrics.mrr_mean !== 1.0) {
    throw new Error(`Expected mrr_mean=1.0; got ${result.metrics.mrr_mean}`);
  }
} });

Deno.test({ name: 'retrieval-recall: fail when recall_at_5_mean < 0.80', sanitizeOps: false, fn: async () => {
  const examples = [
    { id: 'q-001', query: 'semaglutide dosing', relevant_chunk_ids: ['chunk-A', 'chunk-B', 'chunk-C', 'chunk-D', 'chunk-E'] },
    { id: 'q-002', query: 'tirzepatide titration', relevant_chunk_ids: ['chunk-F', 'chunk-G', 'chunk-H'] },
  ];

  const goldSetPath = await writeGoldSetTemp(examples);

  // Mock: returns NONE of the relevant chunks (0% recall)
  const mockRetrieve = async (_query: string, _k: number): Promise<string[]> => {
    return ['chunk-Z1', 'chunk-Z2', 'chunk-Z3', 'chunk-Z4', 'chunk-Z5'];
  };

  const result = await runRetrievalRecall({ goldSetPath, retrieveFn: mockRetrieve });

  if (result.pass) throw new Error(`Expected pass=false (no relevant chunks retrieved); got pass=${result.pass}`);
  if (result.metrics.recall_at_5_mean !== 0) {
    throw new Error(`Expected recall_at_5_mean=0; got ${result.metrics.recall_at_5_mean}`);
  }
} });

// ──────────────────────────────────────────────────────────────────────────────
// rerank-delta tests
// ──────────────────────────────────────────────────────────────────────────────

Deno.test({ name: 'rerank-delta: pass when rerank lifts precision@5 by ≥0.10', sanitizeOps: false, fn: async () => {
  const examples = [
    { id: 'q-001', query: 'semaglutide dosing', relevant_chunk_ids: ['chunk-A', 'chunk-B', 'chunk-C'] },
    { id: 'q-002', query: 'tirzepatide side effects', relevant_chunk_ids: ['chunk-D', 'chunk-E', 'chunk-F'] },
    { id: 'q-003', query: 'GLP-1 nausea management', relevant_chunk_ids: ['chunk-G', 'chunk-H'] },
    { id: 'q-004', query: 'injection site rotation', relevant_chunk_ids: ['chunk-I'] },
    { id: 'q-005', query: 'weight loss plateau GLP-1', relevant_chunk_ids: ['chunk-J', 'chunk-K'] },
  ];

  const goldSetPath = await writeGoldSetTemp(examples);

  // cosine-only: 1/5 relevant in top-5 → precision@5 = 0.2
  // rerank: 3/5 relevant in top-5 → precision@5 = 0.6
  // delta = 0.6 - 0.2 = 0.4 → PASS
  const mockRetrieve = async (
    query: string,
    _k: number,
    _topicTag: string | undefined,
    cosineOnly?: boolean,
  ): Promise<string[]> => {
    if (query.includes('semaglutide')) {
      return cosineOnly
        ? ['chunk-X1', 'chunk-A', 'chunk-X2', 'chunk-X3', 'chunk-X4'] // 1/5 relevant
        : ['chunk-A', 'chunk-B', 'chunk-C', 'chunk-X1', 'chunk-X2']; // 3/5 relevant
    }
    if (query.includes('tirzepatide')) {
      return cosineOnly
        ? ['chunk-D', 'chunk-X5', 'chunk-X6', 'chunk-X7', 'chunk-X8'] // 1/5
        : ['chunk-D', 'chunk-E', 'chunk-F', 'chunk-X5', 'chunk-X6']; // 3/5
    }
    if (query.includes('nausea')) {
      return cosineOnly
        ? ['chunk-X9', 'chunk-G', 'chunk-X10', 'chunk-X11', 'chunk-X12'] // 1/5
        : ['chunk-G', 'chunk-H', 'chunk-X9', 'chunk-X10', 'chunk-X11']; // 2/5
    }
    // For remaining queries, rerank does better too
    return cosineOnly
      ? ['chunk-X1', 'chunk-X2', 'chunk-X3', 'chunk-X4', 'chunk-X5'] // 0/5
      : ['chunk-I', 'chunk-J', 'chunk-K', 'chunk-X1', 'chunk-X2']; // 1/5 or 2/5
  };

  const result = await runRerankDelta({ goldSetPath, retrieveFn: mockRetrieve });

  if (!result.pass) {
    throw new Error(`Expected pass=true (delta≥0.10); got delta_p5=${result.metrics.delta_p5}. Failures: ${result.failures.join('; ')}`);
  }
  if (result.metrics.delta_p5 < 0.10) {
    throw new Error(`Expected delta_p5 >= 0.10; got ${result.metrics.delta_p5}`);
  }
} });

Deno.test({ name: 'rerank-delta: fail when rerank lift < 0.10', sanitizeOps: false, fn: async () => {
  const examples = [
    { id: 'q-001', query: 'semaglutide dosing', relevant_chunk_ids: ['chunk-A', 'chunk-B'] },
    { id: 'q-002', query: 'tirzepatide effects', relevant_chunk_ids: ['chunk-C', 'chunk-D'] },
  ];

  const goldSetPath = await writeGoldSetTemp(examples);

  // Both pipelines return the same results → delta = 0 → FAIL
  const mockRetrieve = async (
    _query: string,
    _k: number,
    _topicTag?: string,
    _cosineOnly?: boolean,
  ): Promise<string[]> => {
    return ['chunk-A', 'chunk-X1', 'chunk-X2', 'chunk-X3', 'chunk-X4']; // 1/5 for both
  };

  const result = await runRerankDelta({ goldSetPath, retrieveFn: mockRetrieve });

  if (result.pass) {
    throw new Error(`Expected pass=false (delta≈0 < 0.10); got pass=${result.pass}, delta_p5=${result.metrics.delta_p5}`);
  }
  if (Math.abs(result.metrics.delta_p5) > 0.01) {
    throw new Error(`Expected delta_p5 ≈ 0; got ${result.metrics.delta_p5}`);
  }
} });

Deno.test({ name: 'rerank-delta: bootstrap CI computed', sanitizeOps: false, fn: async () => {
  const examples = [
    { id: 'q-001', query: 'semaglutide dosing', relevant_chunk_ids: ['chunk-A', 'chunk-B', 'chunk-C'] },
    { id: 'q-002', query: 'tirzepatide effects', relevant_chunk_ids: ['chunk-D', 'chunk-E'] },
    { id: 'q-003', query: 'GLP-1 nausea', relevant_chunk_ids: ['chunk-F', 'chunk-G', 'chunk-H'] },
  ];

  const goldSetPath = await writeGoldSetTemp(examples);

  const mockRetrieve = async (
    _query: string,
    _k: number,
    _topicTag?: string,
    cosineOnly?: boolean,
  ): Promise<string[]> => {
    // cosine returns 1 relevant per query; rerank returns 2-3 relevant
    if (cosineOnly) return ['chunk-A', 'chunk-X1', 'chunk-X2', 'chunk-X3', 'chunk-X4'];
    return ['chunk-A', 'chunk-B', 'chunk-C', 'chunk-X1', 'chunk-X2'];
  };

  const result = await runRerankDelta({ goldSetPath, retrieveFn: mockRetrieve });

  if (typeof result.metrics.ci_low !== 'number') {
    throw new Error(`Expected ci_low to be a number; got ${typeof result.metrics.ci_low}`);
  }
  if (typeof result.metrics.ci_high !== 'number') {
    throw new Error(`Expected ci_high to be a number; got ${typeof result.metrics.ci_high}`);
  }
  if (result.metrics.ci_low > result.metrics.delta_p5) {
    throw new Error(`Expected ci_low <= delta_p5 (${result.metrics.delta_p5}); got ci_low=${result.metrics.ci_low}`);
  }
  if (result.metrics.ci_high < result.metrics.delta_p5) {
    throw new Error(`Expected ci_high >= delta_p5 (${result.metrics.delta_p5}); got ci_high=${result.metrics.ci_high}`);
  }
} });
