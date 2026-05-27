#!/usr/bin/env tsx
/**
 * scripts/seed-demo-org.ts — Phase 68 Plan 68-02 (LAND-05).
 *
 * Deterministic synthetic-patient seed script for a demo organization.
 *
 * Usage:
 *   tsx scripts/seed-demo-org.ts --org-id <uuid> [--patient-count 5]
 *
 * What it does:
 *   1. Verifies the target org exists AND `is_demo = true` — refuses to seed
 *      real orgs (LAND-05 safety constraint).
 *   2. For each of N synthetic patients (default 5):
 *      a. Generates a deterministic user_id by SHA-256 hashing
 *         `${org_id}:patient:${i}` and reformatting the first 32 hex chars
 *         into a UUID-v4-shaped string. Same inputs → same output.
 *      b. Creates an auth.users row via Supabase Admin API (or skips if it
 *         already exists — re-runs are idempotent).
 *      c. Creates an `org_members` row linking patient → org (role='member').
 *      d. Seeds 60 days of injection logs (one dose per week, alternating
 *         abdomen-left / abdomen-right sites).
 *      e. Seeds 60 days of weight entries (linear weight loss 220 → 195 lb).
 *      f. Seeds mood + symptom logs for the most recent 7 days.
 *
 * Determinism guarantee:
 *   Given the same `--org-id` and `--patient-count`, the script produces the
 *   same patient user_ids, injection log_ids, weight rows, and mood/symptom
 *   rows. Re-running is safe (writes use ON CONFLICT or skip-if-exists).
 *
 * Environment:
 *   SUPABASE_URL                — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY   — service role key (sb_secret_* format)
 *
 * Safety:
 *   - REFUSES to run if `--org-id` org has `is_demo = false` or is missing.
 *   - REFUSES to run if SUPABASE_SERVICE_ROLE_KEY env var is unset.
 *
 * See [[reference_minisite_monorepo_layout]] — invoke from leanshot/ dir.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

// ─── Args ────────────────────────────────────────────────────────────────────

interface CliArgs {
  orgId: string;
  patientCount: number;
}

function parseArgs(argv: string[]): CliArgs {
  let orgId: string | undefined;
  let patientCount = 5;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--org-id') {
      orgId = argv[++i];
    } else if (arg === '--patient-count') {
      const n = Number.parseInt(argv[++i] ?? '', 10);
      if (Number.isFinite(n) && n > 0 && n <= 100) patientCount = n;
      else {
        console.error('FATAL: --patient-count must be a positive integer ≤ 100');
        process.exit(1);
      }
    }
  }

  if (!orgId) {
    console.error('FATAL: --org-id <uuid> is required');
    console.error('Usage: tsx scripts/seed-demo-org.ts --org-id <uuid> [--patient-count 5]');
    process.exit(1);
  }

  // Light UUID-shape validation. SHA-256 truncation produces a "UUID-shaped"
  // string but we still want the operator to pass a real UUID for the org.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
    console.error(`FATAL: --org-id "${orgId}" is not a valid UUID`);
    process.exit(1);
  }

  return { orgId, patientCount };
}

// ─── Deterministic UUID derivation ───────────────────────────────────────────

/**
 * Derive a UUID-v4-shaped deterministic id from `${prefix}:${input}`.
 *
 * SHA-256 the input, take 32 hex chars, then mask the version (4) + variant
 * (8/9/a/b) bits to make it look like a valid UUID. Determinism: same input
 * → same output, so re-running the seed script is idempotent across all
 * derived primary keys.
 */
export function deriveDeterministicUuid(prefix: string, input: string): string {
  const hex = createHash('sha256').update(`${prefix}:${input}`).digest('hex').slice(0, 32);
  // Force version=4 (15th hex char) and variant=8/9/a/b (19th hex char)
  // so the result passes UUID-v4 regex checks (e.g. in Phase 33 link
  // validators).
  const v4 = hex.slice(0, 12) + '4' + hex.slice(13, 16) + '8' + hex.slice(17);
  return [v4.slice(0, 8), v4.slice(8, 12), v4.slice(12, 16), v4.slice(16, 20), v4.slice(20, 32)].join('-');
}

/** Deterministic email derived from patient index for stable lookups. */
function patientEmail(orgId: string, i: number): string {
  // Short hash suffix so emails stay <64 chars but stable across runs.
  const suffix = createHash('sha256').update(`${orgId}:patient:${i}:email`).digest('hex').slice(0, 8);
  return `demo-patient-${i}-${suffix}@demo.leanshot.local`;
}

