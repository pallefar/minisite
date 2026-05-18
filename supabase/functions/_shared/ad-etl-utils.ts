// _shared/ad-etl-utils.ts
// Shared helpers for Phase 33 ad-spend ETL Edge Functions.
//
// Exports:
//   AdSpendRow             — canonical row shape for ad_spend_facts upserts
//   upsertAdSpendFacts()   — idempotent batch upsert (ON CONFLICT DO UPDATE), 100-row chunks
//   writeHealth()          — upserts ad_etl_health status on every ETL tick
//   lookupFxRate()         — last-known-rate lookup from fx_rates table (D-11)
//   writeAdminNotification() — fire-and-forget admin_notifications insert (P27 surface)
//
// Do NOT export makeLazyAdmin — each Edge Fn imports it from _shared/lifecycle-utils.ts.

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// Re-export for consumer convenience; createClient is already imported for internal use
export { createClient };

// =============================================================================
// Types
// =============================================================================

export type AdSpendRow = {
  network: 'meta' | 'google' | 'tiktok';
  ad_account_id: string;
  ad_id: string;
  campaign_id?: string;
  adset_id?: string;
  ad_name?: string;
  hour_bucket: string;            // ISO timestamptz e.g. "2026-05-18T14:00:00+00:00"
  spend_date: string;             // YYYY-MM-DD  (partition key — must match hour_bucket date)
  spend_local: number;
  spend_currency: string;         // ISO 4217 e.g. "USD", "EUR", "MXN"
  spend_usd_at_spend_date: number | null;  // NULL when FX rate missing (D-11)
  clicks: number;
  impressions: number;
  conversions: number;
};

// =============================================================================
// upsertAdSpendFacts
// Idempotent batch upsert to public.ad_spend_facts.
// ON CONFLICT (network, ad_account_id, ad_id, hour_bucket, spend_date) DO UPDATE
// covers both new rows and re-synced rows within the replay window (D-04/ADETL-06).
// Batched in groups of 100 to avoid supabase-js payload limits.
// =============================================================================
export async function upsertAdSpendFacts(
  admin: SupabaseClient,
  rows: AdSpendRow[],
): Promise<void> {
  if (rows.length === 0) return;

  const CHUNK_SIZE = 100;

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);

    const { error } = await admin
      .from('ad_spend_facts')
      .upsert(chunk, {
        onConflict: 'network,ad_account_id,ad_id,hour_bucket,spend_date',
      });

    if (error) {
      throw new Error(
        `upsertAdSpendFacts chunk ${i / CHUNK_SIZE + 1} failed: ${error.message}`,
      );
    }
  }
}

// =============================================================================
// writeHealth
// Upserts one row in ad_etl_health for the given network.
// Called at the start (attempt) and end (success/failure) of each ETL tick.
// last_attempt_at is always set to now() server-side; pass last_success_at only on success.
// =============================================================================
export async function writeHealth(
  admin: SupabaseClient,
  network: 'meta' | 'google' | 'tiktok',
  status: {
    credentials_present: boolean;
    last_error?: string;
    last_success_at?: string;   // ISO timestamptz; omit on failure
  },
): Promise<void> {
  const payload: Record<string, unknown> = {
    network,
    credentials_present: status.credentials_present,
    last_attempt_at: new Date().toISOString(),
  };

  if (status.last_error !== undefined) {
    payload.last_error = status.last_error;
  }

  if (status.last_success_at !== undefined) {
    payload.last_success_at = status.last_success_at;
  }

  const { error } = await admin
    .from('ad_etl_health')
    .upsert(payload, { onConflict: 'network' });

  if (error) {
    // Health write failure is non-fatal — log but do not throw.
    console.warn(`writeHealth(${network}) failed: ${error.message}`);
  }
}

// =============================================================================
// lookupFxRate
// Returns the rate_eur_to_currency for (currency, spend_date) from the fx_rates table.
// Uses the last-known-rate fallback: picks the most-recent rate_date <= spendDate.
// Returns null if no row found (ETL caller should set spend_usd_at_spend_date = null).
//
// FX conversion formula (D-11):
//   Given: spend_local in currency C, fx_rates stores rate_eur_to_C and rate_eur_to_USD.
//
//   Case 1 (currency = 'USD'):
//     spend_usd = spend_local  (no conversion needed)
//
//   Case 2 (currency = 'EUR'):
//     spend_usd = spend_local * rate_eur_to_usd
//     where rate_eur_to_usd = lookupFxRate(admin, 'USD', spendDate)
//
//   Case 3 (any other currency C):
//     rate_eur_to_C   = lookupFxRate(admin, C,     spendDate)
//     rate_eur_to_usd = lookupFxRate(admin, 'USD', spendDate)
//     spend_eur = spend_local / rate_eur_to_C
//     spend_usd = spend_eur  * rate_eur_to_usd
//
//   If any required rate is null → return null (caller stores spend_usd = null; gap-detect flags it).
// =============================================================================
export async function lookupFxRate(
  admin: SupabaseClient,
  currency: string,
  spendDate: string,  // YYYY-MM-DD
): Promise<number | null> {
  const { data, error } = await admin
    .from('fx_rates')
    .select('rate_eur_to_currency')
    .eq('currency', currency)
    .lte('rate_date', spendDate)
    .order('rate_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(`lookupFxRate(${currency}, ${spendDate}) error: ${error.message}`);
    return null;
  }

  if (!data) return null;

  return (data as { rate_eur_to_currency: number }).rate_eur_to_currency;
}

// =============================================================================
// convertToUsd
// Convenience helper that applies the 3-case formula from lookupFxRate docs.
// Returns null if any required rate is missing.
// =============================================================================
export async function convertToUsd(
  admin: SupabaseClient,
  spendLocal: number,
  currency: string,
  spendDate: string,
): Promise<number | null> {
  if (currency === 'USD') {
    return spendLocal;
  }

  const rateEurToUsd = await lookupFxRate(admin, 'USD', spendDate);
  if (rateEurToUsd === null) return null;

  if (currency === 'EUR') {
    return spendLocal * rateEurToUsd;
  }

  // Cross-rate: spend_local → EUR → USD
  const rateEurToC = await lookupFxRate(admin, currency, spendDate);
  if (rateEurToC === null) return null;

  const spendEur = spendLocal / rateEurToC;
  return spendEur * rateEurToUsd;
}

// =============================================================================
// writeAdminNotification
// Fire-and-forget insert to admin_notifications table (P27 surface).
// ON CONFLICT DO NOTHING for idempotency.
// Notification failure MUST NOT block cron completion — errors are logged + swallowed.
// =============================================================================
export async function writeAdminNotification(
  admin: SupabaseClient,
  payload: {
    title: string;
    body: string;
    type: string;
  },
): Promise<void> {
  try {
    const { error } = await admin
      .from('admin_notifications')
      .insert({
        title: payload.title,
        body: payload.body,
        type: payload.type,
      });

    if (error) {
      // Log but do not rethrow — notification failure must not block cron.
      console.warn(`writeAdminNotification failed: ${error.message}`);
    }
  } catch (err) {
    console.warn(`writeAdminNotification threw: ${String(err)}`);
  }
}
