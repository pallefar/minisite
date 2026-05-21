/**
 * Phase 40 Plan 40-04 — Client wrapper for cancellation-decide-offer Edge Fn.
 * Forwards user JWT from supabase.auth.getSession() (NOT service-role).
 * Per 40-PATTERNS §"Shared Patterns" + RESEARCH §Pitfall 4.
 */
import { supabase } from '@/lib/supabase';
import type { CancellationReason, DecideOfferResponse } from '@/types/cancellation';

export async function callDecideOffer({
  reason,
  reason_other_text,
}: {
  reason: CancellationReason;
  reason_other_text?: string;
}): Promise<DecideOfferResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const access_token = sessionData.session?.access_token;
  if (!access_token) {
    throw new Error('CONFIG_MISSING');
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('CONFIG_MISSING');
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/cancellation-decide-offer`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({ reason, reason_other_text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`decide-offer failed: ${res.status} ${body}`);
  }

  return (await res.json()) as DecideOfferResponse;
}
