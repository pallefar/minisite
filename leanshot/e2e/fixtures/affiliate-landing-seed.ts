/**
 * Phase 26 Plan 26-04 (AFFTIER-06) — affiliate landing fixture seed.
 *
 * Seeds two fixture rows in `public.affiliates` so the Playwright spec
 * `affiliate-landing-gold.spec.ts` can hit /r/{code}/landing and snapshot
 * the two tier variants:
 *
 *   - std-test-aff:  tier='standard', template_choice='coach' → Coach baseline
 *   - gold-test-aff: tier='gold',     template_choice='coach' → Gold baseline
 *                    (the resolver's `tier==='gold' ? 'gold' : template_choice`
 *                    override is what we're exercising — Gold partners with a
 *                    legacy template_choice still route to the premium template.)
 *
 * Idempotent — upserts by referral_code so re-runs are safe.
 *
 * Constraints honored:
 *   - Uses service-role key (write access to affiliates bypasses RLS).
 *   - File-scope referral codes (NOT a shared TEST_SLUG_PREFIX) per
 *     [[feedback_rls_per_file_slug_prefix]].
 *   - `status='approved'` so `affiliates_public_view` (security_invoker)
 *     returns the row to the anon resolver.
 *
 * Dependencies:
 *   - VITE_SUPABASE_URL                — public project URL
 *   - SUPABASE_SERVICE_ROLE_KEY        — admin key (live Supabase project)
 *   - Plan 26-01 migrations pushed (affiliates.tier column exists)
 *   - This plan's seed migration pushed (`tier` exposed on view; gold loader wired)
 */
import { createClient } from '@supabase/supabase-js';

const STD_CODE = 'std-test-aff';
const GOLD_CODE = 'gold-test-aff';

export interface LandingFixtureSeedResult {
  stdCode: string;
  goldCode: string;
}

/**
 * Upsert two fixture affiliates (idempotent). Returns the referral codes
 * to use in /r/{code}/landing URLs.
 *
 * Throws on missing env vars or seed failure so the calling test fails fast
 * rather than racing into a flaky 404.
 */
export async function seedLandingFixture(): Promise<LandingFixtureSeedResult> {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'seedLandingFixture: missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars; ' +
        'cannot seed affiliates fixture without service-role access.',
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await admin.from('affiliates').upsert(
    [
      {
        referral_code: STD_CODE,
        display_name: 'Standard Test Affiliate',
        blurb: 'Standard-tier fixture affiliate for AFFTIER-06 screenshot baseline.',
        status: 'approved',
        tier: 'standard',
        template_choice: 'coach',
      },
      {
        referral_code: GOLD_CODE,
        display_name: 'Gold Test Affiliate',
        blurb: 'Gold-tier fixture affiliate for AFFTIER-06 screenshot baseline.',
        status: 'approved',
        tier: 'gold',
        // Intentional: legacy template_choice='coach' — the resolver MUST
        // override to 'gold' because tier='gold'. This proves Pitfall 6
        // (silent fallback) is fixed.
        template_choice: 'coach',
      },
    ],
    { onConflict: 'referral_code' },
  );

  if (error) {
    throw new Error(
      `seedLandingFixture: upsert failed: ${error.message} (code=${error.code ?? 'unknown'})`,
    );
  }

  return { stdCode: STD_CODE, goldCode: GOLD_CODE };
}
