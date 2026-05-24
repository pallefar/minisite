// Phase 48 Plan 07 — claude-moderation Edge Fn.
//
// D-05/D-06/D-07: Async auto-flag via Anthropic structured-output classification.
// Called from auto_flag_content trigger (Plan 48-06) via pg_net.http_post.
//
// NEVER auto-removes content (D-07 success-criterion lock).
// Defense-in-depth PHI gate even though Plan 48-06 WHEN clause is primary.
//
// Memory references:
//   - reference_anthropic_model_id_hyphenated_format — model id HYPHENATED
//   - reference_supabase_functions_deploy_import_map_flag — per-Fn deno.json
//   - reference_supabase_service_role_key_format_divergence — checkServiceRoleBearer
//   - reference_deno_test_top_level_serve_trap — Deno.serve guarded
//   - feedback_rpc_auth_uid_vs_service_role_mismatch — service-role context

import { z } from 'https://esm.sh/zod@3.23.8';
import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';

const MODERATION_MODEL = 'claude-haiku-4-5-20251001'; // HYPHENATED — never dotted

const BodySchema = z.object({
  content_type: z.enum(['post', 'comment']),
  content_id: z.string().uuid(),
  body: z.string().min(1).max(50000),
  space_id: z.string().uuid(),
  author_id: z.string().uuid(),
});

const MODERATION_SCHEMA = {
  type: 'object',
  properties: {
    toxicity: { type: 'number', minimum: 0, maximum: 1 },
    spam: { type: 'number', minimum: 0, maximum: 1 },
    medical_misinformation: { type: 'number', minimum: 0, maximum: 1 },
    rationale: { type: 'string', maxLength: 500 },
  },
  required: ['toxicity', 'spam', 'medical_misinformation', 'rationale'],
  additionalProperties: false,
};

const SYSTEM_PROMPT_MODERATION = `You are a community-safety classifier.
Output strictly via the JSON schema. Score each category 0-1 (0=clean, 1=clearly violating).
Categories: toxicity (slurs/harassment), spam (commercial/repetitive), medical_misinformation (clearly false health claims).
Provide a brief rationale (<=500 chars).`;

export const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

interface ModerationScores {
  toxicity: number;
  spam: number;
  medical_misinformation: number;
  rationale: string;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');

  const raw = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return jsonError(400, 'invalid_body');

  const { content_type, content_id, body, space_id } = parsed.data;

  // D-08 defense-in-depth: skip clinic-org content (primary gate is trigger WHEN).
  const { data: space, error: spaceErr } = await admin
    .from('community_spaces')
    .select('id, org_id')
    .eq('id', space_id)
    .maybeSingle();
  if (spaceErr) return jsonError(500, 'space_lookup_failed');
  if (!space || space.org_id !== null) return jsonResponse(204, { skipped: 'phi_or_missing' });

  // Anthropic call
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  const baseUrl = Deno.env.get('AI_GATEWAY_BASE_URL') ?? 'https://api.anthropic.com';
  if (!apiKey) return jsonError(500, 'missing_anthropic_key');

  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODERATION_MODEL,
      max_tokens: 200,
      temperature: 0,
      system: SYSTEM_PROMPT_MODERATION,
      messages: [{ role: 'user', content: body }],
      output_config: { format: { type: 'json_schema', schema: MODERATION_SCHEMA } },
    }),
  });
  if (!res.ok) return jsonError(502, 'anthropic_failed');

  const j = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const textBlock = (j.content ?? []).find((b) => b.type === 'text');
  if (!textBlock?.text) return jsonError(502, 'anthropic_no_text');

  let scores: ModerationScores;
  try {
    scores = JSON.parse(textBlock.text) as ModerationScores;
  } catch {
    return jsonError(502, 'anthropic_parse_failed');
  }

  const entries: Array<[string, number]> = [
    ['toxicity', scores.toxicity],
    ['spam', scores.spam],
    ['medical_misinformation', scores.medical_misinformation],
  ];
  const top = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  const [category, confidence] = top;

  if (confidence < 0.7) {
    return jsonResponse(200, { flagged: false, scores });
  }

  // Flag — INSERT system-reporter row. NEVER delete the source content.
  const { error: insErr } = await admin
    .from('community_reports')
    .insert({
      target_type: content_type,
      target_id: content_id,
      reporter_user_id: null,
      reason: {
        source: 'claude_auto_flag',
        category,
        confidence,
        rationale: scores.rationale,
      },
      status: 'open',
    });
  if (insErr && !insErr.message.includes('duplicate key')) {
    return jsonError(500, 'insert_failed');
  }

  // Audit log (service-role context; auth.uid() is NULL; action_type disambiguates)
  await admin.rpc('log_moderation_action', {
    p_action_type: 'auto_flag',
    p_target_type: content_type,
    p_target_id: content_id,
    p_before: null,
    p_after: { scores, category, confidence },
    p_reason: scores.rationale,
  });

  return jsonResponse(200, { flagged: true, category, confidence });
}

// ============================================================================
// Deno.serve entrypoint — guarded per reference_deno_test_top_level_serve_trap
// ============================================================================

// deno-lint-ignore no-explicit-any
const denoGlobal: any = (globalThis as any).Deno;
if (import.meta.main && denoGlobal?.serve) {
  denoGlobal.serve(handler);
}
