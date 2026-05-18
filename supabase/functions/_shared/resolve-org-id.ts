import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * Resolve the org_id for a given user — Phase 25 Plan 25-04 (HIPAA-07).
 *
 * v1.3 implementation: returns null. The `clinic_patients` (and `org_members`)
 * table ships in Phase 28; until then, no user is org-bound and the ai-chat
 * clinical branch is unreachable at runtime. This shim exists so HIPAA-04
 * BAA-guard infrastructure can be tested + audited in CI before Phase 28
 * lights up real clinical sessions.
 *
 * When Phase 28 ships:
 *   Replace the `return null` stub with a DB lookup:
 *   ```
 *   const { data } = await admin
 *     .from('clinic_patients')
 *     .select('org_id')
 *     .eq('patient_user_id', userId)
 *     .maybeSingle();
 *   return (data?.org_id as string | undefined) ?? null;
 *   ```
 *   Coordinate with Phase 28 D-NN: confirm the JWT org_id claim shape OR the
 *   clinic_patients column name before removing this stub. This file is the
 *   integration seam between ai-chat clinical routing and the org data model.
 *
 * @param _admin - Supabase admin client (service role). Unused at v1.3.
 * @param _userId - The authenticated user's UUID. Unused at v1.3.
 * @returns Always null at v1.3; will return org_id string or null after Phase 28.
 */
export async function resolveOrgId(
  _admin: SupabaseClient,
  _userId: string,
): Promise<string | null> {
  // Phase 28 forward-compat stub. ALWAYS null at v1.3.
  // When Phase 28 ships `clinic_patients` table, update this function per JSDoc above.
  return null;
}
