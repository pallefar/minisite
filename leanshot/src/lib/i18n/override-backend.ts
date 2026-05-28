/**
 * Phase 32 Plan 32-04 — `locale_overrides` runtime: Supabase fetch + i18next
 * addResourceBundle merge + Realtime invalidation.
 *
 * Replaces the Plan 32-01 stub with the real admin hot-patch surface.
 *
 * Wiring (the Plan 32-01 integration seam stays unchanged):
 *   init.ts already calls `.use(overrideBackend)` so the postProcessor stays
 *   registered. Plan 32-01 also imports this module; no new imports needed
 *   there. Plan 32-04 adds ONE additional call — `subscribeToOverrideUpdates(i18next)`
 *   AFTER `.init()` resolves — that wires the runtime event listener + Realtime
 *   channel for the admin hot-patch surface.
 *
 * Behavior:
 *   1. On every i18n 'loaded' event (namespace finished loading from
 *      HttpBackend), fire ONE batched Supabase query for that (lng, ns) pair.
 *   2. Build a nested map from dotted-path keys (e.g. 'hero.cta.log_dose' →
 *      { hero: { cta: { log_dose: 'value' } } }) so addResourceBundle's
 *      deep-merge composes with the loaded catalog instead of clobbering
 *      sibling keys.
 *   3. Call i18next.addResourceBundle(lng, ns, bundle, deep=true, overwrite=true).
 *   4. Subscribe to Supabase Realtime channel `locale_overrides:{orgId|global}`.
 *      On postgres_changes UPDATE/INSERT/DELETE events where published=true,
 *      re-run steps 1-3 for the affected (lng, ns) — connected clients update
 *      their UI text within ~5s without a page reload.
 *
 * The exported `overrideBackend` postProcessor is a registration shim only —
 * the real work is done by the event listener + Realtime subscription. Keeping
 * the postProcessor preserves the init.ts wire seam from Plan 32-01.
 *
 * Defensive: if the Supabase fetch fails (network drop, RLS rejection), the
 * function silently logs + returns []; the user still sees the catalog string
 * — fail-soft per CLAUDE.md "AI outage = degraded UX, not full-app outage".
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import type { PostProcessorModule, i18n as I18nType } from 'i18next';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// PostProcessor registration shim (kept for Plan 32-01 wire-seam continuity).
// The real merge happens via the 'loaded' event listener below, not here —
// process() runs per-translation-call, which is the wrong granularity for a
// bulk override fetch.
// ---------------------------------------------------------------------------

export const overrideBackend: PostProcessorModule = {
  type: 'postProcessor',
  name: 'localeOverrides',
  process(value /*, key, options, translator */) {
    return value;
  },
};

// ---------------------------------------------------------------------------
// Override fetch + nested-map merge
// ---------------------------------------------------------------------------

interface OverrideRow {
  lng: string;
  ns: string;
  key: string;
  value: string;
}

/**
 * Fetch published overrides for a (lng, ns) pair. Scope rule:
 *   - Authenticated user with org in Zustand store → globals + that org's rows.
 *   - Anonymous / no org → globals only (org_id IS NULL).
 * RLS enforces the same scope rule server-side; this client-side filter is a
 * narrowing for bandwidth/perf, not a security gate.
 */
async function fetchOverrides(lng: string, ns: string): Promise<OverrideRow[]> {
  let orgId: string | null = null;
  try {
    orgId = useStore.getState().currentOrg?.id ?? null;
  } catch {
    // Store not hydrated yet (very early bootstrap). Treat as anonymous.
    orgId = null;
  }

  let query = supabase
    .from('locale_overrides')
    .select('lng, ns, key, value')
    .eq('lng', lng)
    .eq('ns', ns)
    .eq('published', true);

  if (orgId) {
    // Globals + this org's rows. PostgREST `or` filter syntax.
    query = query.or(`org_id.is.null,org_id.eq.${orgId}`);
  } else {
    query = query.is('org_id', null);
  }

  const { data, error } = await query;
  if (error) {
    // Fail-soft: log + return empty so the catalog string still renders.
    console.warn('[i18n] locale_overrides fetch failed', error);
    return [];
  }
  return data ?? [];
}

/**
 * Convert flat dotted-path overrides into a nested map matching i18next's
 * resource bundle shape. With { deep: true, overwrite: true } on
 * addResourceBundle, sibling keys NOT covered by overrides stay intact.
 */
