/**
 * Phase 60 Plan 60-09 — Typed client wrapper over federated sources RPCs + Fn invocation.
 *
 * Option D resolution (orchestrator decision 2026-05-26):
 *   - display_name + sync_cadence_label are NOT stored in DB.
 *   - They are derived from SOURCE_META client-side const map keyed on name.
 *   - FederatedSource interface matches the actual SQL table shape (last_sync_at,
 *     no display_name, no sync_cadence_label columns).
 *
 * RPCs (shipped in migration 20281201000020_federated_source_rpcs.sql):
 *   list_federated_sources()                   → setof federated_sources
 *   set_federated_source_enabled(name, enabled) → federated_sources
 *
 * NOT pushed in this plan — 60-15 pushes all Phase 60 migrations atomically.
 */

import { supabase } from '@/lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Matches actual public.federated_sources SQL table columns (60-01 migration). */
export interface FederatedSource {
  name: 'pubmed' | 'openfda' | 'dailymed';
  enabled: boolean;
  auto_tier_a: boolean;
  sync_cron: string;
  last_sync_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Display metadata derived client-side — NOT stored in DB. */
export interface FederatedSourceMeta {
  display_name: string;
  sync_cadence_label: string;
}

/** Canonical mapping: source name → human-readable labels. */
export const SOURCE_META: Record<FederatedSource['name'], FederatedSourceMeta> = {
  pubmed: {
    display_name: 'PubMed (NLM E-utilities)',
    sync_cadence_label: 'Daily 3:00 AM UTC',
  },
  openfda: {
    display_name: 'OpenFDA',
    sync_cadence_label: 'Daily 3:00 AM UTC',
  },
  dailymed: {
    display_name: 'DailyMed',
    sync_cadence_label: 'Daily 3:00 AM UTC',
  },
};

// ─── Fn slug map ─────────────────────────────────────────────────────────────

/** Maps source name → Supabase Edge Fn slug for historical pull invocation. */
const FN_SLUG_MAP: Record<FederatedSource['name'], string> = {
  pubmed: 'rag-federated-pubmed',
  openfda: 'rag-federated-fda',
  dailymed: 'rag-federated-dailymed',
};

// ─── API functions ────────────────────────────────────────────────────────────

/**
 * Calls list_federated_sources() SECDEF RPC.
 * Staff-only: non-staff sessions return 0 rows (RLS on federated_sources).
 * Throws with the underlying error.message on failure.
 */
export async function listFederatedSources(): Promise<FederatedSource[]> {
  const { data, error } = await supabase.rpc('list_federated_sources');
  if (error) throw new Error(error.message);
  return (data as FederatedSource[]) ?? [];
}

/**
 * Calls set_federated_source_enabled(p_name, p_enabled) SECDEF RPC.
 * Toggles enabled flag + updates updated_at (via DB trigger).
 * Returns the updated row.
 * Throws with the underlying error.message on failure.
 */
export async function setFederatedSourceEnabled(
  name: FederatedSource['name'],
  enabled: boolean,
): Promise<FederatedSource> {
  const { data, error } = await supabase.rpc('set_federated_source_enabled', {
    p_name: name,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message);
  return data as FederatedSource;
}

/**
 * Invokes the 60-07 federated adapter Edge Fn with pull_mode='historical'.
 * Maps source name → Fn slug via FN_SLUG_MAP (TS compile-time checked).
 * Throws synchronously for unknown source names (no Fn call leaks).
 * Throws with the underlying error.message on Fn invocation error.
 *
 * ARCHITECTURE NOTE (Option D deferral — 60-15):
 *   This function is wired but the UI button is rendered DISABLED pending
 *   the admin-action-token auth mechanism from 60-15. The Fn invocation uses
 *   the user's session JWT (default supabase.functions.invoke behavior).
 *   The Fn validates staff status via SECDEF check (60-07 owns this).
 *   Per [[reference_supabase_service_role_key_format_divergence]]: service-role
 *   auth is NOT used here — admin browser call trusts session JWT.
 */
export async function triggerHistoricalPull(name: FederatedSource['name']): Promise<void> {
  const slug = FN_SLUG_MAP[name];
  if (!slug) {
    throw new Error(`Unknown federated source: ${name}`);
  }

  const { error } = await supabase.functions.invoke(slug, {
    body: { pull_mode: 'historical' },
  });

  if (error) throw new Error(error.message);
}
