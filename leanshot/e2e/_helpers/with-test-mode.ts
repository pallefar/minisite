/**
 * Phase 36 Plan 36-05 — E2E test-mode helpers.
 *
 * Wraps the `_test_seed_with_gas` SECDEF wrapper shipped in
 * 36-01's 20270710000005_p36_review_secdef_rpcs.sql migration (W8-followup).
 *
 * The wrapper sets `app.test_mode` GUC transaction-local server-side
 * (`set_config('app.test_mode', 'true', true)` — third arg `true` means
 * local scope) and then delegates to the bare `_test_seed_review_prompt_history`
 * helper. The bare helper still raises 'forbidden' without the GUC, so the
 * wrapper is the ONLY safe path even for service-role callers.
 *
 * EXECUTE on `_test_seed_with_gas` is granted ONLY to service_role
 * (REVOKEd from PUBLIC / anon / authenticated). Do NOT call
 * `_test_seed_review_prompt_history` directly from any e2e helper or spec.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function makeAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error(
      'makeAdminClient requires SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  return createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Seed a row into review_prompt_history via the `_test_seed_with_gas` SECDEF
 * wrapper (shipped in 36-01 Task 1, W8-followup). The wrapper sets the
 * `app.test_mode` GUC transaction-local on the server side and then delegates
 * to the bare `_test_seed_review_prompt_history` helper. Do NOT call the bare
 * helper directly — it raises 'forbidden' without the GUC, and EXECUTE on the
 * wrapper is granted ONLY to service_role.
 *
 * Returns the new history row id (uuid).
 */
export async function seedReviewPromptHistory(
  admin: SupabaseClient,
  args: {
    userId: string;
    ruleId: string;
    firedAt: string; // ISO-8601 timestamptz
    ratingValue?: number | null;
    copyVariant?: string | null;
  },
): Promise<string> {
  const { data, error } = await admin.rpc('_test_seed_with_gas', {
    p_user_id: args.userId,
    p_rule_id: args.ruleId,
    p_fired_at: args.firedAt,
    p_rating_value: args.ratingValue ?? null,
    p_copy_variant: args.copyVariant ?? null,
  });
  if (error) throw error;
  return data as string;
}
