/**
 * Phase 32 Plan 32-04 — admin-side CRUD wrapper for the locale_overrides
 * hot-patch table. Thin facade over supabase-js so the React module stays
 * declarative and unit-testable via mock.
 *
 * Boundary contract (per CONTEXT D-08 + 32-RESEARCH Open Item #5):
 *   - Reads are RLS-gated (admin sees draft + published; non-admin sees only
 *     published rows scoped to their orgs).
 *   - Writes are RLS-gated to is_admin_at_least('admin'::admin_role).
 *   - broadcastPublish sends a redundant Realtime broadcast so connected
 *     clients invalidate immediately if their postgres_changes subscription
 *     dropped the row (per feedback_realtime_layer_e2e_pattern.md).
 *
 * Status-machine: `published` has ONE writer (publishOverride / unpublish)
 * and ONE consumer (override-backend SELECT WHERE published=true) — no drift
 * possible per feedback_planner_iter1_anti_patterns rule.
 */

import { supabase } from '@/lib/supabase';

export interface OverrideRow {
  id: string;
  org_id: string | null;
  lng: 'en' | 'es';
  ns: string;
  key: string;
  value: string;
  published: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OverrideListFilter {
  lng?: 'en' | 'es';
  ns?: string;
  orgId?: string | null;
  /** Match on the key field with ILIKE %search%; omit for no filter. */
  keySearch?: string;
  /** undefined = both drafts + published; true/false = explicit filter. */
  published?: boolean;
}

export interface OverrideUpsertInput {
  id?: string;
  lng: 'en' | 'es';
  ns: string;
  key: string;
  value: string;
  /** null = global; otherwise org-scoped. */
  orgId?: string | null;
  /** Defaults to false (admin saves as draft first). */
  published?: boolean;
}

export async function listOverrides(filter: OverrideListFilter = {}): Promise<OverrideRow[]> {
  let query = supabase.from('locale_overrides').select('*');
  if (filter.lng) query = query.eq('lng', filter.lng);
  if (filter.ns) query = query.eq('ns', filter.ns);
  if (typeof filter.published === 'boolean') {
    query = query.eq('published', filter.published);
  }
  if (filter.orgId === null) {
    query = query.is('org_id', null);
  } else if (typeof filter.orgId === 'string') {
    query = query.eq('org_id', filter.orgId);
  }
  if (filter.keySearch && filter.keySearch.length > 0) {
    query = query.ilike('key', `%${filter.keySearch}%`);
  }
  const { data, error } = await query.order('updated_at', { ascending: false });
  if (error) throw error;
  return (data as OverrideRow[]) ?? [];
}

export async function upsertOverride(input: OverrideUpsertInput): Promise<OverrideRow> {
  // Use the (coalesce(org_id, NIL), lng, ns, key) unique index when id is
  // omitted so admin "edit by key" without an id still de-duplicates.
  // Supabase-js upsert with onConflict over the *expression* index isn't
  // supported; split into id-based update vs key-tuple insert.
  if (input.id) {
    const { data, error } = await supabase
      .from('locale_overrides')
      .update({
        lng: input.lng,
        ns: input.ns,
        key: input.key,
        value: input.value,
        org_id: input.orgId ?? null,
        published: input.published ?? false,
      })
      .eq('id', input.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as OverrideRow;
  }
  const { data, error } = await supabase
    .from('locale_overrides')
    .insert({
      lng: input.lng,
      ns: input.ns,
      key: input.key,
      value: input.value,
      org_id: input.orgId ?? null,
      published: input.published ?? false,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as OverrideRow;
}

export async function deleteOverride(id: string): Promise<void> {
  const { error } = await supabase.from('locale_overrides').delete().eq('id', id);
  if (error) throw error;
}

export async function publishOverride(id: string): Promise<OverrideRow> {
  const { data, error } = await supabase
    .from('locale_overrides')
    .update({ published: true })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as OverrideRow;
}

export async function unpublishOverride(id: string): Promise<OverrideRow> {
  const { data, error } = await supabase
    .from('locale_overrides')
    .update({ published: false })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as OverrideRow;
}

/**
 * Send a redundant Realtime broadcast on the override channel so connected
 * clients invalidate even if their postgres_changes subscription dropped the
 * row. Override-backend listens for `event: 'override_published'` and re-runs
 * the (lng, ns) fetch.
 */
export async function broadcastPublish(scope: {
  lng: 'en' | 'es';
  ns: string;
  orgId: string | null;
}): Promise<void> {
  const channelName = `locale_overrides:${scope.orgId ?? 'global'}`;
  const channel = supabase.channel(channelName);
  try {
    // The channel must be subscribed before .send for broadcast delivery.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('broadcast: subscribe timeout')), 5000);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timer);
          reject(new Error(`broadcast: subscribe status=${status}`));
        }
      });
    });
    await channel.send({
      type: 'broadcast',
      event: 'override_published',
      payload: { lng: scope.lng, ns: scope.ns },
    });
  } finally {
    await supabase.removeChannel(channel);
  }
}
