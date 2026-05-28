/**
 * Phase 51 REVIEW WR-04 — single source of truth for the clinic_owner's
 * org_id scope across the Traffic dashboard tabs.
 *
 * Three of four sibling tabs (Channels, Funnels, Realtime) read from
 * `s.signedIn?.user?.app_metadata?.org_id`; one (LandingPages) read from
 * `s.currentOrg?.id`. That divergence let a clinic_owner see different
 * subsets when switching tabs depending on which source was populated.
 *
 * Canonical source: `app_metadata.org_id`. Rationale:
 *   - It is set server-side at JWT mint time, so the value is authoritative
 *     for the duration of the session and survives a hard refresh.
 *   - The SECDEF RPCs themselves derive `auth.uid()` → `_is_org_clinician(
 *     p_org_id, auth.uid())`, which validates the forwarded org_id against
 *     the SAME source. Using app_metadata.org_id keeps the client and
 *     server reading from one place.
 *   - `s.currentOrg` is an in-memory UI helper for the OrgSwitcher (which
 *     clinic_owner users do not see — they only ever have one org).
 *
 * Returns `null` for admin role (the SECDEF RPCs treat null as "all orgs").
 */
import { useStore } from '@/lib/store';

export function useOrgScope(): string | null {
  return useStore((s) => {
    const meta = s.signedIn?.user?.app_metadata as { role?: string; org_id?: string } | undefined;
    return meta?.role === 'clinic_owner' ? (meta?.org_id ?? null) : null;
  });
}
