#!/usr/bin/env node
/**
 * PostHog event-definitions sync script.
 *
 * Reads EVENTS (non-PHI) from src/lib/analytics/events.ts and
 * PHI_EVENTS from src/lib/analytics/events.phi.ts, generates JSON schemas
 * via zod-to-json-schema, and PATCHes each event-definition through the
 * PostHog event-definitions REST API.
 *
 * Phase 24 D-11/TAXO-01/TAXO-06.
 *
 * Usage:
 *   POSTHOG_PROJECT_ID=<id> POSTHOG_PROJECT_API_KEY=<phx_...> node --import tsx scripts/sync-posthog-event-defs.ts [--dry-run]
 *   npm run sync-posthog [-- --dry-run]
 *
 * REVIEWER NOTE: zod-to-json-schema@^3 is used here. This package was listed
 * as [ASSUMED OK] in the Phase 24 RESEARCH package legitimacy audit —
 * a full slopcheck was not run at research time. Please verify:
 *   npx is-malware zod-to-json-schema  (or review package on npmjs.com/package/zod-to-json-schema)
 *
 * PostHog REST API shape (verified 2026-05-17 against PostHog docs):
 *   PATCH /api/projects/{project_id}/event_definitions/{event_name}/
 *   Body: { name: string, description?: string, tags?: string[] }
 *   Auth: Authorization: Bearer <personal_api_key>
 *   If 404: definition not yet in PostHog — POST to create, or SKIP (PostHog
 *   auto-creates on first event ingest). This script uses PATCH and falls back
 *   to a warning log on 404 (skip + continue) so first-run doesn't hard-fail
 *   before any events have been ingested. On 422/5xx: hard-fail (API error).
 *
 * Security: API key is read from env; never echoed in logs. Error messages
 * include HTTP status + response body (NOT headers, so key is never leaked).
 */

import { EVENTS } from '../src/lib/analytics/events.js';
import { PHI_EVENTS } from '../src/lib/analytics/events.phi.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { readFileSync } from 'node:fs';

const DRY = process.argv.includes('--dry-run');

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

// Vendor-gated env checks (fail loud + early per D-11 / reference_vendor_gated_send_health_check)
const projectId = process.env.POSTHOG_PROJECT_ID;
if (!projectId) fail('Error: POSTHOG_PROJECT_ID required');

const apiKey = process.env.POSTHOG_PROJECT_API_KEY;
if (!apiKey) fail('Error: POSTHOG_PROJECT_API_KEY required');

const host = process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com';

// TAXO-06 reconciliation guard: refuse to sync if events.ts header lost the
// reconciliation marker. This ensures the ESLint additive-only rule is in place
// before we sync definitions to PostHog.
const eventsSrc = readFileSync('src/lib/analytics/events.ts', 'utf8');
if (!eventsSrc.includes('TAXO-06 reconciliation:')) {
  fail(
    'Error: TAXO-06 reconciliation marker missing from events.ts header — refusing to sync. ' +
      'Ensure the additive-only ESLint rule comment is intact before syncing event definitions.',
  );
}

type SyncEvent = {
  name: string;
  description: string;
  phi: boolean;
  jsonSchema: object;
};

// Collect all events from both registries
const allEvents: SyncEvent[] = [];

for (const [, def] of Object.entries(EVENTS)) {
  allEvents.push({
    name: def.name,
    description: def.description,
    phi: def.phi,
    jsonSchema: zodToJsonSchema(def.payload),
  });
}

for (const [, def] of Object.entries(PHI_EVENTS)) {
  allEvents.push({
    name: def.name,
    description: def.description,
    phi: def.phi,
    jsonSchema: zodToJsonSchema(def.payload),
  });
}

async function syncOne(ev: SyncEvent): Promise<void> {
  const url = `${host}/api/projects/${projectId}/event_definitions/${encodeURIComponent(ev.name)}/`;
  const body = {
    name: ev.name,
    description: ev.description,
    // PHI flag stored as tag for PostHog UI visibility (T-24-08c: key not in body)
    tags: [ev.phi ? 'phi' : 'non-phi'],
  };

  if (DRY) {
    console.log(`[DRY] PATCH ${url} body=${JSON.stringify(body)}`);
    return;
  }

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      // Security: key injected via masked env var; never echoed in logs (T-24-08c)
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 404) {
    // Definition not yet in PostHog — PostHog auto-creates on first event ingest.
    // Skip with a warning rather than hard-failing on first run before any events
    // have been ingested. Subsequent pushes after ingest will find the definition.
    console.warn(`[WARN] 404 for ${ev.name} — definition not yet in PostHog (first ingest creates it)`);
    return;
  }

  if (!res.ok) {
    const body_text = await res.text();
    fail(`PATCH ${ev.name} failed: ${res.status} ${body_text}`);
  }

  console.log(`[OK] ${ev.name}`);
}

(async () => {
  for (const ev of allEvents) {
    await syncOne(ev);
  }
  console.log(`${DRY ? '[DRY] Would sync' : 'Synced'} ${allEvents.length} event definitions.`);
})().catch((e) => fail(String(e)));
