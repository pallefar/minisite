/**
 * Phase 7 Plan 07-06 — pure export helpers for COMPL-06 (data portability).
 *
 * `buildJsonExport` + `buildPdfDoc` are tree-shakable, UI-free, and accept the
 * heavy jsPDF/autoTable runtime as INJECTED parameters so this module never
 * adds jsPDF to its own static import graph. The Settings click handler is
 * the ONLY place that dynamic-imports jsPDF — preserving the 50 kB index gz
 * ceiling pinned by `scripts/assert-vendor-react-size.sh` and the new
 * `scripts/assert-bundle-budget.sh` jspdf-chunk-topology guard.
 *
 * Whitelist discipline (Threat T-07-06-02): `buildJsonExport` enumerates the
 * 22 partialize keys from `src/lib/store.ts:1865-1892` explicitly. No
 * Object.keys pass-through. No raw localStorage. No supabase session token.
 *
 * Audit-log summary (Threat T-07-06-03 / Open Question #5): we ship counts
 * per action only — never raw rows. `fetchAuditSummary` uses HEAD-count
 * queries so the row bytes never leave Supabase.
 *
 * Photo policy (Threat T-07-06-01): PDF photo section is COUNT + date-range
 * only. `buildPdfDoc` never calls `doc.addImage(...)`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PersistedState } from '@/lib/storage';

// NOTE: NO value-import of jspdf or jspdf-autotable at the top level. The
// click handler in SettingsPage.tsx dynamic-imports them and passes them in.
// `import type` is fine (erased at compile time).
import type { jsPDF as JsPDFType } from 'jspdf';
import type autoTableFn from 'jspdf-autotable';

// The 22 keys from src/lib/store.ts:1865-1892 partialize allow-list. Kept
// as a `const` array so it's a single source of truth for the whitelist
// + the regression test can reference it via Object.keys reflection if
// needed without re-typing.
export const EXPORT_WHITELIST_KEYS = [
  'user',
  'injections',
  'symptoms',
  'weights',
  'measurements',
  'meals',
  'water',
  'foodNoise',
  'workouts',
  'steps',
  'supplements',
  'mood',
  'sleep',
  'nsvs',
  'photos',
  'vials',
  'aiHistory',
  'costs',
  'acknowledgedDisclaimer',
  'pendingOps',
  'verificationBannerDismissedUntil',
  'migration_state',
] as const;

export type ExportLocalKey = (typeof EXPORT_WHITELIST_KEYS)[number];

export interface AuditSummary {
  window: '13mo';
  /** count of rows with action='insert' for this user, last 13 months */
  inserts: number;
  /** count of rows with action='update' for this user, last 13 months */
  updates: number;
  /** count of rows with action='delete' for this user, last 13 months */
  deletes: number;
  /** count of rows with action='account_deleted_initiated' (if the schema has it) */
  initiated_count: number;
  /** count of rows with action='account_deleted_finalized' (if the schema has it) */
  finalized_count: number;
}

export interface ExportMeta {
  exportedAt: string;
  exportVersion: 1;
  appVersion: string;
  source: 'local-only' | 'local+cloud';
  audit_summary?: AuditSummary;
  /** ai_messages cloud row count — count only, NEVER full text (T-07-06-03) */
  ai_messages_count?: number;
}

export interface CloudExtras {
  injections?: unknown[];
  weights?: unknown[];
  meals?: unknown[];
  workouts?: unknown[];
  mood?: unknown[];
  sleep?: unknown[];
  symptoms?: unknown[];
  vials?: unknown[];
  photos?: unknown[];
  ai_messages_count?: number;
}

export type ExportLocal = Pick<PersistedState, ExportLocalKey>;

export interface ExportPayload {
  meta: ExportMeta;
  local: ExportLocal;
}

/**
 * Build the JSON export payload from a hydrated PersistedState snapshot.
 *
 * EXPLICIT WHITELIST — never serializes localStorage, supabase session tokens,
 * anthropic keys, or any unlisted key. Cloud extras overwrite the
 * corresponding local arrays when present (cloud ground truth wins). Audit
 * summary lives under `meta.audit_summary` — the raw rows array is NEVER
 * included (T-07-06-03 mitigation).
 *
 * @param state — typed `PersistedState` snapshot from `useStore.getState()` partialized.
 * @param cloudExtras — pulled by `fetchCloudExtras` before this call; pass `null` for local-only export.
 * @param auditSummary — pulled by `fetchAuditSummary` before this call; pass `null` to omit.
 * @param appVersion — optional override for `meta.appVersion`; defaults to "2.0.0" (matches package.json).
 */
