// ad-revenue-etl/index.test.ts
// Tests for pure exported helpers — does NOT import Deno.serve to avoid port bind.
// Run: $HOME/.deno/bin/deno test --no-check --allow-all supabase/functions/ad-revenue-etl/index.test.ts

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { normalizeReportRow, computeEcpmRpm } from './index.ts';

// ---------------------------------------------------------------------------
// computeEcpmRpm
// ---------------------------------------------------------------------------

Deno.test('computeEcpmRpm: returns (revenue / impressions) * 1000', () => {
  const result = computeEcpmRpm(1000, 5);
  assertEquals(result, 5); // (5 / 1000) * 1000 = 5
});

Deno.test('computeEcpmRpm: returns 0 when impressions is 0 (no divide-by-zero)', () => {
  const result = computeEcpmRpm(0, 10);
  assertEquals(result, 0);
});

Deno.test('computeEcpmRpm: handles fractional revenue', () => {
  const result = computeEcpmRpm(500, 1.5);
  // (1.5 / 500) * 1000 = 3
  assertEquals(result, 3);
});

// ---------------------------------------------------------------------------
// normalizeReportRow
// ---------------------------------------------------------------------------

Deno.test('normalizeReportRow: maps known fields from AdMob raw row', () => {
  const raw = {
    estimated_revenue: 2.5,
    impressions: 1000,
    clicks: 20,
    match_rate: 0.85,
    extra_field: 'ignored-but-preserved',
  };
  const row = normalizeReportRow('admob', raw);
  assertEquals(row.network, 'admob');
  assertEquals(row.impressions, 1000);
  assertEquals(row.clicks, 20);
  assertEquals(row.estimated_revenue_usd, 2.5);
  assertEquals(row.fill_rate, 0.85);
});

Deno.test('normalizeReportRow: always sets raw_payload to the full rawRow', () => {
  const raw = { impressions: 500, clicks: 10, unknown_future_field: 'value' };
  const row = normalizeReportRow('adsense', raw);
  // raw_payload must be the full original object
  assertEquals(row.raw_payload, raw);
});

Deno.test('normalizeReportRow: handles missing optional fields gracefully', () => {
  const raw = {};
  const row = normalizeReportRow('admob', raw);
  assertEquals(row.network, 'admob');
  assertEquals(row.impressions, 0);
  assertEquals(row.clicks, 0);
  assertEquals(row.estimated_revenue_usd, 0);
  assertEquals(row.fill_rate, null);
  assertEquals(row.raw_payload, raw);
});

Deno.test('normalizeReportRow: maps AdSense estimated_revenue_micros field', () => {
  // AdSense uses estimated_earnings in micros in some API responses
  const raw = {
    estimated_earnings: 1500000, // micros = $1.50
    impressions: 300,
    clicks: 5,
    page_views: 1200,
  };
  const row = normalizeReportRow('adsense', raw);
  assertEquals(row.network, 'adsense');
  assertEquals(row.raw_payload, raw);
});
