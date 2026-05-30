/**
 * Phase 71 Plan 71-01 (PU-01) — admin "Push Updates" CRUD wrapper.
 *
 * Thin supabase-js wrappers around RLS-gated PostgREST writes on
 * `public.changelog_entries`. Mirrors `src/lib/admin/iframe-allowlist.ts`
 * (Pattern S1): each function accepts the caller's authenticated
 * `SupabaseClient` so RLS `auth.uid()` picks up the admin JWT (a service-role
 * context would fail the `is_admin_at_least('admin')` gate — see
 * feedback_rpc_auth_uid_vs_service_role_mismatch).
 *
 * Writes go through direct `.insert` / `.update` (NOT a SECDEF RPC): the
 * INSERT/UPDATE/DELETE policies on changelog_entries already gate on
 * is_admin_at_least('admin') (20270704000012). After each successful write we
 * record a `log_admin_action` audit row to match the admin write convention.
 * The audit leg is BEST-EFFORT: a failure there is warned but never rolls back
 * or re-throws — the write already succeeded server-side.
 *
 * Draft visibility is enforced by RLS (Plan 71-01 migration tightens the SELECT
 * to published-or-admin) + the useChangelog query filter (defense in depth).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type ProductUpdateStatus = 'draft' | 'published' | 'archived';

export interface ProductUpdateEntry {
  id: string;
  slug: string;
  title: string;
  body_md: string;
  version: string | null;
  status: ProductUpdateStatus;
  published_at: string;
}

export interface CreateEntryInput {
  title: string;
  slug: string;
  version: string | null;
  body_md: string;
  status: ProductUpdateStatus;
}

export type UpdateEntryPatch = Partial<
  Pick<ProductUpdateEntry, 'title' | 'slug' | 'version' | 'body_md' | 'status'>
>;

/** Columns selected for the admin list + editor surfaces. */
const ENTRY_COLUMNS = 'id, slug, title, body_md, version, status, published_at';

/**
 * Lowercases, trims, replaces non-alphanumerics with '-', collapses repeats,
 * and strips leading/trailing '-'. e.g. `slugify('Hello, World! v2')` →
 * `'hello-world-v2'`.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Best-effort audit. Never throws — a failed audit must NOT roll back a write
 * that already succeeded server-side.
 */
async function audit(
  client: SupabaseClient,
  actionName: string,
  rowPk: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  try {
    const { error } = await client.rpc('log_admin_action', {
      p_action_name: actionName,
      p_target_user_id: null,
      p_table_name: 'changelog_entries',
      p_row_pk: rowPk,
      p_before: before ?? null,
      p_after: after ?? null,
    });
    if (error) {
      console.warn(`[product-updates] audit ${actionName} failed:`, error.message);
    }
  } catch (err) {
    console.warn(`[product-updates] audit ${actionName} threw:`, err);
  }
}

/**
 * Lists every changelog entry newest-first. An admin sees drafts + archived
 * too (RLS published-or-admin); non-admins never reach this wrapper (the module
 * is admin-gated).
 */
export async function listEntries(client: SupabaseClient): Promise<ProductUpdateEntry[]> {
  const { data, error } = await client
    .from('changelog_entries')
    .select(ENTRY_COLUMNS)
    .order('published_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProductUpdateEntry[];
}

/**
 * Inserts a new entry with `created_by = auth.uid()` and audits
 * `changelog.create`. Propagates a PostgREST/RLS denial (e.g. 42501).
 */
export async function createEntry(
  client: SupabaseClient,
  input: CreateEntryInput,
): Promise<ProductUpdateEntry> {
  const { data: userData } = await client.auth.getUser();
  const createdBy = userData?.user?.id ?? null;

  const { data, error } = await client
    .from('changelog_entries')
    .insert({
      title: input.title,
      slug: input.slug,
      version: input.version,
      body_md: input.body_md,
      status: input.status,
      created_by: createdBy,
    })
    .select(ENTRY_COLUMNS)
    .single();
  if (error) throw error;
  const row = data as ProductUpdateEntry;
  await audit(client, 'changelog.create', row.id, null, row);
  return row;
}

/**
 * Updates an entry and audits `changelog.update` with before/after snapshots.
 * Reads the existing row first so the audit carries the prior state.
 */
export async function updateEntry(
  client: SupabaseClient,
  id: string,
  patch: UpdateEntryPatch,
): Promise<ProductUpdateEntry> {
  const { data: beforeData } = await client
    .from('changelog_entries')
    .select(ENTRY_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  const { data, error } = await client
    .from('changelog_entries')
    .update(patch)
    .eq('id', id)
    .select(ENTRY_COLUMNS)
    .single();
  if (error) throw error;
  const row = data as ProductUpdateEntry;
  await audit(client, 'changelog.update', id, (beforeData as ProductUpdateEntry | null) ?? null, row);
  return row;
}

/**
 * Publishes an entry: status='published' + published_at=now(). Audits
 * `changelog.publish`.
 */
export async function publishEntry(
  client: SupabaseClient,
  id: string,
): Promise<ProductUpdateEntry> {
  const { data, error } = await client
    .from('changelog_entries')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', id)
    .select(ENTRY_COLUMNS)
    .single();
  if (error) throw error;
  const row = data as ProductUpdateEntry;
  await audit(client, 'changelog.publish', id, null, row);
  return row;
}

/**
 * Archives an entry: status='archived'. Audits `changelog.archive`.
 */
export async function archiveEntry(
  client: SupabaseClient,
  id: string,
): Promise<ProductUpdateEntry> {
  const { data, error } = await client
    .from('changelog_entries')
    .update({ status: 'archived' })
    .eq('id', id)
    .select(ENTRY_COLUMNS)
    .single();
  if (error) throw error;
  const row = data as ProductUpdateEntry;
  await audit(client, 'changelog.archive', id, null, row);
  return row;
}
