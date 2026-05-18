/**
 * Phase 27 plan 27-04 — 4h same-funnel suppression integration test.
 *
 * Asserts D-18 suppression: with a prior funnel_anomaly_alerts row at
 * now()-2h, the next cron tick does NOT insert another alert for the same
 * funnel (the outer 4h suppression gate fires before the inner UNIQUE
 * (funnel_id, tick_bucket) idempotency net would).
 *
 * Env requirements (skipped if missing) — same as funnel-anomaly-detection.test.ts.
 *
 * File-scoped slug per [[feedback_rls_per_file_slug_prefix]].
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = Boolean(URL && ANON && SERVICE);
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

const SLUG = `anom-supp-${Date.now()}`;
const TEST_EVENT_NAME = `${SLUG}_test_signup`;

describeIfLive('Phase 27 D-18 — 4h same-funnel suppression', () => {
  let admin: SupabaseClient;
  let testFunnelId: string | null = null;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Insert tracked funnel.
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

    // 2. Seed baseline + anomalously low live window — same shape as detection test.
    const now = Date.now();
    const baselineRows: Array<{
      event_name: string;
      created_at: string;
      distinct_id: string;
      properties: Record<string, unknown>;
    }> = [];
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
    const { error: baselineErr } = await admin.from('events_mirror').insert(baselineRows);
    if (baselineErr) throw baselineErr;

    const liveRows = [
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
    const { error: liveErr } = await admin.from('events_mirror').insert(liveRows);
    if (liveErr) throw liveErr;

    // 3. Pre-insert a prior alert at now()-2h to simulate the 4h suppression window.
    const priorAlertTickBucket = new Date(now - 2 * 60 * 60 * 1000).toISOString().slice(0, 16) + ':00.000Z';
    const { error: priorErr } = await admin.from('funnel_anomaly_alerts').insert({
      funnel_id: testFunnelId,
      fired_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      tick_bucket: priorAlertTickBucket,
      observed_count: 2,
      expected_mean: 400,
      expected_stddev: 50,
      z_score: -7.96,
      resolution_status: 'firing',
    });
    if (priorErr) throw priorErr;
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    try {
      if (testFunnelId) {
        await admin.from('funnel_anomaly_alerts').delete().eq('funnel_id', testFunnelId);
      }
      await admin.from('events_mirror').delete().eq('event_name', TEST_EVENT_NAME);
      await admin.from('anomaly_tracked_funnels').delete().eq('event_name', TEST_EVENT_NAME);
    } catch {
      // ignore
    }
  });

  it('does not insert a new alert when prior alert fired <4h ago', async () => {
    // Count alerts for this funnel BEFORE invoking cron.
    const { data: beforeData, error: beforeErr } = await admin
      .from('funnel_anomaly_alerts')
      .select('id')
      .eq('funnel_id', testFunnelId!);
    expect(beforeErr).toBeNull();
    const beforeCount = (beforeData ?? []).length;
    expect(beforeCount).toBeGreaterThanOrEqual(1); // pre-seeded prior alert exists.

    // Invoke cron.
    const fnUrl = `${URL!}/functions/v1/funnel-anomaly-cron`;
    const fetchRes = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE!}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const body = (await fetchRes.json()) as { fired?: number; suppressed?: number };
    expect(fetchRes.status).toBe(200);
    // Our funnel should be suppressed; aggregate counter must include our row.
    expect(body.suppressed ?? 0).toBeGreaterThanOrEqual(1);

    // Count alerts for this funnel AFTER. Must be unchanged.
    const { data: afterData } = await admin
      .from('funnel_anomaly_alerts')
      .select('id')
      .eq('funnel_id', testFunnelId!);
    const afterCount = (afterData ?? []).length;
    expect(afterCount).toBe(beforeCount);
  }, 30_000);

  it('runs against live cloud DB when SUPABASE_SERVICE_ROLE_KEY is set', () => {
    expect(SHOULD_RUN).toBe(true);
  });
});

if (!SHOULD_RUN) {
  // eslint-disable-next-line no-console
  console.warn(
    '[anomaly-suppression.test] SKIPPED — SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY not all set.',
  );
}