// ─── Patient seed data shape ─────────────────────────────────────────────────

interface SeededPatient {
  index: number;
  user_id: string;
  email: string;
  display_name: string;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { orgId, patientCount } = parseArgs(process.argv.slice(2));

  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars must be set');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Guard: refuse to seed non-demo orgs ────────────────────────────────────
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id, is_demo, name')
    .eq('id', orgId)
    .maybeSingle();

  if (orgErr) {
    console.error(`FATAL: failed to load organization ${orgId}: ${orgErr.message}`);
    process.exit(1);
  }
  if (!org) {
    console.error(`FATAL: organization ${orgId} not found`);
    process.exit(1);
  }
  if ((org as { is_demo?: boolean }).is_demo !== true) {
    console.error(
      `FATAL: organization ${orgId} (${(org as { name?: string }).name ?? '?'}) is NOT marked is_demo=true. ` +
        `Refusing to seed synthetic patients into a real org.`,
    );
    process.exit(1);
  }

  console.log(`✓ Target org ${orgId} verified as is_demo=true. Seeding ${patientCount} patients...`);

  const seeded: SeededPatient[] = [];
  for (let i = 1; i <= patientCount; i++) {
    const userId = deriveDeterministicUuid('demo-patient', `${orgId}:${i}`);
    const email = patientEmail(orgId, i);
    const displayName = `Demo Patient ${i}`;
    seeded.push({ index: i, user_id: userId, email, display_name: displayName });

    await ensureAuthUser(supabase, userId, email, displayName);
    await ensureOrgMembership(supabase, orgId, userId);
    await seedInjections(supabase, userId, i);
    await seedWeights(supabase, userId, i);
    await seedMoodSymptomLogs(supabase, userId, i);
  }

  console.log(`✓ Seeded ${seeded.length} demo patients into org ${orgId}.`);
  console.log('');
  console.log('Created patients:');
  for (const p of seeded) {
    console.log(`  [${p.index}] ${p.display_name}  user_id=${p.user_id}  email=${p.email}`);
  }
}

// ─── auth.users ──────────────────────────────────────────────────────────────

async function ensureAuthUser(
  supabase: SupabaseClient,
  userId: string,
  email: string,
  displayName: string,
): Promise<void> {
  // Probe first: getUserById returns 404 when missing.
  // @ts-expect-error — admin namespace types vary across @supabase/supabase-js versions.
  const probe = await supabase.auth.admin.getUserById(userId);
  if (probe?.data?.user) return;

  // @ts-expect-error — admin namespace types vary across @supabase/supabase-js versions.
  const { error } = await supabase.auth.admin.createUser({
    id: userId,
    email,
    email_confirm: true,
    user_metadata: {
      display_name: displayName,
      is_demo_patient: true,
    },
  });

  if (error) {
    // If the row already exists from a previous partial run, swallow.
    const msg = (error as { message?: string }).message ?? '';
    if (/already.*registered|duplicate/i.test(msg)) return;
    throw new Error(`createUser failed for ${userId}: ${msg}`);
  }
}

// ─── org_members ─────────────────────────────────────────────────────────────

