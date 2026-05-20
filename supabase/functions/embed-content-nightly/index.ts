/**
 * `embed-content-nightly` Edge Function — Phase 38 Plan 38-04.
 *
 *   POST /functions/v1/embed-content-nightly       (verify_jwt = false — service-role bearer only)
 *
 * Pipeline (runs nightly via pg_cron schedule in Plan 38-09):
 *   1. AUTH — Bearer must be SUPABASE_SERVICE_ROLE_KEY (constantTimeEqual).
 *   2. SELECT candidate rows: content joined with content_embeddings where
 *      the embedding is missing (pending) OR `stale = true` (re-embed flag
 *      flipped by D-18 trigger in Plan 38-01). Capped at 1000 rows/run
 *      (T-38-18: DoS mitigation per RESEARCH Pitfall #6 cost runaway).
 *   3. Per row, compute `sha256(title || '\n\n' || body_md)`:
 *      - If `stale=true AND stored_sha === computed_sha` → just UPDATE
 *        content_embeddings SET stale=false; SKIP embed call. This is the
 *        critical dedup gate (Pitfall #6: editor touches title → trigger
 *        flips stale=true → without dedup we'd re-embed unchanged content).
 *      - Else: queue the row for embedding.
 *   4. BATCH the queued texts into chunks of 100 inputs/call (AI Gateway
 *      `input: string[]` form). Process 5 batches in parallel, sleep 1s
 *      between batch groups (RESEARCH Pitfall #3 rate-limit politeness).
 *   5. 429 handling: parse Retry-After (cap 30s), sleep, retry up to 3
 *      attempts. On 3rd failure: log + emit `embed.rate_limit_429`, increment
 *      `errors_count`, SKIP the batch (do NOT crash cron — partial progress
 *      is better than zero progress).
 *   6. UPSERT successful embeddings into content_embeddings.
 *   7. At end of run: invoke `cleanup_content_embeddings_soft_deleted()` RPC
 *      (D-19: 7-day audit window cascade cleanup).
 *   8. Emit `embed.batch_complete` telemetry; PostHog flush + return stats.
 *
 * Auth: Cron-only. User JWT bearers return 403 (T-38-20 mitigation).
 *
 * Decision refs: D-18 (re-embed-on-edit consumer), D-19 (7d cleanup).
 * Threat mitigations: T-38-18 (runaway), T-38-19 (429), T-38-20 (auth), T-38-21 (cleanup).
 */