function buildNestedMap(rows: OverrideRow[]): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const row of rows) {
    const parts = row.key.split('.');
    let cursor: Record<string, unknown> = root;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (i === parts.length - 1) {
        cursor[part] = row.value;
      } else {
        const next = cursor[part];
        if (next && typeof next === 'object' && !Array.isArray(next)) {
          cursor = next as Record<string, unknown>;
        } else {
          const fresh: Record<string, unknown> = {};
          cursor[part] = fresh;
          cursor = fresh;
        }
      }
    }
  }
  return root;
}

/**
 * Fetch + merge a single (lng, ns) pair. Exposed for unit tests; called from
 * the 'loaded' event listener and the Realtime postgres_changes handler.
 */
export async function applyOverrides(i18n: I18nType, lng: string, ns: string): Promise<void> {
  const rows = await fetchOverrides(lng, ns);
  if (!rows.length) return;
  const bundle = buildNestedMap(rows);
  // deep=true: merge into existing namespace tree (preserve siblings)
  // overwrite=true: overrides win over catalog values for the same key path
  // Args: addResourceBundle(lng, ns, resources, deep, overwrite)
  i18n.addResourceBundle(lng, ns, bundle, true, true);
  // Force consumers to re-render with the new bundle. i18next emits this on
  // language change but not on bundle-merge; calling reloadResources() would
  // re-fetch from HttpBackend (undesirable). Manual 'languageChanged' nudge
  // is the cheapest way to flip react-i18next's render cache.
  // Per i18next docs: addResourceBundle does NOT auto-emit, so we trigger the
  // event explicitly with the same language to make components re-translate.
  i18n.emit('languageChanged', i18n.language ?? lng);
}

// ---------------------------------------------------------------------------
// Realtime channel — one per process; recreated on org switch (future work).
// ---------------------------------------------------------------------------

let channel: RealtimeChannel | null = null;

/**
 * Wire i18next 'loaded' events + Supabase Realtime subscription. Idempotent:
 * a second call replaces the channel and listener (cleans up the prior pair).
 * Returns an unsubscribe handle for tests / teardown.
 *
 * Must be called AFTER `i18next.init()` resolves so the instance has a
 * `language` set and the event emitter is live. init.ts owns the call site.
 */
export function subscribeToOverrideUpdates(i18n: I18nType): () => void {
  // Apply overrides for any namespace i18next finishes loading.
  // The 'loaded' event fires with a Record<lng, Record<ns, true>> payload.
  const onLoaded = (loaded: Record<string, Record<string, boolean>>): void => {
    for (const lng of Object.keys(loaded)) {
      const nsMap = loaded[lng];
      if (!nsMap) continue;
      for (const ns of Object.keys(nsMap)) {
        void applyOverrides(i18n, lng, ns);
      }
    }
  };
  i18n.on('loaded', onLoaded);

  // Subscribe to per-org or global channel. We listen to '*' events so
  // INSERT (new draft published as draft+publish in one click), UPDATE
  // (publish toggle), AND DELETE (admin removes an override) all invalidate.
  let orgId: string | null = null;
  try {
    orgId = useStore.getState().currentOrg?.id ?? null;
  } catch {
    orgId = null;
  }
  const channelName = `locale_overrides:${orgId ?? 'global'}`;

  // Replace any prior channel before creating a new one (idempotent re-subscribe).
  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
  }

  channel = supabase
    .channel(channelName)
    .on(
      // The supabase-js types narrow this to specific event union literals.
      // Casting via unknown keeps the runtime contract (postgres_changes config
      // shape) intact while bypassing the union-literal mismatch — the
      // payload-shape contract is stable across supabase-js v2.

      'postgres_changes' as unknown as never,
      {
        event: '*',
        schema: 'public',
        table: 'locale_overrides',
        filter: 'published=eq.true',
      } as unknown as never,
      (payload: { new?: OverrideRow; old?: OverrideRow }) => {
        const row = payload.new ?? payload.old;
        if (row && typeof row.lng === 'string' && typeof row.ns === 'string') {
          void applyOverrides(i18n, row.lng, row.ns);
        }
      },
    )
    // Also listen for a broadcast on the same channel — redundant signal in
    // case postgres_changes drops the row (per locale-overrides-client
    // broadcastPublish helper). Payload shape: { lng, ns }.
    .on(
      'broadcast' as unknown as never,
      { event: 'override_published' } as unknown as never,
      (msg: { payload?: { lng?: string; ns?: string } }) => {
        const lng = msg.payload?.lng;
        const ns = msg.payload?.ns;
        if (typeof lng === 'string' && typeof ns === 'string') {
          void applyOverrides(i18n, lng, ns);
        }
      },
    )
    .subscribe();

  return () => {
    i18n.off('loaded', onLoaded);
    if (channel) {
      void supabase.removeChannel(channel);
      channel = null;
    }
  };
}