export function buildJsonExport(
  state: PersistedState,
  cloudExtras: CloudExtras | null,
  auditSummary: AuditSummary | null,
  appVersion: string = '2.0.0',
): ExportPayload {
  // Build the local block by EXPLICITLY copying each whitelisted key. Any
  // additional key on `state` (typed or rogue) is silently dropped. This is
  // the regression-test linchpin for T-07-06-02.
  const local: ExportLocal = {
    user: state.user,
    injections: state.injections,
    symptoms: state.symptoms,
    weights: state.weights,
    measurements: state.measurements,
    meals: state.meals,
    water: state.water,
    foodNoise: state.foodNoise,
    workouts: state.workouts,
    steps: state.steps,
    supplements: state.supplements,
    mood: state.mood,
    sleep: state.sleep,
    nsvs: state.nsvs,
    photos: state.photos,
    vials: state.vials,
    aiHistory: state.aiHistory,
    costs: state.costs,
    acknowledgedDisclaimer: state.acknowledgedDisclaimer,
    pendingOps: state.pendingOps,
    verificationBannerDismissedUntil: state.verificationBannerDismissedUntil,
    migration_state: state.migration_state,
  };

  // Cloud ground-truth overrides for the entity arrays present in cloudExtras.
  // Cast to unknown then to ExportLocal's array type to satisfy TS; the cloud
  // rows already match the local shape via the mapServer*ToLocal helpers in
  // src/lib/sync.ts (pullInitial* functions overwrite the slices the same way).
  if (cloudExtras) {
    if (cloudExtras.injections) local.injections = cloudExtras.injections as ExportLocal['injections'];
    if (cloudExtras.weights) local.weights = cloudExtras.weights as ExportLocal['weights'];
    if (cloudExtras.meals) local.meals = cloudExtras.meals as ExportLocal['meals'];
    if (cloudExtras.workouts) local.workouts = cloudExtras.workouts as ExportLocal['workouts'];
    if (cloudExtras.mood) local.mood = cloudExtras.mood as ExportLocal['mood'];
    if (cloudExtras.sleep) local.sleep = cloudExtras.sleep as ExportLocal['sleep'];
    if (cloudExtras.symptoms) local.symptoms = cloudExtras.symptoms as ExportLocal['symptoms'];
    if (cloudExtras.vials) local.vials = cloudExtras.vials as ExportLocal['vials'];
    if (cloudExtras.photos) local.photos = cloudExtras.photos as ExportLocal['photos'];
  }

  const meta: ExportMeta = {
    exportedAt: new Date().toISOString(),
    exportVersion: 1,
    appVersion,
    source: cloudExtras || auditSummary ? 'local+cloud' : 'local-only',
  };
  if (auditSummary) meta.audit_summary = auditSummary;
  if (cloudExtras?.ai_messages_count !== undefined) {
    meta.ai_messages_count = cloudExtras.ai_messages_count;
  }

  return { meta, local };
}

/**
 * Fetch cloud ground truth for the 9 sync tables + ai_messages count. RLS
 * already scopes to `auth.uid()`; no service_role needed. Returns null on any
 * error (export degrades to local-only — never blocks the user).
 *
 * The full row arrays for the 8 RLS-scoped sync tables are pulled; photos are
 * pulled via .photos only metadata (signed URLs would need the storage client
 * + a re-render; v1 ships local data URLs from state which are already
 * embedded). `ai_messages` is COUNT ONLY (Threat T-07-06-03).
 */
export async function fetchCloudExtras(
  supabase: SupabaseClient,
  userId: string,
): Promise<CloudExtras | null> {
  try {
    const [
      injections,
      weights,
      meals,
      workouts,
      mood,
      sleep,
      symptoms,
      vials,
      photos,
      aiCount,
    ] = await Promise.all([
      supabase.from('injections').select('*').eq('user_id', userId),
      supabase.from('weights').select('*').eq('user_id', userId),
      supabase.from('meals').select('*').eq('user_id', userId),
      supabase.from('workouts').select('*').eq('user_id', userId),
      supabase.from('mood').select('*').eq('user_id', userId),
      supabase.from('sleep').select('*').eq('user_id', userId),
      supabase.from('symptoms').select('*').eq('user_id', userId),
      supabase.from('vials').select('*').eq('user_id', userId),
      supabase.from('photos').select('*').eq('user_id', userId),
      // ai_messages: HEAD count only — never raw rows (T-07-06-03).
      supabase.from('ai_messages').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    ]);

    const extras: CloudExtras = {};
    if (!injections.error && injections.data) extras.injections = injections.data;
    if (!weights.error && weights.data) extras.weights = weights.data;
    if (!meals.error && meals.data) extras.meals = meals.data;
    if (!workouts.error && workouts.data) extras.workouts = workouts.data;
    if (!mood.error && mood.data) extras.mood = mood.data;
    if (!sleep.error && sleep.data) extras.sleep = sleep.data;
    if (!symptoms.error && symptoms.data) extras.symptoms = symptoms.data;
    if (!vials.error && vials.data) extras.vials = vials.data;
    if (!photos.error && photos.data) extras.photos = photos.data;
    if (!aiCount.error) extras.ai_messages_count = aiCount.count ?? 0;
    return extras;
  } catch (e) {
    console.warn('[leanshot] fetchCloudExtras failed; export degrading to local-only', e);
    return null;
  }
}

