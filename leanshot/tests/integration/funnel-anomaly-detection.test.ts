/**
 * Phase 27 plan 27-04 — funnel-anomaly cron detection integration test.
 *
 * Asserts the full data-layer round-trip:
 *   1. Seed public.events_mirror with a normal baseline window (7d × ~hourly)
 *      and an anomalously LOW last-24h window for one funnel.
 *   2. Subscribe directly to the 'funnel_anomaly_alerts' Realtime broadcast
 *      BEFORE invoking the Edge Function (per [[feedback_realtime_layer_e2e_pattern]]
 *      — drive write via test, verify at DB+channel layer, NO UI traversal).
 *   3. Invoke supabase functions deploy URL via fetch with service-role bearer.
 *   4. Assert: a funnel_anomaly_alerts row appears with z_score < -2.0;
 *      the Realtime broadcast listener receives the payload within 5s.
 *
 * Env requirements (skipped if missing):
 *   SUPABASE_URL              — e.g. https://ytnsipxxmzgaebkqmokp.supabase.co
 *   SUPABASE_ANON_KEY         — public anon JWT (for Realtime channel)
 *   SUPABASE_SERVICE_ROLE_KEY — PRIVATE service-role JWT (for admin seed + cron POST)
 *
 * Per [[feedback_rls_per_file_slug_prefix]] — file-scoped slug to avoid
 * cross-file collisions when vitest runs files in parallel.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

// File-scoped slug per [[feedback_rls_per_file_slug_prefix]].
const SLUG = `anom-det-${Date.now()}`;
const TEST_EVENT_NAME = `${SLUG}_test_signup`;

describeIfLive('Phase 27 SC#5 + TAXO-05 — funnel-anomaly detection end-to-end', () => {
  let admin: SupabaseClient;
  let publicClient: SupabaseClient;
  let testFunnelId: string | null = null;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    publicClient = createClient(URL!, ANON!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Insert tracked funnel for this test (idempotent).
    const { data: funnel, error: funnelErr } = await admin
      .from('anomaly_tracked_funnels')
      .upsert(
        {
          event_name: TEST_EVENT_NAME,
          is_enabled: true,
          baseline_lookback_days: 7,
          sigma_threshold: 2.0,
        },
        { onConflict: 'event_name' },
      )
      .select('funnel_id')
      .single();
    if (funnelErr) throw funnelErr;
    testFunnelId = funnel.funnel_id as string;

    // 2. Seed a healthy baseline window: 7 days × 24 hours × 20 events/hr.
    //    Build a single batch insert per CONTEXT note (NOT a TS loop firing
    //    3360+ individual inserts).
    const baselineRows: Array<{
      event_name: string;
      created_at: string;
      distinct_id: string;
      properties: Record<string, unknown>;
    }> = [];
    const now = Date.now();
    // Seed evenly across last 7 days (excluding the live 24h window, which
    // we control separately). 7d × 24h × 20 events = 3360 rows.
    for (let h = 24; h < 24 + 7 * 24; h++) {
      for (let n = 0; n < 20; n++) {
        baselineRows.push({
          event_name: TEST_EVENT_NAME,
          created_at: new Date(now - h * 60 * 60 * 1000 - n * 3 * 60 * 1000).toISOString(),
          distinct_id: `baseline-${h}-${n}`,
          properties: {},
        });
      }
    }
    // Single batched insert.
    const { error: baselineErr } = await admin.from('events_mirror').insert(baselineRows);
    if (baselineErr) throw baselineErr;

    // 3. Seed the anomalously LOW last-24h window: only 2 events.
    const anomalousRows = [
      {
        event_name: TEST_EVENT_NAME,
        created_at: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
        distinct_id: `live-1`,
        properties: {},
      },
      {
        event_name: TEST_EVENT_NAME,
        created_at: new Date(now - 12 * 60 * 60 * 1000).toISOString(),
        distinct_id: `live-2`,
        properties: {},
      },
    ];
    const { error: liveErr } = await admin.from('events_mirror').insert(anomalousRows);
    if (liveErr) throw liveErr;
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    try {
      // Best-effort cleanup.
      if (testFunnelId) {
        await admin.from('funnel_anomaly_alerts').delete().eq('funnel_id', testFunnelId);
      }
      await admin.from('events_mirror').delete().eq('event_name', TEST_EVENT_NAME);
      await admin.from('anomaly_tracked_funnels').delete().eq('event_name', TEST_EVENT_NAME);
    } catch {
      // ignore
    }
  });

  it('detects the anomaly, inserts an alert row, and broadcasts on the Realtime channel', async () => {
    // 4. Subscribe to the broadcast channel BEFORE invoking the cron.
    //    Per [[feedback_realtime_layer_e2e_pattern]] — verify at the channel
    //    layer, not UI.
    const receivedAlerts: Array<Record<string, unknown>> = [];
    const channel = publicClient
      .channel('funnel_anomaly_alerts')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('broadcast', { event: 'anomaly_fired' }, (payload: any) => {
        if (payload?.payload) receivedAlerts.push(payload.payload as Record<string, unknown>);
      });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('subscribe timeout')), 5_000);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    try {
      // 5. Invoke the Edge Function directly with service-role bearer.
      const fnUrl = `${URL!}/functions/v1/funnel-anomaly-cron`;
      const fetchRes = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SERVICE!}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      const fetchBody = (await fetchRes.json()) as { fired?: number; checked?: number };
      expect(fetchRes.status).toBe(200);
      expect(fetchBody.fired ?? 0).toBeGreaterThanOrEqual(1);

      // 6. Assert the alert row landed in funnel_anomaly_alerts.
      const { data: alerts, error: alertErr } = await admin
        .from('funnel_anomaly_alerts')
        .select('id, funnel_id, z_score, resolution_status')
        .eq('funnel_id', testFunnelId!)
        .order('fired_at', { ascending: false })
        .limit(1);
      expect(alertErr).toBeNull();
      expect(alerts).toHaveLength(1);
      expect(Number(alerts![0].z_score)).toBeLessThan(-2.0);
      expect(alerts![0].resolution_status).toBe('firing');

      // 7. Await up to 5s for the broadcast to arrive.
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && receivedAlerts.length === 0) {
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(receivedAlerts.length).toBeGreaterThanOrEqual(1);
      expect(receivedAlerts[0].alert_id).toBeDefined();
    } finally {
      await publicClient.removeChannel(channel);
    }
  }, 30_000);

  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    expect(SHOULD_RUN).toBe(true);
  });
});

if (!SHOULD_RUN) {
  // eslint-disable-next-line no-console
  console.warn(
    '[funnel-anomaly-detection.test] SKIPPED — SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY not all set.',
  );
}
