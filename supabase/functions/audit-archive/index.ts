/**
 * audit-archive Edge Function — Phase 24 Plan 24-06 (D-16).
 *
 *   POST /functions/v1/audit-archive    (verify_jwt = false — cron bearer auth only)
 *
 * Invoked nightly by pg_cron entry `audit-archive-nightly` (Plan 24-01).
 * Exports audit_logs rows older than 90 days to cold storage, then deletes them
 * from the live table via a SECURITY DEFINER RPC (Plan 24-06 migration).
 *
 * Auth: Requires `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.
 *       Any other caller receives 403.
 *
 * DuckDB status: RESEARCH A2 flagged DuckDB Deno-compat as UNVERIFIED.
 * Implementation uses CSV as the primary archive format. DuckDB Parquet path
 * is attempted first; if `npm:duckdb` fails to load in Deno runtime, the
 * function falls back to CSV and logs:
 *   CRITICAL: DuckDB unavailable — CSV fallback active.
 * This comment block is intentional — see plan 24-06 deviation tracking.
 *
 * Security:
 *   T-24-03c: delete RPC `p_cutoff` constrained to > 89 days ago inside SECDEF.
 *   T-24-17: bucket is private; only service_role writes.
 *   T-24-18: smoke test asserts private bucket (403 on public URL attempt).
 *
 * Idempotency: if a file already exists for the date, appends `-rerun-<epoch>`.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ── Lazy env reads ─────────────────────────────────────────────────────────────

const getSupabaseUrl = () => Deno.env.get('SUPABASE_URL') ?? '';
const getSupabaseServiceRoleKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// ── Constants ──────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 10_000;
const HOT_WINDOW_DAYS = 90;
const BUCKET = 'audit-archive';

/**
 * Table archive registry. Each entry drives one independent archival pass
 * (fetch → CSV/Parquet → upload → SECDEF delete RPC).
 *
 * Phase 24 (D-16) shipped this Fn for `audit_logs` only.
 * Phase 48 Plan 48-04 (D-16) widens coverage to `moderation_audit_log` for
 * HIPAA-14 immutability (moderation actions retained 90d hot + Parquet cold,
 * mirroring phi_access_log immutability invariant).
 *
 * Each entry MUST have a corresponding SECDEF delete RPC named
 * `delete_archived_<short_name>_rows(p_cutoff timestamptz)`. The RPC is
 * required because the source table has `REVOKE UPDATE, DELETE FROM
 * service_role` (append-only invariant); only a SECDEF function owned by the
 * table owner can DELETE archived rows.
 *
 * If the delete RPC is missing at runtime (e.g., a new table is registered
 * before its delete RPC migration ships), the per-table pass returns a 207
 * partial-success warning rather than aborting the whole run — other tables
 * still get archived.
 */
export interface ArchiveTable {
  /** Source table name in public schema. */
  source: string;
  /** Short name used in storage path + delete RPC name. */
  short_name: string;
  /** Column projection for SELECT. Order is preserved in CSV header. */
  columns: string;
  /** SECDEF delete RPC name. */
  delete_rpc: string;
}

export const TABLES_TO_ARCHIVE: ArchiveTable[] = [
  {
    source: 'audit_logs',
    short_name: 'audit_logs',
    columns:
      'id, created_at, actor_user_id, target_user_id, action_name, table_name, row_pk, before_data, after_data, source, org_id',
    delete_rpc: 'delete_archived_audit_rows',
  },
  {
    source: 'moderation_audit_log',
    short_name: 'moderation_audit_log',
    columns:
      'id, created_at, actor_id, action_type, target_type, target_id, before_state, after_state, reason',
    delete_rpc: 'delete_archived_moderation_audit_rows',
  },
];

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

// ── Lazy admin singleton (injectable for tests) ────────────────────────────────

