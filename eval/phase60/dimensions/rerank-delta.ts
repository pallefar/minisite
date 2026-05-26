/**
 * eval/phase60/dimensions/rerank-delta.ts — Rerank precision-delta eval dimension.
 *
 * Phase 60 Plan 60-06. AI-SPEC §5 Dim #4.
 *
 * Implements `--suite=rerank-delta` for eval/phase60/run.ts.
 * Computes precision@5 for (a) raw cosine only vs (b) full rerank pipeline.
 * Pass criteria: delta_p5 >= +0.10 absolute (AI-SPEC §5 Dim #4 + success criterion #3).
 *
 * Pipeline A (cosine-only): uses ?cosine_only=1 query param (Task 7 back-edit).
 * Pipeline B (rerank): full pipeline per RAG_RERANKER_PROVIDER env.
 *
 * Bootstrap CI: 1000 resamples of (B.p5 - A.p5) per example → 95% CI on delta.
 */

import type { GoldExample, EvalRunArgs } from './retrieval-recall.ts';
import { handler } from '../../../supabase/functions/rag-retrieve/index.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Metric helpers
// ──────────────────────────────────────────────────────────────────────────────

function precisionAtK(retrievedIds: string[], relevantIds: string[], k: number): number {
  if (relevantIds.length === 0 || k === 0) return 0;
  const relevantSet = new Set(relevantIds);
  const hits = retrievedIds.slice(0, k).filter((id) => relevantSet.has(id)).length;
  return hits / k;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Bootstrap 95% confidence interval on delta values. */
function bootstrapCI(
  deltas: number[],
  nResamples = 1000,
): { ci_low: number; ci_high: number } {
  if (deltas.length === 0) return { ci_low: 0, ci_high: 0 };
  const resampleMeans: number[] = [];
  for (let i = 0; i < nResamples; i++) {
    let s = 0;
    for (let j = 0; j < deltas.length; j++) {
      s += deltas[Math.floor(Math.random() * deltas.length)];
    }
    resampleMeans.push(s / deltas.length);
  }
  resampleMeans.sort((a, b) => a - b);
  const lo = Math.floor(0.025 * nResamples);
  const hi = Math.ceil(0.975 * nResamples) - 1;
  return {
    ci_low: resampleMeans[lo] ?? resampleMeans[0],
    ci_high: resampleMeans[hi] ?? resampleMeans[resampleMeans.length - 1],
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Pipeline A and B helpers
// ──────────────────────────────────────────────────────────────────────────────

async function retrieveCosineOnly(
  query: string,
  k: number,
  topicTag?: string,
  retrieveFn?: (query: string, k: number, topicTag?: string, cosineOnly?: boolean) => Promise<string[]>,
): Promise<string[]> {
  if (retrieveFn) {
    return retrieveFn(query, k, topicTag, true);
  }
  const req = new Request('http://local/rag-retrieve?cosine_only=1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query,
      k,
      filters: topicTag ? { topic_tag: topicTag } : undefined,
    }),
  });
  const resp = await handler(req);
  const data = (await resp.json()) as { refused?: boolean; results?: Array<{ chunk_id: string }> };
  if (data.refused) return [];
  return (data.results ?? []).map((r) => r.chunk_id);
}

async function retrieveWithRerank(
  query: string,
  k: number,
  topicTag?: string,
  retrieveFn?: (query: string, k: number, topicTag?: string, cosineOnly?: boolean) => Promise<string[]>,
): Promise<string[]> {
  if (retrieveFn) {
    return retrieveFn(query, k, topicTag, false);
  }
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
  const data = (await resp.json()) as { refused?: boolean; results?: Array<{ chunk_id: string }> };
  if (data.refused) return [];
  return (data.results ?? []).map((r) => r.chunk_id);
}

// ──────────────────────────────────────────────────────────────────────────────
// Load gold-set (reused from retrieval-recall)
// ──────────────────────────────────────────────────────────────────────────────

