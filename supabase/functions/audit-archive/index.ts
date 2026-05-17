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

  // ── 5. Build storage path ─────────────────────────────────────────────────
  const { yyyy, mm, dd } = utcDateParts(now);
  const ext = 'csv'; // DuckDB fallback is CSV; parquet when DuckDB confirmed
  let storagePath = `${yyyy}/${mm}/${dd}.${ext}`;

  // Idempotency: check if path already exists; append rerun suffix if so
  // deno-lint-ignore no-explicit-any
  const { data: existingFile } = await (admin as any)
    .storage
    .from(BUCKET)
    .list(`${yyyy}/${mm}`, { search: `${dd}.${ext}` }) as { data: Array<{ name: string }> | null };

  if (existingFile && existingFile.length > 0) {
    storagePath = `${yyyy}/${mm}/${dd}-rerun-${Date.now()}.${ext}`;
    console.warn(`audit-archive: path already exists for today — using rerun suffix: ${storagePath}`);
  }

  // ── 6. Fetch + archive in chunks ──────────────────────────────────────────
  let offset = 0;
  let totalArchived = 0;
  const allRows: ArchiveRow[] = [];

  while (true) {
    // deno-lint-ignore no-explicit-any
    const { data: chunk, error: fetchErr } = await (admin as any)
      .from('audit_logs')
      .select('id, created_at, actor_user_id, target_user_id, action_name, table_name, row_pk, before_data, after_data, source, org_id')
      .lt('created_at', cutoff.toISOString())
      .order('created_at', { ascending: true })
      .range(offset, offset + CHUNK_SIZE - 1) as {
        data: ArchiveRow[] | null;
        error: { message: string } | null;
      };

    if (fetchErr) {
      return jsonResponse(500, { error: 'fetch_failed', detail: fetchErr.message });
    }

    if (!chunk || chunk.length === 0) break;

    allRows.push(...chunk);
    totalArchived += chunk.length;
    offset += CHUNK_SIZE;

    if (chunk.length < CHUNK_SIZE) break; // last page
  }

  if (allRows.length === 0) {
    return jsonResponse(200, {
      archived_count: 0,
      archived_path: null,
      message: 'No rows older than cutoff to archive.',
    });
  }

  // ── 7. Serialize rows ─────────────────────────────────────────────────────
  // Try DuckDB Parquet first; fall back to CSV.
  const parquetBytes = await tryDuckDB(allRows);
  const bytes = parquetBytes ?? rowsToCSV(allRows);
  const contentType = parquetBytes ? 'application/octet-stream' : 'text/csv';
  const finalPath = parquetBytes ? storagePath.replace(`.${ext}`, '.parquet') : storagePath;

  // ── 8. Upload to Storage ──────────────────────────────────────────────────
  // deno-lint-ignore no-explicit-any
  const { error: uploadErr } = await (admin as any)
    .storage
    .from(BUCKET)
    .upload(finalPath, bytes, { contentType, upsert: false }) as { error: { message: string } | null };

  if (uploadErr) {
    return jsonResponse(500, { error: 'upload_failed', detail: uploadErr.message });
  }

  // ── 9. Delete archived rows via SECURITY DEFINER RPC ─────────────────────
  // RLS DENY for DELETE on audit_logs — must go through SECDEF RPC that also
  // sets `app.suppress_audit = 'on'` to prevent recursive audit trigger.
  // deno-lint-ignore no-explicit-any
  const { error: deleteErr } = await (admin as any)
    .rpc('delete_archived_audit_rows', { p_cutoff: cutoff.toISOString() }) as {
    error: { message: string } | null;
  };

  if (deleteErr) {
    // Archive succeeded but delete failed — log + return partial success.
    console.error(`audit-archive: DELETE RPC failed after successful upload: ${deleteErr.message}`);
    return jsonResponse(207, {
      archived_count: totalArchived,
      archived_path: finalPath,
      warning: 'rows_not_deleted',
      detail: deleteErr.message,
    });
  }

  // ── 10. Return success ────────────────────────────────────────────────────
  return jsonResponse(200, {
    archived_count: totalArchived,
    archived_path: finalPath,
    format: parquetBytes ? 'parquet' : 'csv',
    cutoff: cutoff.toISOString(),
  });
}

// ── Entry point ────────────────────────────────────────────────────────────────

Deno.serve(handle);
