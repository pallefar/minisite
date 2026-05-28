/**
 * Phase 40 Plan 40-04 — Client wrapper for cancellation-accept-offer Edge Fn.
 * Forwards user JWT from supabase.auth.getSession() (NOT service-role).
 * Per 40-PATTERNS §"Shared Patterns" + RESEARCH §Pitfall 4.
 */
import { supabase } from '@/lib/supabase';
import type { AcceptOfferRequest, AcceptOfferResponse } from '@/types/cancellation';

export async function callAcceptOffer(request: AcceptOfferRequest): Promise<AcceptOfferResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const access_token = sessionData.session?.access_token;
  if (!access_token) {
    throw new Error('CONFIG_MISSING');
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('CONFIG_MISSING');
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/cancellation-accept-offer`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`accept-offer failed: ${res.status} ${body}`);
  }

  return (await res.json()) as AcceptOfferResponse;
}