async function loadGoldSet(goldSetPath: string): Promise<GoldExample[]> {
  let text: string;
  try {
    text = await Deno.readTextFile(goldSetPath);
  } catch (err) {
    throw new Error(
      `[rerank-delta] Cannot read gold-set at "${goldSetPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return text
    .split('\n')
    .filter((l) => l.trim().length > 0 && !l.trim().startsWith('//'))
    .map((l, i) => {
      try {
        return JSON.parse(l) as GoldExample;
      } catch (e) {
        throw new Error(`[rerank-delta] JSON parse error at line ${i + 1}: ${e}`);
      }
    });
}

// ──────────────────────────────────────────────────────────────────────────────
// Extended args for rerank-delta
// ──────────────────────────────────────────────────────────────────────────────

export interface RerankDeltaArgs extends EvalRunArgs {
  /** Injectable retrieve function. Args: (query, k, topicTag, cosineOnly) → chunk IDs. */
  retrieveFn?: (query: string, k: number, topicTag?: string, cosineOnly?: boolean) => Promise<string[]>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main run function
// ──────────────────────────────────────────────────────────────────────────────

export default async function run(
  args: RerankDeltaArgs = {},
): Promise<{ pass: boolean; metrics: Record<string, number>; failures: string[] }> {
  const goldSetPath =
    args.goldSetPath ??
    (typeof Deno !== 'undefined'
      ? Deno.env.get('PHASE60_GOLD_SET_PATH') ?? './eval/phase60/gold-set.jsonl'
      : './eval/phase60/gold-set.jsonl');

  const examples = await loadGoldSet(goldSetPath);
  const labeled = examples.filter(
    (ex) => ex.relevant_chunk_ids && ex.relevant_chunk_ids.length > 0 && !ex.expected_refusal,
  );

  if (labeled.length === 0) {
    return {
      pass: false,
      metrics: { delta_p5: 0, cohere_p5_mean: 0, cosine_p5_mean: 0 },
      failures: ['No labeled examples with relevant_chunk_ids found in gold-set'],
    };
  }

  const deltas: number[] = [];
  const failures: string[] = [];
  let cosineP5Total = 0;
  let rerankP5Total = 0;

  for (const example of labeled) {
    const relevantIds = example.relevant_chunk_ids ?? [];

    let cosineIds: string[] = [];
    let rerankIds: string[] = [];

    try {
      [cosineIds, rerankIds] = await Promise.all([
        retrieveCosineOnly(example.query, 5, example.topic_tag, args.retrieveFn),
        retrieveWithRerank(example.query, 5, example.topic_tag, args.retrieveFn),
      ]);
    } catch (err) {
      failures.push(`${example.id}: retrieval failed — ${err instanceof Error ? err.message : String(err)}`);
      deltas.push(0);
      continue;
    }

    const cosineP5 = precisionAtK(cosineIds, relevantIds, 5);
    const rerankP5 = precisionAtK(rerankIds, relevantIds, 5);
    const delta = rerankP5 - cosineP5;

    deltas.push(delta);
    cosineP5Total += cosineP5;
    rerankP5Total += rerankP5;

    if (delta < 0) {
      failures.push(
        `${example.id}: rerank HURT precision@5 (cosine=${cosineP5.toFixed(3)} rerank=${rerankP5.toFixed(3)} delta=${delta.toFixed(3)})`,
      );
    }
  }

  const n = labeled.length;
  const delta_p5 = mean(deltas);
  const cohere_p5_mean = rerankP5Total / n;
  const cosine_p5_mean = cosineP5Total / n;

  // Bootstrap 95% CI
  const { ci_low, ci_high } = bootstrapCI(deltas, 1000);

  // MRR delta and recall@5 delta (diagnostic)
  const delta_mrr = 0; // diagnostic: requires separate MRR computation per pipeline (TODO: wire in follow-up)
  const delta_recall_at_5 = 0; // diagnostic: simplification; precision@5 is the primary gate

  const pass = delta_p5 >= 0.10;

  if (delta_p5 < 0.10) {
    failures.push(
      `Overall: delta_p5=${delta_p5.toFixed(3)} < required 0.10 (cohere_p5=${cohere_p5_mean.toFixed(3)} cosine_p5=${cosine_p5_mean.toFixed(3)})`,
    );
  }

  return {
    pass,
    metrics: {
      delta_p5,
      cohere_p5_mean,
      cosine_p5_mean,
      delta_mrr,
      delta_recall_at_5,
      ci_low,
      ci_high,
      n_examples: n,
    },
    failures,
  };
}
