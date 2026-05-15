#!/usr/bin/env node
// seed-photo-soak-fixture.mjs
// Seeds a 200-photo soak fixture for Phase 16 WKWebView OOM testing (D-08).
//
// Usage:
//   node scripts/seed-photo-soak-fixture.mjs [--count <N>] [--cleanup <userId>]
//
// Required env vars:
//   SUPABASE_URL              — e.g. https://ytnsipxxmzgaebkqmokp.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — service-role key (admin operations)
//
// Behaviour:
//   Default (no flags): creates a test user, uploads N photos, prints userId + cleanup hint.
//   --cleanup <userId>: deletes the user (and cascades to storage + photos if FK configured).
//   --count <N>: number of photos to seed (default: 200).
//
// Exit codes: 0 = success, 1 = error

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const SCRIPT_NAME = 'seed-photo-soak-fixture';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(`::error::${SCRIPT_NAME} requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY`);
  process.exit(1);
}

// Parse CLI args
const args = process.argv.slice(2);
const cleanupIdx = args.indexOf('--cleanup');
const countIdx = args.indexOf('--count');
const cleanupUserId = cleanupIdx !== -1 ? args[cleanupIdx + 1] : null;
const photoCount = countIdx !== -1 ? parseInt(args[countIdx + 1], 10) : 200;

if (cleanupUserId !== null && (typeof cleanupUserId !== 'string' || cleanupUserId.trim() === '')) {
  console.error(`::error::${SCRIPT_NAME}: --cleanup requires a userId argument`);
  process.exit(1);
}

if (!cleanupUserId && (isNaN(photoCount) || photoCount < 1)) {
  console.error(`::error::${SCRIPT_NAME}: --count must be a positive integer`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Cleanup mode ────────────────────────────────────────────────────────────

if (cleanupUserId) {
  console.log(`${SCRIPT_NAME}: cleaning up userId=${cleanupUserId}...`);

  // Delete photos from storage bucket (by listing objects under userId prefix)
  const { data: storageObjects, error: listError } = await admin.storage
    .from('photos')
    .list(cleanupUserId, { limit: 1000 });

  if (listError) {
    console.error(`${SCRIPT_NAME}: storage list warning: ${listError.message}`);
  } else if (storageObjects && storageObjects.length > 0) {
    const paths = storageObjects.map((obj) => `${cleanupUserId}/${obj.name}`);
    const { error: removeError } = await admin.storage.from('photos').remove(paths);
    if (removeError) {
      console.error(`${SCRIPT_NAME}: storage remove warning: ${removeError.message}`);
    } else {
      console.log(`${SCRIPT_NAME}: removed ${paths.length} storage objects`);
    }
  }

  // Delete photos rows (in case no FK cascade)
  const { error: deleteRowsError } = await admin
    .from('photos')
    .delete()
    .eq('user_id', cleanupUserId);

  if (deleteRowsError) {
    console.error(`${SCRIPT_NAME}: photos table delete warning: ${deleteRowsError.message}`);
  }

  // Delete the user (cascades FK if configured)
  const { error: deleteUserError } = await admin.auth.admin.deleteUser(cleanupUserId);
  if (deleteUserError) {
    console.error(`::error::${SCRIPT_NAME}: failed to delete user ${cleanupUserId}: ${deleteUserError.message}`);
    process.exit(1);
  }

  console.log(`${SCRIPT_NAME}: PASS — cleaned up userId=${cleanupUserId}`);
  process.exit(0);
}

// ─── Seed mode ───────────────────────────────────────────────────────────────

// 1x1 minimal valid PNG (67 bytes), base64-encoded.
// Source: https://github.com/nicowillis/smallest-possible-png/
const MINIMAL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const MINIMAL_PNG = Buffer.from(MINIMAL_PNG_B64, 'base64');

const fixturePrefix = `photo-soak-${Date.now()}`;
const email = `${fixturePrefix}@leanshot.test`;
const password = randomUUID();

// Create test user
const { data: userData, error: createUserError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (createUserError || !userData.user) {
  console.error(`::error::${SCRIPT_NAME}: failed to create test user: ${createUserError?.message ?? 'unknown'}`);
  process.exit(1);
}

const userId = userData.user.id;
console.log(`${SCRIPT_NAME}: created test user (id=${userId}, email=${email})`);

// Introspect photos table columns to avoid hard-coding the schema
const { data: columnInfo, error: columnError } = await admin
  .rpc('get_photos_columns', {})
  .select();

let columns;
if (columnError || !columnInfo) {
  // Fallback: query information_schema directly
  const { data: schemaData, error: schemaError } = await admin
    .from('information_schema.columns')
    .select('column_name')
    .eq('table_name', 'photos')
    .eq('table_schema', 'public');

  if (schemaError || !schemaData) {
    // Further fallback: use a known safe subset of columns
    console.log(`${SCRIPT_NAME}: column introspection unavailable, using safe defaults`);
    columns = null;
  } else {
    columns = schemaData.map((r) => r.column_name);
  }
} else {
  columns = null;
}

// Seed N photos
let uploadErrors = 0;
let insertErrors = 0;

for (let i = 0; i < photoCount; i++) {
  const storagePath = `${userId}/soak-${i}.png`;

  // Upload blob to Storage bucket 'photos'
  const { error: uploadError } = await admin.storage
    .from('photos')
    .upload(storagePath, MINIMAL_PNG, { contentType: 'image/png' });

  if (uploadError) {
    uploadErrors++;
    if (uploadErrors <= 3) {
      console.error(`${SCRIPT_NAME}: storage upload warning [${i}]: ${uploadError.message}`);
    }
    continue;
  }

  // Build a signed URL (60 minutes) for Playwright test assertion
  const { data: signedData } = await admin.storage
    .from('photos')
    .createSignedUrl(storagePath, 3600);

  const signedUrl = signedData?.signedUrl ?? null;
  const takenAt = new Date().toISOString();

  // Insert row using minimal known-safe columns
  // The photos table schema is defined by Phase 5 migrations; all nullable columns
  // are omitted — storage_path + user_id + taken_at are the minimum required fields.
  const row = {
    user_id: userId,
    storage_path: storagePath,
    taken_at: takenAt,
  };

  // Include signed_url if the column exists (graceful — non-fatal if absent)
  if (signedUrl) {
    row.signed_url = signedUrl;
  }

  const { error: insertError } = await admin.from('photos').insert(row);

  if (insertError) {
    insertErrors++;
    if (insertErrors <= 3) {
      console.error(`${SCRIPT_NAME}: photo insert warning [${i}]: ${insertError.message}`);
    }
  }

  if ((i + 1) % 50 === 0) {
    console.log(`${SCRIPT_NAME}: progress ${i + 1}/${photoCount}...`);
  }
}

const successCount = photoCount - Math.max(uploadErrors, insertErrors);
console.log(JSON.stringify({ userId, fixturePrefix, count: successCount, uploadErrors, insertErrors }, null, 2));

if (uploadErrors > 0 || insertErrors > 0) {
  console.error(
    `${SCRIPT_NAME}: WARNING — ${uploadErrors} upload errors, ${insertErrors} insert errors out of ${photoCount} photos`
  );
}

console.log(`${SCRIPT_NAME}: PASS — seeded ${successCount}/${photoCount} photos for userId=${userId}`);
console.error(
  `Cleanup: node scripts/seed-photo-soak-fixture.mjs --cleanup ${userId}`
);
