/**
 * meta-capi-relay — Phase 33 D-07/D-08
 *
 * Reads events_mirror rows for AEM-priority events (aem_priority 1-8 per events.ts),
 * hashes user PII via SHA-256 (Web Crypto — no library), POSTs to Meta Conversions API.
 *
 * DEDUP DEPENDENCY: event_id in events_mirror.properties.event_id must match the
 * browser fbq() 4th argument eventID for Meta's 48h dedup window to work.
 * Without browser fbq pixel (out of Phase 33 scope), dedup will not fire but
 * CAPI send is still valid — just lacks dedup optimization.
 *
 * PHI GUARDRAIL (D-08 belt+suspenders):
 * - Build-time: ESLint rule blocks aem_priority on phi:true events (additive-only-events.cjs)
 * - Runtime: AEM_PRIORITY_EVENTS static list only contains verified-phi:false events
 * - Defense-in-depth: any row whose event_name is not in AEM_PRIORITY_EVENTS is SKIPPED
 *
 * Cursor tracking: etl_cursors WHERE name='meta_capi_relay'. Advances only on
 * successful CAPI POST. If CAPI fails, cursor stays at previous position and
 * next 5-min tick retries the same batch (at-least-once delivery).
 *
 * META_PIXEL_ID is an additional Function Secret beyond D-03. Required to POST
 * to the correct pixel. Add to Supabase Function secrets alongside META_ACCESS_TOKEN.
 */
import {
  checkServiceRoleBearer,
  corsHeaders,
  jsonError,
  jsonResponse,
  makeLazyAdmin,
} from '../_shared/lifecycle-utils.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// AEM Priority Events
// Source: leanshot/src/lib/analytics/events.ts — aem_priority 1-8 annotations from Plan 33-02
// MUST be kept in sync with events.ts AEM annotations.
// If an event is added/removed from top-8, update both events.ts AND this list.
// All events in this list MUST have phi:false (enforced by ESLint additive-only-events.cjs).
// ---------------------------------------------------------------------------
const AEM_PRIORITY_EVENTS = [
  'payment_completed',      // aem_priority: 1
  'signup_completed',       // aem_priority: 2
  'activation_first_log',   // aem_priority: 3
  'payment_initiated',      // aem_priority: 4
  'refund_issued',          // aem_priority: 5
  // Slots 6-7 reserved for Phase 50 rag events if confirmed by plan-checker
] as const;

