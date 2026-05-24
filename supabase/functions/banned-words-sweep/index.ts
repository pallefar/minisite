// Phase 48 Plan 08 — banned-words-sweep Edge Fn.
//
// D-11: Admin-triggered historical sweep. Re-applies banned_words list to existing
// community_posts + community_comments. Idempotent via partial UNIQUE
// (community_reports_banned_word_dedup_uniq, Plan 48-01). NOT cron-driven —
// admin-triggered semantics are clearer per CONTEXT D-11. Admin BannedWordsEditor
// (Plan 48-10) calls this in a loop until next_cursor === null.
//
// Auth: HMAC service-role bearer (checkServiceRoleBearer). Caller is the admin
// SPA via the SECDEF orchestrator route; upstream admin auth gates entry.
//
// Memory references (load-bearing):
//   - reference_supabase_functions_deploy_import_map_flag — per-Fn deno.json,
//     no shared/* bare-aliases (uses ../_shared relative imports).
//   - reference_supabase_service_role_key_format_divergence —
//     checkServiceRoleBearer handles sb_secret_* format vs legacy HS256 JWT.
//   - reference_deno_test_top_level_serve_trap — Deno.serve guarded behind
//     the entrypoint check so `deno test path/` does NOT spawn a real server.
//   - feedback_rpc_auth_uid_vs_service_role_mismatch — service-role context
//     INSERTs directly into community_reports (RLS bypass); audit row via
//     log_moderation_action which accepts NULL auth.uid() (system origin).
//   - feedback_executor_tdd_scaffolds_sibling_plan_files — Plan 48-06 left
//     a RED test stub at index.test.ts; this plan drives it to GREEN.
//
// Idempotency contract: Plan 48-01 ships partial UNIQUE on
//   community_reports(target_type, target_id) WHERE reason->>'source'='banned_word'.
// Re-inserts raise 23505; supabase-js surfaces it as PostgrestError.code='23505'.
// The Fn swallows that case and counts the row as "already_flagged" (not a match).

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';

export const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

const BodySchema = z.object({
  table:        z.enum(['community_posts', 'community_comments']),
  start_cursor: z.string().uuid().nullable().default(null),
  batch_size:   z.number().int().min(1).max(500).default(100),
});

interface BannedWord {
  id: string;
  word: string;
  severity: 'warn' | 'flag' | 'escalate';
  case_insensitive: boolean;
}

interface ContentRow {
  id: string;
  body: string;
  author_id: string | null;
  space_id: string | null;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');

  const raw    = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return jsonError(400, 'invalid_body');
  const { table, start_cursor, batch_size } = parsed.data;

  // Load banned_words ONCE per invocation (single SELECT cache).
  // deno-lint-ignore no-explicit-any
  const { data: wordsData, error: wErr } = await (admin as any)
    .from('banned_words')
    .select('id, word, severity, case_insensitive');
  if (wErr) return jsonError(500, 'banned_words_load_failed');
  const words: BannedWord[] = (wordsData ?? []) as BannedWord[];

  // Cursored batch over <table> rows.
  // deno-lint-ignore no-explicit-any
  let q: any = (admin as any)
    .from(table)
    .select('id, body, author_id, space_id')
    .order('id', { ascending: true })
    .limit(batch_size);
  if (start_cursor) q = q.gt('id', start_cursor);

  const { data: rowsData, error: rErr } = await q;
  if (rErr) return jsonError(500, 'rows_load_failed');
  const rows: ContentRow[] = (rowsData ?? []) as ContentRow[];

  let matches = 0;
  const targetType = table === 'community_posts' ? 'post' : 'comment';

  for (const row of rows) {
    if (!row.body) continue;
    for (const w of words) {
      const haystack = w.case_insensitive ? row.body.toLowerCase() : row.body;
      const needle   = w.case_insensitive ? w.word.toLowerCase()   : w.word;
      if (!haystack.includes(needle)) continue;

      // INSERT community_reports — relies on partial UNIQUE (Plan 48-01) for
      // idempotency. Catch 23505 (duplicate key) silently; that target was
      // already flagged for banned_word in a prior sweep / live trigger fire.
      // deno-lint-ignore no-explicit-any
      const { error: insErr } = await (admin as any)
        .from('community_reports')
        .insert({
          target_type:      targetType,
          target_id:        row.id,
          reporter_user_id: null,
          reason:           { source: 'banned_word', word: w.word, severity: w.severity },
          status:           'open',
        });

      if (!insErr) {
        matches++;
        // Audit row per successful new match (skips duplicates → keeps audit
        // log proportional to net-new reports, not re-run noise).
        // deno-lint-ignore no-explicit-any
        await (admin as any).rpc('log_moderation_action', {
          p_action_type: 'banned_word_match',
          p_target_type: targetType,
          p_target_id:   row.id,
          p_before:      null,
          p_after:       { word: w.word, severity: w.severity, source: 'sweep' },
          p_reason:      null,
        });
      }
      // Per-row: if the same row matches multiple words we DO attempt one
      // INSERT per word; subsequent words land on the partial UNIQUE for the
      // same (target_type, target_id) and 23505-no-op. This keeps the loop
      // simple and idempotent.
    }
  }

  const next_cursor =
    rows.length === batch_size ? rows[rows.length - 1]!.id : null;

  return jsonResponse(200, {
    processed:   rows.length,
    matches,
    next_cursor,
    done:        next_cursor === null,
  });
}

// ── Deno.serve entrypoint — guarded per reference_deno_test_top_level_serve_trap ──
// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) {
  denoGlobal.serve(handler);
}
