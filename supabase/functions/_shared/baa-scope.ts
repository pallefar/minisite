/**
 * Phase 38 Plan 38-02 — BAA-scope guard.
 *
 * Phase 25 HIPAA-01 audit pattern (verbatim from AI-SPEC §5 Dim 5 + §6 O3):
 * for every clinical-tenant Anthropic call, the `users.org_id` lookup MUST
 * happen BEFORE the prompt is built. If the lookup fails or the resolved
 * model is not on the BAA allowlist, `assertBaaScope()` throws and the call
 * never reaches AI Gateway.
 *
 * The audit signal is the ORDER of Sentry breadcrumbs:
 *   1. baa.scope.resolved   (this module, before returning)
 *   2. anthropic.messages.create  (anthropic-summarize.ts, before fetch)
 *
 * If those crumbs are out of order in a production trace, the audit fails.
 * `anthropic-summarize.test.ts` Test 5 asserts this order on a fresh
 * breadcrumb buffer to prove the discipline at compile time.
 *
 * Credential selection — consumer vs clinical:
 *   - consumer (org_id IS NULL)   → AI_GATEWAY_API_KEY_CONSUMER
 *   - clinical (org_id non-null) → AI_GATEWAY_API_KEY_CLINICAL
 *
 * Per CONTEXT D-04 + leanshot memory `reference_minisite_monorepo_layout`,
 * the `profiles` table uses `primary_org_id` (NOT `org_id`). Phase 25 plans
 * referenced `profiles.org_id` but the actual column is `primary_org_id`.
 *
 * The Sentry breadcrumb carries scope metadata only — NEVER user_id, email,
 * or any PHI per Phase 25 HIPAA-01.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.105.0';
import { assertBaaCoveredModel } from './anthropic-baa-allowlist.ts';
import { addBreadcrumb } from './sentry.ts';

/**
 * Thrown when BAA-scope resolution fails — caller MUST NOT proceed to build
 * a prompt or call AI Gateway. Bubble to the Edge Function handler and return
 * a 500 Response (NOT 4xx — this is an internal invariant violation).
 */
export class BaaScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BaaScopeError';
  }
}

export interface BaaScope {
  /** Resolved AI Gateway credential — Bearer token sent to /v1/messages. */
  credential: string;
  /** True if the user belongs to a clinical (BAA-required) org. */
  isClinical: boolean;
  /** Clinical org id (primary_org_id) or null for consumer users. */
  orgId: string | null;
}

/**
 * Resolve the BAA scope for `userId` and emit the `baa.scope.resolved`
 * breadcrumb BEFORE returning.
 *
 * @throws {BaaScopeError} when the consumer credential is missing (for
 *   consumer paths) or the clinical credential is missing (for clinical
 *   paths). Both failure modes indicate a Function Secret mis-configuration.
 *
 * @throws {BaaScopeError} when the profiles query returns an error. A null
 *   row (user not found) is NOT an error — it's treated as a consumer user
 *   (`isClinical: false, orgId: null`).
 */
export async function resolveBaaScope(
  supabase: SupabaseClient,
  userId: string,
): Promise<BaaScope> {
  if (!userId || typeof userId !== 'string') {
    throw new BaaScopeError('resolveBaaScope: userId required (got empty/invalid)');
  }

  // Look up primary_org_id (NOT org_id — see file header).
  const { data, error } = await supabase
    .from('profiles')
    .select('primary_org_id')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new BaaScopeError(`resolveBaaScope: profiles lookup failed: ${error.message}`);
  }

  const orgId = (data?.primary_org_id ?? null) as string | null;
  const isClinical = orgId !== null;

  const credential = isClinical
    ? Deno.env.get('AI_GATEWAY_API_KEY_CLINICAL')
    : Deno.env.get('AI_GATEWAY_API_KEY_CONSUMER');

  if (!credential) {
    throw new BaaScopeError(
      `resolveBaaScope: ${isClinical ? 'AI_GATEWAY_API_KEY_CLINICAL' : 'AI_GATEWAY_API_KEY_CONSUMER'} unset`,
    );
  }

  // Audit signal — emit BEFORE returning so anthropic.messages.create
  // breadcrumb (emitted by anthropic-summarize.ts) ordering is preserved.
  // Per Phase 25 HIPAA-01: NEVER include user_id or PHI in breadcrumb.data.
  addBreadcrumb({
    category: 'baa.scope.resolved',
    level: 'info',
    data: {
      is_clinical: isClinical,
      has_org: orgId !== null,
    },
  });

  return { credential, isClinical, orgId };
}

/**
 * Assert that `modelId` is BAA-covered when `scope.isClinical` is true.
 *
 * The vendor-prefix (e.g. `anthropic/`) is stripped before the allowlist
 * check per RESEARCH Pitfall #10 — AI Gateway uses prefixed model IDs
 * (`anthropic/claude-sonnet-4-6`) but the allowlist tracks bare IDs.
 *
 * On consumer paths this is a no-op — non-BAA models are allowed for
 * consumer-tenant calls (no PHI traverses the wire). The clinical-path
 * check is the load-bearing FDA/SaMD-line mitigation.
 *
 * @throws {Response} 403 JSON when modelId fails allowlist check
 *   (re-thrown from `assertBaaCoveredModel`). Callers MUST catch the
 *   Response and return it from the Deno.serve handler.
 */
export function assertBaaScope(scope: BaaScope, modelId: string): void {
  if (!scope.isClinical) return;
  const bareModelId = modelId.replace(/^anthropic\//, '');
  assertBaaCoveredModel(bareModelId);
}
