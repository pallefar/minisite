/**
 * eval/phase60/dimensions/retrieval-recall.ts — Retrieval recall eval dimension.
 *
 * Phase 60 Plan 60-06. AI-SPEC §5 Dim #2 + #3.
 *
 * Implements `--suite=retrieval` for eval/phase60/run.ts.
 * Computes recall@5, recall@10, MRR against gold-set labeled relevant_chunk_ids.
 *
 * Pass criteria (AI-SPEC §5):
 *   recall_at_5_mean  >= 0.80 (Dim #2)
 *   recall_at_10_mean >= 0.92 (Dim #2)
 *   mrr_mean          >= 0.65 (Dim #3)
 *
 * NOTE: The main Phase 60 eval harness lives at tests/eval/phase60/ (Vitest/Node.js).
 * This Deno-native dimension module imports the handler directly and is consumed
 * by eval/phase60/run.ts --suite=retrieval.
 */

import { handler } from '../../../supabase/functions/rag-retrieve/index.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface GoldExample {
  id: string;
  query: string;
  topic_tag?: string;
  relevant_chunk_ids?: string[];
  expected_refusal?: { reason: string } | null;
}

export interface EvalRunArgs {
  provider?: 'cohere' | 'jina';
  suite?: string;
  goldSetPath?: string;
  /** Injectable retrieval function for tests. Defaults to calling the Edge Fn handler. */
  retrieveFn?: (query: string, k: number, topicTag?: string) => Promise<string[]>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Metric helpers
// ──────────────────────────────────────────────────────────────────────────────

function recallAtK(retrievedIds: string[], relevantIds: string[], k: number): number {
  if (relevantIds.length === 0) return 1.0; // vacuously true for examples without labels
  const topK = new Set(retrievedIds.slice(0, k));
  const hits = relevantIds.filter((id) => topK.has(id)).length;
  return hits / relevantIds.length;
}

function computeMRR(retrievedIds: string[], relevantIds: string[]): number {
  const relevantSet = new Set(relevantIds);
  for (let i = 0; i < retrievedIds.length; i++) {
    if (relevantSet.has(retrievedIds[i])) {
      return 1.0 / (i + 1);
    }
  }
  return 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// Default retrieval via handler import
// ──────────────────────────────────────────────────────────────────────────────

async function defaultRetrieveFn(
  query: string,
  k: number,
  topicTag?: string,
): Promise<string[]> {
  const req = new Request('http://local/rag-retrieve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query,
      k,
      filters: topicTag ? { topic_tag: topicTag } : undefined,
    }),
  });
  const resp = await handler(req);
  const data = (await resp.json()) as {
    refused?: boolean;
    results?: Array<{ chunk_id: string }>;
  };
  if (data.refused) return [];
  return (data.results ?? []).map((r) => r.chunk_id);
}

// ──────────────────────────────────────────────────────────────────────────────
// Load gold-set from JSONL file
// ──────────────────────────────────────────────────────────────────────────────

async function loadGoldSet(goldSetPath: string): Promise<GoldExample[]> {
  let text: string;
  try {
    text = await Deno.readTextFile(goldSetPath);
  } catch (err) {
    throw new Error(
      `[retrieval-recall] Cannot read gold-set at "${goldSetPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return text
    .split('\n')
    .filter((l) => l.trim().length > 0 && !l.trim().startsWith('//'))
    .map((l, i) => {
      try {
        return JSON.parse(l) as GoldExample;
      } catch (e) {
        throw new Error(`[retrieval-recall] JSON parse error at line ${i + 1}: ${e}`);
      }
    });
}

// ──────────────────────────────────────────────────────────────────────────────
// Main run function
// ──────────────────────────────────────────────────────────────────────────────

export default async function run(
  args: EvalRunArgs = {},
): Promise<{ pass: boolean; metrics: Record<string, number>; failures: string[] }> {
  const goldSetPath =
    args.goldSetPath ??
    (typeof Deno !== 'undefined'
      ? Deno.env.get('PHASE60_GOLD_SET_PATH') ?? './eval/phase60/gold-set.jsonl'
      : './eval/phase60/gold-set.jsonl');

  const retrieveFn = args.retrieveFn ?? defaultRetrieveFn;

  const examples = await loadGoldSet(goldSetPath);
  const labeled = examples.filter(
    (ex) => ex.relevant_chunk_ids && ex.relevant_chunk_ids.length > 0 && !ex.expected_refusal,
  );

  if (labeled.length === 0) {
    return {
      pass: false,
      metrics: { recall_at_5_mean: 0, recall_at_10_mean: 0, mrr_mean: 0 },
      failures: ['No labeled examples with relevant_chunk_ids found in gold-set'],
    };
  }

  const perExampleMetrics: Array<{ recall5: number; recall10: number; mrr: number; id: string }> =
    [];
  const failures: string[] = [];
  const perTopicTag: Record<string, number[]> = {};

  for (const example of labeled) {
    const relevantIds = example.relevant_chunk_ids ?? [];
    let retrievedIds: string[] = [];

    try {
      retrievedIds = await retrieveFn(example.query, 10, example.topic_tag);
    } catch (err) {
      failures.push(`${example.id}: retrieval failed — ${err instanceof Error ? err.message : String(err)}`);
      perExampleMetrics.push({ recall5: 0, recall10: 0, mrr: 0, id: example.id });
      continue;
    }

    const recall5 = recallAtK(retrievedIds, relevantIds, 5);
    const recall10 = recallAtK(retrievedIds, relevantIds, 10);
    const mrr = computeMRR(retrievedIds, relevantIds);

    perExampleMetrics.push({ recall5, recall10, mrr, id: example.id });

    // Per-topic breakdown
    const tag = example.topic_tag ?? 'unknown';
    if (!perTopicTag[tag]) perTopicTag[tag] = [];
    perTopicTag[tag].push(recall5);

    // Record failures
    if (recall5 < 0.8 || recall10 < 0.92 || mrr < 0.65) {
      failures.push(
        `${example.id}: recall@5=${recall5.toFixed(3)} recall@10=${recall10.toFixed(3)} mrr=${mrr.toFixed(3)} (below threshold)`,
      );
    }
  }

  const n = perExampleMetrics.length;
  const recall_at_5_mean = perExampleMetrics.reduce((s, m) => s + m.recall5, 0) / n;
  const recall_at_10_mean = perExampleMetrics.reduce((s, m) => s + m.recall10, 0) / n;
  const mrr_mean = perExampleMetrics.reduce((s, m) => s + m.mrr, 0) / n;

  // Per-topic metrics
  const perTopicMetrics: Record<string, number> = {};
  for (const [tag, scores] of Object.entries(perTopicTag)) {
    perTopicMetrics[`recall_at_5_${tag}`] = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  const pass = recall_at_5_mean >= 0.80 && recall_at_10_mean >= 0.92 && mrr_mean >= 0.65;

  return {
    pass,
    metrics: {
      recall_at_5_mean,
      recall_at_10_mean,
      mrr_mean,
      n_examples: n,
      ...perTopicMetrics,
    },
    failures,
  };
}