/**
 * Fetch audit_logs SUMMARY — counts per action only (Open Question #5 /
 * D-04 retention privacy). Uses `select('*', { count: 'exact', head: true })`
 * filtered by `action=<value>` per call. Returns null on error.
 *
 * The trigger pipeline (07-08 / D-04) writes `action` ∈
 * {`insert`, `update`, `delete`} for the 10 sync tables. Account-deletion
 * events live under `account_deleted_initiated` / `account_deleted_finalized`
 * (Phase 7 07-07 — may or may not exist yet; we count 0 if the schema is
 * empty for that action). Critically: `user_id_hash` is the FK column, but
 * the table also exposes `user_id` for RLS-scoped reads (so the client can
 * read its own audit trail without holding the hash). We filter by `user_id`.
 */
export async function fetchAuditSummary(
  supabase: SupabaseClient,
  userId: string,
): Promise<AuditSummary | null> {
  try {
    const headCount = (action: string) =>
      supabase
        .from('audit_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('action', action);

    const [ins, upd, del, init, fin] = await Promise.all([
      headCount('insert'),
      headCount('update'),
      headCount('delete'),
      headCount('account_deleted_initiated'),
      headCount('account_deleted_finalized'),
    ]);
    // If ANY of the three core counts errored (e.g., RLS denied), bail —
    // returning a partial summary would mislead the user.
    if (ins.error || upd.error || del.error) {
      console.warn('[leanshot] fetchAuditSummary core counts failed', ins.error || upd.error || del.error);
      return null;
    }
    return {
      window: '13mo',
      inserts: ins.count ?? 0,
      updates: upd.count ?? 0,
      deletes: del.count ?? 0,
      initiated_count: init.error ? 0 : init.count ?? 0,
      finalized_count: fin.error ? 0 : fin.count ?? 0,
    };
  } catch (e) {
    console.warn('[leanshot] fetchAuditSummary failed', e);
    return null;
  }
}

/* ----------------------------- PDF builder ------------------------------ */

/** Format a date like 2026-05-12 from anything Date-like. Returns "—" if invalid. */
function fmtDate(input: unknown): string {
  if (!input) return '—';
  try {
    const d = typeof input === 'string' || typeof input === 'number' ? new Date(input) : null;
    if (!d || Number.isNaN(d.getTime())) return '—';
    return d.toISOString().slice(0, 10);
  } catch {
    return '—';
  }
}

/** Truncate an array to the last `n` rows by inspecting common date fields. */
function lastN<T>(arr: T[] | undefined, n: number): T[] {
  if (!arr || arr.length === 0) return [];
  return arr.slice(Math.max(0, arr.length - n));
}

/**
 * Build the PDF document. jsPDF + autoTable are INJECTED (not imported) so
 * this module never adds the heavy SDK to its own static graph. The click
 * handler dynamic-imports them and passes them in.
 *
 * Layout:
 *   1. Cover page (email, export date, app version)
 *   2. Profile table
 *   3. Injections (last 30)
 *   4. Weights (last 30)
 *   5. Measurements (last 30)
 *   6. Meals (last 30 — simplified; full per-week summary is v2)
 *   7. Workouts (last 20)
 *   8. Symptoms (last 30)
 *   9. Mood (last 14) + Sleep (last 14)
 *  10. Photo summary (count + earliest/latest — NEVER addImage; T-07-06-01)
 *  11. AI conversation summary (count only — NEVER full text; T-07-06-03)
 *  12. Audit-log summary (5 rows)
 *
 * Returns the populated jsPDF instance (caller calls `.save(filename)`).
 */
export function buildPdfDoc(
  JsPDFCtor: typeof JsPDFType,
  autoTable: typeof autoTableFn,
  payload: ExportPayload,
): JsPDFType {
  const doc = new JsPDFCtor({ unit: 'pt', format: 'letter' });
  const { meta, local } = payload;
  const user = local.user;
  const emailLine =
    typeof user === 'object' && user && 'name' in user
      ? String((user as { name?: unknown }).name ?? '—')
      : '—';

  // ---- 1. Cover page ----
  doc.setFontSize(22);
  doc.text('LeanShot Health Export', 40, 60);
  doc.setFontSize(12);
  doc.text(`Name: ${emailLine}`, 40, 90);
  doc.text(`Exported: ${meta.exportedAt.slice(0, 10)}`, 40, 108);
  doc.text(`App version: ${meta.appVersion}`, 40, 126);
  doc.text(`Source: ${meta.source}`, 40, 144);
  doc.setFontSize(10);
  doc.text(
    'This document summarises locally-stored LeanShot data. Photos are summarised by count and date range only — original image bytes are not embedded.',
    40,
    172,
    { maxWidth: 520 },
  );

  let cursorY = 210;

  // ---- 2. Profile table ----
  const u = (user ?? {}) as Record<string, unknown>;
  autoTable(doc, {
    startY: cursorY,
    head: [['Field', 'Value']],
    body: [
      ['Name', String(u.name ?? '—')],
      ['Units', String(u.units ?? '—')],
      ['Goal weight', String(u.goalWeight ?? '—')],
      ['Protein target', String(u.proteinTarget ?? '—')],
      ['Calorie target', String(u.calorieTarget ?? '—')],
      ['Fiber target', String(u.fiberTarget ?? '—')],
      ['Water target', String(u.waterTarget ?? '—')],
    ],
    headStyles: { fillColor: [60, 60, 60] },
    margin: { left: 40, right: 40 },
    didDrawPage: () => {
      // no-op — placeholder hook for future header/footer.
    },
  });
  cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY + 200;

  // ---- 3. Injections (last 30) ----
  const injectionsBody = lastN(local.injections as unknown[] | undefined, 30).map((r) => {
    const x = r as Record<string, unknown>;
    return [
      fmtDate(x.logged_at ?? x.date ?? x.timestamp),
      String(x.site ?? '—'),
      String(x.medication ?? x.compound ?? '—'),
      String(x.dose ?? '—'),
    ];
  });
  autoTable(doc, {
    startY: cursorY + 20,
    head: [['Date', 'Site', 'Compound', 'Dose']],
    body: injectionsBody.length ? injectionsBody : [['—', '—', '—', '—']],
    headStyles: { fillColor: [60, 60, 60] },
    margin: { left: 40, right: 40 },
  });
  cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY + 200;

  // ---- 4. Weights (last 30) ----
  const weightsBody = lastN(local.weights as unknown[] | undefined, 30).map((r) => {
    const x = r as Record<string, unknown>;
    return [fmtDate(x.date ?? x.logged_at), String(x.weight ?? x.value ?? '—')];
  });
  autoTable(doc, {
    startY: cursorY + 20,
    head: [['Date', 'Weight']],
    body: weightsBody.length ? weightsBody : [['—', '—']],
    headStyles: { fillColor: [60, 60, 60] },
    margin: { left: 40, right: 40 },
  });
  cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY + 200;

  // ---- 5. Measurements (last 30) ----
  const measBody = lastN(local.measurements as unknown[] | undefined, 30).map((r) => {
    const x = r as Record<string, unknown>;
    return [
      fmtDate(x.date),
      String(x.waist ?? '—'),
      String(x.hip ?? '—'),
      String(x.chest ?? '—'),
    ];
  });
  autoTable(doc, {
    startY: cursorY + 20,
    head: [['Date', 'Waist', 'Hip', 'Chest']],
    body: measBody.length ? measBody : [['—', '—', '—', '—']],
    headStyles: { fillColor: [60, 60, 60] },
    margin: { left: 40, right: 40 },
  });
  cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY + 200;

  // ---- 6. Meals (last 30) ----
  const mealsBody = lastN(local.meals as unknown[] | undefined, 30).map((r) => {
    const x = r as Record<string, unknown>;
    return [
      fmtDate(x.date ?? x.logged_at),
      String(x.protein ?? '—'),
      String(x.calories ?? '—'),
      String(x.fiber ?? '—'),
    ];
  });
  autoTable(doc, {
    startY: cursorY + 20,
    head: [['Date', 'Protein', 'Calories', 'Fiber']],
    body: mealsBody.length ? mealsBody : [['—', '—', '—', '—']],
    headStyles: { fillColor: [60, 60, 60] },
    margin: { left: 40, right: 40 },
  });
  cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY + 200;

  // ---- 7. Workouts (last 20) ----
  const workoutsBody = lastN(local.workouts as unknown[] | undefined, 20).map((r) => {
    const x = r as Record<string, unknown>;
    return [
      fmtDate(x.date ?? x.logged_at),
      String(x.type ?? '—'),
      String(x.duration ?? '—'),
      String(x.notes ?? ''),
    ];
  });
  autoTable(doc, {
    startY: cursorY + 20,
    head: [['Date', 'Type', 'Duration', 'Notes']],
    body: workoutsBody.length ? workoutsBody : [['—', '—', '—', '—']],
    headStyles: { fillColor: [60, 60, 60] },
    margin: { left: 40, right: 40 },
  });
  cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY + 200;

  // ---- 8. Symptoms (last 30) ----
  const sxBody = lastN(local.symptoms as unknown[] | undefined, 30).map((r) => {
    const x = r as Record<string, unknown>;
    return [
      fmtDate(x.date ?? x.logged_at),
      String(x.symptom ?? x.name ?? '—'),
      String(x.severity ?? '—'),
    ];
  });
  autoTable(doc, {
    startY: cursorY + 20,
    head: [['Date', 'Symptom', 'Severity']],
    body: sxBody.length ? sxBody : [['—', '—', '—']],
    headStyles: { fillColor: [60, 60, 60] },
    margin: { left: 40, right: 40 },
  });
  cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY + 200;

  // ---- 9. Mood + Sleep (last 14 each) ----
  const moodBody = lastN(local.mood as unknown[] | undefined, 14).map((r) => {
    const x = r as Record<string, unknown>;
    return [fmtDate(x.date ?? x.logged_at), String(x.score ?? x.mood ?? '—')];
  });
  autoTable(doc, {
    startY: cursorY + 20,
    head: [['Date', 'Mood score']],
    body: moodBody.length ? moodBody : [['—', '—']],
    headStyles: { fillColor: [60, 60, 60] },
    margin: { left: 40, right: 40 },
  });
  cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY + 200;

  const sleepBody = lastN(local.sleep as unknown[] | undefined, 14).map((r) => {
    const x = r as Record<string, unknown>;
    return [fmtDate(x.date ?? x.logged_at), String(x.hours ?? '—')];
  });
  autoTable(doc, {
    startY: cursorY + 20,
    head: [['Date', 'Sleep hours']],
    body: sleepBody.length ? sleepBody : [['—', '—']],
    headStyles: { fillColor: [60, 60, 60] },
    margin: { left: 40, right: 40 },
  });
  cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY + 200;

  // ---- 10. Photo summary (count + date range only — T-07-06-01) ----
  const photos = (local.photos ?? []) as Array<Record<string, unknown>>;
  doc.setFontSize(14);
  doc.text('Photos', 40, cursorY + 32);
  doc.setFontSize(11);
  if (photos.length === 0) {
    doc.text('No photos', 40, cursorY + 52);
  } else {
    // Find earliest + latest date across whatever date field exists.
    const dates = photos
      .map((p) => p.takenAt ?? p.created_at ?? p.date)
      .filter((d): d is string | number => Boolean(d))
      .map((d) => new Date(d as string | number).getTime())
      .filter((t) => !Number.isNaN(t));
    const earliest = dates.length ? new Date(Math.min(...dates)).toISOString().slice(0, 10) : '—';
    const latest = dates.length ? new Date(Math.max(...dates)).toISOString().slice(0, 10) : '—';
    doc.text(
      `${photos.length} photos · earliest ${earliest} · latest ${latest}`,
      40,
      cursorY + 52,
    );
  }
  cursorY += 70;

  // ---- 11. AI conversation summary (count only — T-07-06-03) ----
  doc.setFontSize(14);
  doc.text('AI coach conversations', 40, cursorY + 20);
  doc.setFontSize(11);
  const aiCount =
    meta.ai_messages_count !== undefined
      ? meta.ai_messages_count
      : (local.aiHistory ?? []).length;
  doc.text(`${aiCount} messages (transcripts not included)`, 40, cursorY + 40);
  cursorY += 60;

  // ---- 12. Audit-log summary ----
  if (meta.audit_summary) {
    const s = meta.audit_summary;
    autoTable(doc, {
      startY: cursorY + 20,
      head: [['Audit action', 'Count']],
      body: [
        ['Inserts', String(s.inserts)],
        ['Updates', String(s.updates)],
        ['Deletes', String(s.deletes)],
        ['Account-delete initiated', String(s.initiated_count)],
        ['Account-delete finalized', String(s.finalized_count)],
      ],
      headStyles: { fillColor: [60, 60, 60] },
      margin: { left: 40, right: 40 },
    });
  }

  return doc;
}
