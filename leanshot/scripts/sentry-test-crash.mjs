#!/usr/bin/env node
// sentry-test-crash.mjs
// Posts a known crash payload to Sentry's store endpoint and polls for the fingerprint
// within 60s to confirm ingestion.
//
// Required env vars:
//   SENTRY_DSN          — e.g. https://<key>@o123456.ingest.sentry.io/<projectId>
//   SENTRY_AUTH_TOKEN   — personal/internal token with project:read scope
//   SENTRY_ORG          — organization slug (e.g. "leanshot")
//   SENTRY_PROJECT      — project slug (e.g. "leanshot-ios")
//
// If any required env var is absent, exits 0 with SKIPPED message (graceful Wave-0 behavior;
// Plan 16-04 will populate these at CI time).
//
// Exit codes: 0 = PASS or SKIPPED, 1 = FAIL

import { randomUUID } from 'node:crypto';

const SCRIPT_NAME = 'sentry-test-crash';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 60000;

const SENTRY_DSN = process.env.SENTRY_DSN;
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN;
const SENTRY_ORG = process.env.SENTRY_ORG;
const SENTRY_PROJECT = process.env.SENTRY_PROJECT;

if (!SENTRY_DSN || !SENTRY_AUTH_TOKEN) {
  console.log(`${SCRIPT_NAME}: SKIPPED (SENTRY_DSN or SENTRY_AUTH_TOKEN not set)`);
  process.exit(0);
}

if (!SENTRY_ORG || !SENTRY_PROJECT) {
  console.log(`${SCRIPT_NAME}: SKIPPED (SENTRY_ORG or SENTRY_PROJECT not set)`);
  process.exit(0);
}

// Parse DSN: https://<publicKey>@<host>/<projectId>
let dsnUrl;
try {
  dsnUrl = new URL(SENTRY_DSN);
} catch {
  console.error(`::error::${SCRIPT_NAME}: invalid SENTRY_DSN format — must be https://<key>@<host>/<projectId>`);
  process.exit(1);
}

const publicKey = dsnUrl.username;
const host = dsnUrl.hostname;
const projectId = dsnUrl.pathname.replace('/', '').replace(/^\//, '');
const storeEndpoint = `https://${host}/api/${projectId}/store/`;

const fingerprint = randomUUID();
const eventId = randomUUID().replace(/-/g, '');
const timestamp = new Date().toISOString();

const sentryEvent = {
  event_id: eventId,
  timestamp,
  level: 'error',
  platform: 'javascript',
  tags: {
    'test-crash': 'phase-16-wave-0',
    fingerprint,
  },
  message: `phase-16-wave-0-harness-test-crash ${fingerprint}`,
  fingerprint: [`phase-16-wave-0-harness-test-crash-${fingerprint}`],
};

// POST to Sentry store endpoint
let storeResponse;
try {
  storeResponse = await fetch(storeEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=sentry-test-crash-mjs/1.0`,
    },
    body: JSON.stringify(sentryEvent),
  });
} catch (err) {
  console.error(`::error::${SCRIPT_NAME}: network error posting to Sentry store endpoint: ${err.message}`);
  process.exit(1);
}

if (!storeResponse.ok) {
  const body = await storeResponse.text();
  console.error(`::error::${SCRIPT_NAME}: Sentry store endpoint returned ${storeResponse.status}: ${body}`);
  process.exit(1);
}

console.log(`${SCRIPT_NAME}: event posted (fingerprint=${fingerprint}); polling for ingestion...`);

// Poll Sentry API for the fingerprint
const apiBase = `https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/events/`;
const pollHeaders = {
  Authorization: `Bearer ${SENTRY_AUTH_TOKEN}`,
  'Content-Type': 'application/json',
};

const deadline = Date.now() + POLL_TIMEOUT_MS;
let matched = false;

while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

  let pollResponse;
  try {
    pollResponse = await fetch(`${apiBase}?query=${encodeURIComponent(fingerprint)}`, {
      headers: pollHeaders,
    });
  } catch (err) {
    console.error(`::error::${SCRIPT_NAME}: network error polling Sentry events API: ${err.message}`);
    process.exit(1);
  }

  if (!pollResponse.ok) {
    const body = await pollResponse.text();
    console.error(`::error::${SCRIPT_NAME}: Sentry events API returned ${pollResponse.status}: ${body}`);
    process.exit(1);
  }

  const events = await pollResponse.json();
  if (Array.isArray(events) && events.length > 0) {
    matched = true;
    break;
  }
}

if (!matched) {
  console.error(
    `::error::${SCRIPT_NAME}: Sentry did not ingest the fingerprint within ${POLL_TIMEOUT_MS / 1000}s — DSN/auth token may be wrong`
  );
  process.exit(1);
}

console.log(`${SCRIPT_NAME}: PASS (fingerprint=${fingerprint} matched)`);