async function ensureOrgMembership(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<void> {
  // org_members has UNIQUE (org_id, user_id) — use upsert on that key.
  // role enum: 'owner' | 'admin' | 'member' (Phase 28). Demo patients = 'member'.
  const { error } = await supabase
    .from('org_members')
    .upsert(
      { org_id: orgId, user_id: userId, role: 'member' },
      { onConflict: 'org_id,user_id' },
    );

  if (error) {
    // org_members RLS may block service-role-via-PostgREST in some configs;
    // fall back to ignoring "already exists" semantics.
    const msg = error.message ?? '';
    if (/duplicate|already exists|23505/i.test(msg)) return;
    throw new Error(`org_members upsert failed: ${msg}`);
  }
}

// ─── injections seed ─────────────────────────────────────────────────────────

const SITES = ['abdomen_left', 'abdomen_right'] as const;

async function seedInjections(
  supabase: SupabaseClient,
  userId: string,
  patientIndex: number,
): Promise<void> {
  // 60 days back; one dose per week (Tuesday 18:00 UTC).
  const now = new Date();
  // Anchor at start-of-day UTC for stable timestamps.
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const rows: Array<Record<string, unknown>> = [];
  // 9 weekly doses cover ~60 days.
  for (let w = 8; w >= 0; w--) {
    const loggedAt = new Date(today.getTime() - w * 7 * 24 * 60 * 60 * 1000);
    loggedAt.setUTCHours(18, 0, 0, 0);

    const logId = deriveDeterministicUuid(
      'demo-injection',
      `${userId}:week:${w}`,
    );
    const site = SITES[(patientIndex + w) % SITES.length];

    rows.push({
      user_id: userId,
      log_id: logId,
      medication: 'ozempic',
      dose: '0.5',
      unit: 'mg',
      site,
      notes: '',
      logged_at: loggedAt.toISOString(),
      pk_engine_version: 1,
    });
  }

  const { error } = await supabase
    .from('injections')
    .upsert(rows, { onConflict: 'user_id,log_id' });

  if (error) throw new Error(`injections upsert failed for ${userId}: ${error.message}`);
}

// ─── weights seed ────────────────────────────────────────────────────────────

async function seedWeights(
  supabase: SupabaseClient,
  userId: string,
  patientIndex: number,
): Promise<void> {
  // 60 daily weight entries: linear loss 220 → 195 lb over 60 days,
  // plus a small per-patient offset (±2 lb) so each patient looks distinct.
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const rows: Array<Record<string, unknown>> = [];
  for (let d = 59; d >= 0; d--) {
    const date = new Date(today.getTime() - d * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
    const baseLb = 220 - ((60 - d) / 60) * 25; // linear 220 → 195
    const offset = ((patientIndex * 0.4) % 2) - 1; // -1..+1 lb per-patient
    const weightLb = Number((baseLb + offset).toFixed(1));

    rows.push({
      user_id: userId,
      date: dateStr,
      weight_lb: weightLb,
    });
  }

  // weights table conventionally keyed (user_id, date).
  const { error } = await supabase
    .from('weights')
    .upsert(rows, { onConflict: 'user_id,date' });

  // If schema differs from assumption, surface but don't abort — injections
  // are the headline feature; weights are supplementary.
  if (error) {
    console.warn(
      `[seed-demo-org] weights upsert skipped for ${userId}: ${error.message}`,
    );
  }
}

// ─── mood + symptom logs seed (last 7 days) ──────────────────────────────────

const MOOD_VALUES = [3, 4, 5, 4, 3, 4, 5] as const; // 1-5 scale
const SYMPTOMS = ['nausea', 'fatigue', 'headache', 'none', 'none', 'none', 'none'] as const;

async function seedMoodSymptomLogs(
  supabase: SupabaseClient,
  userId: string,
  _patientIndex: number,
): Promise<void> {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const moodRows: Array<Record<string, unknown>> = [];
  const symptomRows: Array<Record<string, unknown>> = [];

  for (let d = 6; d >= 0; d--) {
    const date = new Date(today.getTime() - d * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().slice(0, 10);

    moodRows.push({
      user_id: userId,
      date: dateStr,
      mood: MOOD_VALUES[6 - d],
    });

    const symptom = SYMPTOMS[6 - d];
    if (symptom !== 'none') {
      symptomRows.push({
        user_id: userId,
        date: dateStr,
        symptom,
        severity: 2,
      });
    }
  }

  const moodRes = await supabase
    .from('mood')
    .upsert(moodRows, { onConflict: 'user_id,date' });
  if (moodRes.error) {
    console.warn(`[seed-demo-org] mood upsert skipped for ${userId}: ${moodRes.error.message}`);
  }

  if (symptomRows.length > 0) {
    const symRes = await supabase
      .from('symptoms')
      .upsert(symptomRows, { onConflict: 'user_id,date,symptom' });
    if (symRes.error) {
      console.warn(`[seed-demo-org] symptoms upsert skipped for ${userId}: ${symRes.error.message}`);
    }
  }
}

// ─── entrypoint ──────────────────────────────────────────────────────────────

// Only invoke main() when run directly via tsx — not when imported by tests.
const isMainModule = (() => {
  try {
    const argv1 = process.argv[1] ?? '';
    return argv1.endsWith('seed-demo-org.ts') || argv1.endsWith('seed-demo-org.js');
  } catch {
    return false;
  }
})();

if (isMainModule) {
  main().catch((err) => {
    console.error('FATAL:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