let _adminInstance: SupabaseClient | null = null;
export function getAdmin(): SupabaseClient {
  if (_adminInstance === null) {
    _adminInstance = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminInstance;
}

// Proxy: reads _adminInstance lazily on each call so setAdminForTest works.
const admin = new Proxy({} as Record<string | symbol, unknown>, {
  // deno-lint-ignore no-explicit-any
  get(_t: any, prop: string | symbol): unknown {
    const a = getAdmin() as unknown as Record<string | symbol, unknown>;
    const val = a[prop];
    return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(a) : val;
  },
}) as unknown as SupabaseClient;

// ── Test seam ──────────────────────────────────────────────────────────────────

export const __internal = {
  setAdminForTest(fake: SupabaseClient) {
    _adminInstance = fake;
  },
  handle,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function bearerFromReq(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] ?? null) : null;
}

/** Build UTC date parts for storage path. */
function utcDateParts(d: Date): { yyyy: string; mm: string; dd: string } {
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return { yyyy, mm, dd };
}

// ── DuckDB Parquet (attempt) + CSV fallback ────────────────────────────────────

interface ArchiveRow {
  [key: string]: unknown;
}

/** Try to write rows as Parquet via DuckDB. Returns null if DuckDB is unavailable. */
async function tryDuckDB(rows: ArchiveRow[]): Promise<Uint8Array | null> {
  // DuckDB Deno-compat is RESEARCH A2 UNVERIFIED.
  // We attempt dynamic import; if it throws we fall back to CSV.
  try {
    // deno-lint-ignore no-explicit-any
    const duckdb = await import('npm:duckdb') as any;
    const db = new duckdb.default.Database(':memory:');
    const conn: { run: (sql: string, cb: (err: unknown) => void) => void } = db.connect();

    // Insert rows into an in-memory table
    const cols = Object.keys(rows[0] ?? {});
    if (cols.length === 0) return null;

    const createCols = cols.map((c) => `"${c}" TEXT`).join(', ');
    await new Promise<void>((res, rej) => {
      conn.run(`CREATE TABLE t (${createCols})`, (err: unknown) =>
        err ? rej(err) : res());
    });

    for (const row of rows) {
      const vals = cols.map((c) => {
        const v = row[c];
        return v == null ? 'NULL' : `'${String(v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v)).replace(/'/g, "''")}'`;
      }).join(', ');
      await new Promise<void>((res, rej) => {
        conn.run(`INSERT INTO t VALUES (${vals})`, (err: unknown) =>
          err ? rej(err) : res());
      });
    }

    // Export to buffer via DuckDB's in-memory file (not all Deno builds support this)
    // For now, treat as unavailable since there's no easy buffer path in Deno
    db.close();
    return null; // Fall through to CSV until confirmed working in Deno
  } catch {
    // DuckDB unavailable — CSV fallback active
    console.warn('CRITICAL: DuckDB unavailable — CSV fallback active. See plan 24-06 deviation tracking.');
    return null;
  }
}

/** Serialize rows to CSV bytes. */
function rowsToCSV(rows: ArchiveRow[]): Uint8Array {
  if (rows.length === 0) return new TextEncoder().encode('');
  const headers = Object.keys(rows[0]);
  const lines: string[] = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const v = row[h];
          const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
          return `"${s.replace(/"/g, '""')}"`;
        })
        .join(','),
    ),
  ];
  return new TextEncoder().encode(lines.join('\n'));
}