type AemEventName = typeof AEM_PRIORITY_EVENTS[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface EventMirrorRow {
  id: string;
  event_name: string;
  user_id: string;
  properties: Record<string, unknown>;
  distinct_id: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Admin singleton
// ---------------------------------------------------------------------------
const { admin, setAdminForTest, resetAdminForTest } = makeLazyAdmin();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read cursor from etl_cursors (returns '0' if row not found). */
async function getCursor(adminClient: SupabaseClient): Promise<string> {
  // deno-lint-ignore no-explicit-any
  const { data, error } = (await (adminClient
    .from('etl_cursors')
    .select('value')
    .eq('name', 'meta_capi_relay')
    .maybeSingle() as unknown)) as {
      data: { value: string } | null;
      error: { message?: string } | null;
    };
  if (error) {
    console.warn(`[meta-capi-relay] getCursor failed: ${error.message ?? 'unknown'}`);
  }
  return data?.value ?? '0';
}

/** Advance cursor in etl_cursors to new value. */
async function setCursor(adminClient: SupabaseClient, value: string): Promise<void> {
  // deno-lint-ignore no-explicit-any
  const { error } = (await (adminClient
    .from('etl_cursors')
    .upsert({ name: 'meta_capi_relay', value }, { onConflict: 'name' }) as unknown)) as {
      error: { message?: string } | null;
    };
  if (error) {
    console.warn(`[meta-capi-relay] setCursor failed: ${error.message ?? 'unknown'}`);
  }
}

/** SHA-256 hash via Web Crypto (no library). Normalizes to lowercase + trimmed. */
async function hashField(value: string): Promise<string> {
  const normalized = value.toLowerCase().trim();
  const encoded = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Fetch pending events from events_mirror after cursor, filtered to AEM priority events. */
async function fetchPendingEvents(
  adminClient: SupabaseClient,
  cursor: string,
): Promise<EventMirrorRow[]> {
  // deno-lint-ignore no-explicit-any
  const { data, error } = (await (adminClient
    .from('events_mirror')
    .select('*')
    .gt('id', cursor)
    .in('event_name', Array.from(AEM_PRIORITY_EVENTS))
    .order('id', { ascending: true })
    .limit(500) as unknown)) as {
      data: EventMirrorRow[] | null;
      error: { message?: string } | null;
    };
  if (error) {
    throw new Error(`fetchPendingEvents failed: ${error.message ?? 'unknown'}`);
  }
  return data ?? [];
}

/**
 * Build a single CAPI event payload from an events_mirror row.
 * Defense-in-depth: only processes rows with event_name in AEM_PRIORITY_EVENTS.
 */
async function buildCapiEvent(
  row: EventMirrorRow,
): Promise<Record<string, unknown> | null> {
  // Defense-in-depth skip: event not in allowlist
  if (!(AEM_PRIORITY_EVENTS as readonly string[]).includes(row.event_name)) {
    console.warn(`[meta-capi-relay] Skipping non-AEM event: ${row.event_name}`);
    return null;
  }

  const email = typeof row.properties.email === 'string' ? row.properties.email : null;
  const phone = typeof row.properties.phone === 'string' ? row.properties.phone : null;

  const userData: Record<string, unknown> = {};
  if (email) {
    userData.em = [await hashField(email)];
  }
  if (phone) {
    userData.ph = [await hashField(phone)];
  }

  const eventTime = Math.floor(new Date(row.created_at).getTime() / 1000);
  const eventId = typeof row.properties.event_id === 'string' ? row.properties.event_id : undefined;

  const payload: Record<string, unknown> = {
    event_name: row.event_name,
    event_time: eventTime,
    action_source: 'website',
    user_data: userData,
  };

  if (eventId !== undefined) {
    payload.event_id = eventId;
  }

  const customData: Record<string, unknown> = { currency: 'USD' };
  if (row.properties.value !== undefined) {
    customData.value = row.properties.value;
  }
  payload.custom_data = customData;

  return payload;
}

// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------
export async function handleRun(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const pixelId = Deno.env.get('META_PIXEL_ID');
  const accessToken = Deno.env.get('META_ACCESS_TOKEN');

  // Vendor gate — return 200 ok with skipped if credentials absent
  if (!pixelId || !accessToken) {
    return jsonResponse(200, { ok: true, skipped: 'credentials_missing' });
  }

  // Get admin from singleton (typed via proxy)
  const adminClient = admin as unknown as SupabaseClient;

  // Read cursor
  const cursor = await getCursor(adminClient);

  // Fetch pending events
  const rows = await fetchPendingEvents(adminClient, cursor);

  if (rows.length === 0) {
    return jsonResponse(200, { ok: true, events_relayed: 0 });
  }

  // Build CAPI payloads
  const capiEvents: Record<string, unknown>[] = [];
  for (const row of rows) {
    const event = await buildCapiEvent(row);
    if (event !== null) {
      capiEvents.push(event);
    }
  }

  if (capiEvents.length === 0) {
    return jsonResponse(200, { ok: true, events_relayed: 0 });
  }

  // Batch POST to Meta CAPI in chunks of 1000
  const BATCH_SIZE = 1000;
  for (let i = 0; i < capiEvents.length; i += BATCH_SIZE) {
    const batch = capiEvents.slice(i, i + BATCH_SIZE);
    const capiUrl = `https://graph.facebook.com/v25.0/${pixelId}/events?access_token=${accessToken}`;
    const response = await fetch(capiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: batch }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(
        `[meta-capi-relay] CAPI POST failed status=${response.status} body=${errBody}`,
      );
      return jsonError(500, 'capi_post_failed');
    }
  }

  // Only advance cursor after ALL batches succeed
  const lastId = rows[rows.length - 1].id;
  await setCursor(adminClient, String(lastId));

  return jsonResponse(200, { ok: true, events_relayed: capiEvents.length });
}

// ---------------------------------------------------------------------------
// Deno.serve entry point
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!checkServiceRoleBearer(req)) return jsonError(401, 'unauthorized');
  try {
    return await handleRun(req);
  } catch (e) {
    console.warn(
      '[meta-capi-relay] unhandled',
      e instanceof Error ? e.message : 'unknown',
    );
    return jsonError(500, 'internal');
  }
});

export const __internal = { handleRun, setAdminForTest, resetAdminForTest };