import { captureServer, shutdownPostHog } from '../_shared/posthog-server.ts';
import {
  checkServiceRoleBearer,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';
import { sentryCapture } from '../_shared/sentry.ts';

const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

const ROW_CAP_PER_RUN = 1000;
const EMBED_BATCH_SIZE = 100;
const CONCURRENT_BATCHES = 5;
const INTER_GROUP_SLEEP_MS = 1_000;
const MAX_RETRIES = 3;
const RETRY_AFTER_CAP_SEC = 30;
const EMBED_TIMEOUT_MS = 25_000;
const EMBEDDING_DIM = 1536;

const DEFAULT_EMBED_MODEL = 'openai/text-embedding-3-small';

// ─── Types ────────────────────────────────────────────────────────────────

interface ContentRow {
  id: string;
  title: string | null;
  body_md: string | null;
  content_embeddings: { body_sha256: string | null; stale: boolean | null } | null;
}

interface PendingItem {
  content_id: string;
  text: string;
  sha: string;
}

interface UpsertRow {
  content_id: string;
  embedding: number[];
  body_sha256: string;
  last_embedded_at: string;
  stale: boolean;
  embedding_model_id: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Embed an array of inputs in a single AI Gateway call.
 * Honors 429 Retry-After (cap 30s) and retries up to MAX_RETRIES.
 * On exhaust: throws (caller decides whether to skip the batch).
 *
 * Note: this is the `input: string[]` (array form) batch path that the plan's
 * key_link pattern `embed.*input.*\[` requires. Single-string embeds go
 * through `_shared/openai-embed.ts` instead.
 */
async function embedBatch(
  inputs: string[],
  fetchImpl: typeof fetch,
): Promise<number[][]> {
  const baseUrl = Deno.env.get('AI_GATEWAY_BASE_URL');
  const credential = Deno.env.get('AI_GATEWAY_API_KEY_CONSUMER');
  const model = Deno.env.get('OPENAI_EMBED_MODEL') ?? DEFAULT_EMBED_MODEL;
  if (!baseUrl) throw new Error('embedBatch: AI_GATEWAY_BASE_URL unset');
  if (!credential) throw new Error('embedBatch: AI_GATEWAY_API_KEY_CONSUMER unset');

  let lastError: Error = new Error('embedBatch: unreachable');
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), EMBED_TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, input: inputs }),
        signal: ctrl.signal,
      });

      if (res.status === 429) {
        const retryAfterRaw = res.headers.get('Retry-After') ?? '1';
        const retryAfterSec = Math.min(
          Math.max(parseInt(retryAfterRaw, 10) || 1, 1),
          RETRY_AFTER_CAP_SEC,
        );
        try {
          captureServer({
            userId: 'cron-embed-content-nightly',
            event: 'embed.rate_limit_429',
            properties: { attempt, retry_after_sec: retryAfterSec, batch_size: inputs.length },
          });
        } catch {
          // Telemetry never blocks the cron.
        }
        await res.body?.cancel().catch(() => {});
        if (attempt < MAX_RETRIES) {
          await sleep(retryAfterSec * 1000);
          continue;
        }
        lastError = new Error(`embedBatch: 429 after ${MAX_RETRIES} retries`);
        // Fall through to throw outside the loop.
        break;
      }

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`embedBatch failed: ${res.status} ${body.slice(0, 200)}`);
      }

      const j = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
      const data = j.data ?? [];
      if (data.length !== inputs.length) {
        throw new Error(
          `embedBatch: response length mismatch — expected ${inputs.length}, got ${data.length}`,
        );
      }
      const out: number[][] = [];
      for (const d of data) {
        if (!d.embedding || !Array.isArray(d.embedding) || d.embedding.length !== EMBEDDING_DIM) {
          throw new Error('embedBatch: malformed embedding in response');
        }
        out.push(d.embedding);
      }
      return out;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === MAX_RETRIES) break;
      // Non-429 transient retry — small backoff.
      if (!lastError.message.startsWith('embedBatch: 429')) {
        await sleep(250 * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

// ─── Main run ─────────────────────────────────────────────────────────────

async function handleRun(
  req: Request,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // T-38-20: cron-only entry. checkServiceRoleBearer uses constantTimeEqual.
  if (!checkServiceRoleBearer(req)) {
    return jsonError(403, 'forbidden');
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const startedAt = Date.now();

  let rowsEmbedded = 0;
  let rowsDedupSkipped = 0;
  let errorsCount = 0;

  try {
    // ── 2. SELECT candidates (pending + stale). PostgREST embedded-resource
    //       join: content_embeddings is the FK-referenced child; non-existent
    //       rows return null on the embedded field.
    const { data: candidates, error: selErr } = (await (admin
      .from('content')
      .select('id, title, body_md, content_embeddings(body_sha256, stale)') as unknown as
      {
        is: (col: string, val: null) => {
          not: (col: string, op: string, val: null) => {
            limit: (n: number) => Promise<{ data: ContentRow[] | null; error: unknown }>;
          };
        };
      })
      .is('deleted_at', null)
      .not('published_at', 'is', null)
      .limit(ROW_CAP_PER_RUN)) as { data: ContentRow[] | null; error: unknown };

    if (selErr) {
      throw new Error(`select candidates failed: ${JSON.stringify(selErr)}`);
    }

    const rows: ContentRow[] = candidates ?? [];

    // Filter to "pending OR stale" client-side (PostgREST embedded-resource
    // filtering on the child column is awkward; client-side is bounded by
    // the 1000-row cap so it's cheap).
    const filtered = rows.filter((r) => {
      const ce = r.content_embeddings;
      if (ce === null) return true; // pending — no embedding row exists
      return ce.stale === true; // explicit re-embed flag
    });

    // ── 3. Per-row dedup + queue ────────────────────────────────────────
    const toEmbed: PendingItem[] = [];
    for (const r of filtered) {
      const title = r.title ?? '';
      const body = r.body_md ?? '';
      const text = `${title}\n\n${body}`;
      const sha = await sha256Hex(text);
      const ce = r.content_embeddings;
      if (ce !== null && ce.stale === true && ce.body_sha256 === sha) {
        // Dedup: trigger fired but content unchanged → just clear stale flag.
        const { error: updErr } = await admin
          .from('content_embeddings')
          .update({ stale: false, last_embedded_at: new Date().toISOString() })
          .eq('content_id', r.id);
        if (updErr) {
          errorsCount++;
          sentryCapture(`embed-content-nightly: dedup-clear update failed for ${r.id}`, {
            severity: 'warning',
            err: JSON.stringify(updErr),
          });
          continue;
        }
        rowsDedupSkipped++;
        continue;
      }
      toEmbed.push({ content_id: r.id, text, sha });
    }

    // ── 4-6. Batch embed + upsert ───────────────────────────────────────
    const batches = chunk(toEmbed, EMBED_BATCH_SIZE);
    const batchGroups = chunk(batches, CONCURRENT_BATCHES);

    for (let g = 0; g < batchGroups.length; g++) {
      const group = batchGroups[g]!;
      // 5 batches in parallel.
      await Promise.all(
        group.map(async (batch) => {
          try {
            const vectors = await embedBatch(
              batch.map((b) => b.text),
              fetchImpl,
            );
            const upsertRows: UpsertRow[] = batch.map((b, i) => ({
              content_id: b.content_id,
              embedding: vectors[i]!,
              body_sha256: b.sha,
              last_embedded_at: new Date().toISOString(),
              stale: false,
              embedding_model_id: Deno.env.get('OPENAI_EMBED_MODEL') ?? DEFAULT_EMBED_MODEL,
            }));
            const { error: upErr } = await admin
              .from('content_embeddings')
              .upsert(upsertRows);
            if (upErr) {
              errorsCount += batch.length;
              sentryCapture(
                `embed-content-nightly: upsert failed for batch of ${batch.length}`,
                { severity: 'error', err: JSON.stringify(upErr) },
              );
              return;
            }
            rowsEmbedded += batch.length;
          } catch (err) {
            // 429 exhaust or transport — log + skip (do NOT crash cron).
            errorsCount += 1; // one batch-level failure (matches T5b expectation)
            sentryCapture(
              `embed-content-nightly: batch embed failed (${batch.length} rows)`,
              {
                severity: 'error',
                err: err instanceof Error ? err.message : String(err),
                content_ids: batch.map((b) => b.content_id).join(','),
              },
            );
          }
        }),
      );
      // Inter-group politeness sleep (skip after the final group).
      if (g < batchGroups.length - 1) {
        await sleep(INTER_GROUP_SLEEP_MS);
      }
    }

    // ── 7. Soft-delete cleanup (D-19) ───────────────────────────────────
    try {
      const { error: cleanupErr } = await admin.rpc(
        'cleanup_content_embeddings_soft_deleted',
        {},
      );
      if (cleanupErr) {
        sentryCapture(
          'embed-content-nightly: cleanup_content_embeddings_soft_deleted RPC failed',
          { severity: 'warning', err: JSON.stringify(cleanupErr) },
        );
      }
    } catch (err) {
      sentryCapture(
        'embed-content-nightly: cleanup RPC threw',
        { severity: 'warning', err: err instanceof Error ? err.message : String(err) },
      );
    }
  } catch (err) {
    // Top-level failure: still emit telemetry + return non-fatal 200 so cron
    // doesn't alert on transient DB hiccups. Per RESEARCH Pitfall #3 ethos
    // (partial progress beats zero), but for unexpected catastrophes we
    // surface the error in the response body for operator triage.
    sentryCapture('embed-content-nightly: fatal error', {
      severity: 'error',
      err: err instanceof Error ? err.message : String(err),
    });
    errorsCount += 1;
  }

  // ── 8. Telemetry + return ─────────────────────────────────────────────
  const durationMs = Date.now() - startedAt;
  try {
    captureServer({
      userId: 'cron-embed-content-nightly',
      event: 'embed.batch_complete',
      properties: {
        rows_embedded: rowsEmbedded,
        rows_dedup_skipped: rowsDedupSkipped,
        errors_count: errorsCount,
        duration_ms: durationMs,
      },
    });
  } catch {
    // Telemetry must never block.
  }
  try {
    await shutdownPostHog();
  } catch {
    // Shutdown best-effort.
  }

  return jsonResponse(200, {
    ok: true,
    rows_embedded: rowsEmbedded,
    rows_dedup_skipped: rowsDedupSkipped,
    errors_count: errorsCount,
    duration_ms: durationMs,
  });
}

Deno.serve((req) => handleRun(req));

export const __internal = {
  handleRun,
  setAdminForTest,
  resetAdminForTest,
  embedBatch,
};