// ── Core handler ───────────────────────────────────────────────────────────────

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  // ── 1. Auth: must be service-role bearer ──────────────────────────────────
  const bearer = bearerFromReq(req);
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!bearer || !serviceRoleKey || bearer !== serviceRoleKey) {
    return jsonResponse(403, { error: 'forbidden' });
  }

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  type ArchiveBody = { source?: string; cutoff_date?: string };
  let body: ArchiveBody = {};
  try {
    const raw = await req.text();
    if (raw.trim()) body = JSON.parse(raw) as ArchiveBody;
  } catch {
    // ignore parse errors; defaults apply
  }

  // ── 3. Verify bucket exists and is private ────────────────────────────────
  // deno-lint-ignore no-explicit-any
  const { data: buckets, error: bucketsErr } = await (admin as any)
    .storage
    .listBuckets() as { data: Array<{ name: string; public: boolean }> | null; error: unknown };

  if (bucketsErr || !buckets) {
    return jsonResponse(500, { error: 'storage_unavailable', detail: String(bucketsErr) });
  }

  const bucket = buckets.find((b) => b.name === BUCKET);
  if (!bucket) {
    return jsonResponse(500, {
      error: 'bucket_missing',
      detail: `Storage bucket '${BUCKET}' not found. Was Plan 24-01 user-setup completed?`,
    });
  }

  if (bucket.public) {
    // T-24-18: bucket must NOT be public
    console.error('SECURITY: audit-archive bucket is unexpectedly PUBLIC. Aborting archive run.');
    return jsonResponse(500, { error: 'bucket_public', detail: 'audit-archive bucket must be private' });
  }

  // ── 4. Determine cutoff ───────────────────────────────────────────────────
  const now = new Date();
  const cutoff = body.cutoff_date
    ? new Date(body.cutoff_date)
    : new Date(Date.now() - HOT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Validate cutoff is not too recent (T-24-03c: must be > 89 days ago)
  const minCutoff = new Date(Date.now() - 89 * 24 * 60 * 60 * 1000);
  if (cutoff > minCutoff) {
    return jsonResponse(400, {
      error: 'cutoff_too_recent',
      detail: 'cutoff must be at least 90 days ago to protect recent audit data',
    });
  }

  // ── 5. Per-table archive loop ─────────────────────────────────────────────
  // Each entry in TABLES_TO_ARCHIVE produces an independent fetch → upload →
  // delete pass. Per-table failures degrade the overall response status but
  // do not abort sibling tables — moderation_audit_log unavailable should
  // not prevent audit_logs from being archived.
  const { yyyy, mm, dd } = utcDateParts(now);
  const ext = 'csv'; // DuckDB fallback is CSV; parquet when DuckDB confirmed

  interface TableResult {
    table: string;
    archived_count: number;
    archived_path: string | null;
    format?: 'csv' | 'parquet';
    warning?: string;
    detail?: string;
  }

  const results: TableResult[] = [];
  let anyWarning = false;
  let anyError = false;

  for (const entry of TABLES_TO_ARCHIVE) {
    // ── 5a. Build per-table storage path with idempotency ──────────────────
    let storagePath = `${entry.short_name}/${yyyy}/${mm}/${dd}.${ext}`;

    // deno-lint-ignore no-explicit-any
    const { data: existingFile } = await (admin as any)
      .storage
      .from(BUCKET)
      .list(`${entry.short_name}/${yyyy}/${mm}`, { search: `${dd}.${ext}` }) as {
        data: Array<{ name: string }> | null;
      };

    if (existingFile && existingFile.length > 0) {
      storagePath = `${entry.short_name}/${yyyy}/${mm}/${dd}-rerun-${Date.now()}.${ext}`;
      console.warn(`audit-archive(${entry.source}): path already exists for today — using rerun suffix: ${storagePath}`);
    }

    // ── 5b. Fetch in chunks ────────────────────────────────────────────────
    let offset = 0;
    let totalArchived = 0;
    const allRows: ArchiveRow[] = [];

    while (true) {
      // deno-lint-ignore no-explicit-any
      const { data: chunk, error: fetchErr } = await (admin as any)
        .from(entry.source)
        .select(entry.columns)
        .lt('created_at', cutoff.toISOString())
        .order('created_at', { ascending: true })
        .range(offset, offset + CHUNK_SIZE - 1) as {
          data: ArchiveRow[] | null;
          error: { message: string } | null;
        };

      if (fetchErr) {
        results.push({
          table: entry.source,
          archived_count: 0,
          archived_path: null,
          warning: 'fetch_failed',
          detail: fetchErr.message,
        });
        anyError = true;
        break;
      }

      if (!chunk || chunk.length === 0) break;

      allRows.push(...chunk);
      totalArchived += chunk.length;
      offset += CHUNK_SIZE;

      if (chunk.length < CHUNK_SIZE) break; // last page
    }

    // If fetch already errored above we recorded a result; skip the rest.
    if (results.length > 0 && results[results.length - 1]!.table === entry.source && results[results.length - 1]!.warning === 'fetch_failed') {
      continue;
    }

    if (allRows.length === 0) {
      results.push({
        table: entry.source,
        archived_count: 0,
        archived_path: null,
      });
      continue;
    }

    // ── 5c. Serialize rows (DuckDB Parquet → CSV fallback) ─────────────────
    const parquetBytes = await tryDuckDB(allRows);
    const bytes = parquetBytes ?? rowsToCSV(allRows);
    const contentType = parquetBytes ? 'application/octet-stream' : 'text/csv';
    const finalPath = parquetBytes ? storagePath.replace(`.${ext}`, '.parquet') : storagePath;

    // ── 5d. Upload to Storage ──────────────────────────────────────────────
    // deno-lint-ignore no-explicit-any
    const { error: uploadErr } = await (admin as any)
      .storage
      .from(BUCKET)
      .upload(finalPath, bytes, { contentType, upsert: false }) as { error: { message: string } | null };

    if (uploadErr) {
      results.push({
        table: entry.source,
        archived_count: 0,
        archived_path: null,
        warning: 'upload_failed',
        detail: uploadErr.message,
      });
      anyError = true;
      continue;
    }

    // ── 5e. Delete archived rows via SECDEF RPC ────────────────────────────
    // RLS DENY for DELETE on source table — must go through SECDEF RPC that
    // (for audit_logs) also sets `app.suppress_audit = 'on'` to prevent
    // recursive audit triggers.
    // deno-lint-ignore no-explicit-any
    const { error: deleteErr } = await (admin as any)
      .rpc(entry.delete_rpc, { p_cutoff: cutoff.toISOString() }) as {
      error: { message: string } | null;
    };

    if (deleteErr) {
      // Archive succeeded but delete failed (e.g. delete RPC not yet
      // deployed for a newly-registered table). Log + record partial-success;
      // sibling tables continue.
      console.error(`audit-archive(${entry.source}): DELETE RPC ${entry.delete_rpc} failed after successful upload: ${deleteErr.message}`);
      results.push({
        table: entry.source,
        archived_count: totalArchived,
        archived_path: finalPath,
        format: parquetBytes ? 'parquet' : 'csv',
        warning: 'rows_not_deleted',
        detail: deleteErr.message,
      });
      anyWarning = true;
      continue;
    }

    results.push({
      table: entry.source,
      archived_count: totalArchived,
      archived_path: finalPath,
      format: parquetBytes ? 'parquet' : 'csv',
    });
  }

  // ── 6. Aggregate response ─────────────────────────────────────────────────
  // Sum across tables for top-level archived_count / archived_path back-compat
  // with the single-table response shape from Phase 24. archived_path reports
  // the first successful path (callers needing per-table detail read `tables`).
  const totalArchived = results.reduce((acc, r) => acc + r.archived_count, 0);
  const firstPath = results.find((r) => r.archived_path)?.archived_path ?? null;
  const firstFormat = results.find((r) => r.format)?.format;

  if (totalArchived === 0 && !anyError) {
    return jsonResponse(200, {
      archived_count: 0,
      archived_path: null,
      message: 'No rows older than cutoff to archive.',
      tables: results,
      cutoff: cutoff.toISOString(),
    });
  }

  const status = anyError ? 500 : anyWarning ? 207 : 200;
  return jsonResponse(status, {
    archived_count: totalArchived,
    archived_path: firstPath,
    format: firstFormat,
    cutoff: cutoff.toISOString(),
    tables: results,
  });
}

// ── Entry point ────────────────────────────────────────────────────────────────

Deno.serve(handle);
