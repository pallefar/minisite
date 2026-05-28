/**
 * newsletter-api.ts — Client-side wrapper for newsletter_subscribers via PostgREST.
 *
 * Phase 60 Plan 60-12.
 *
 * Security: The unsubscribe column is NEVER exposed to the client. It is
 * server-only and managed by Supabase RLS (anon SELECT gated to the stored
 * token + opted_in fields only; authenticated UPSERT is user_id = auth.uid()
 * scoped). This client API intentionally omits that column from all reads
 * and writes.
 *
 * CAN-SPAM affirmative opt-in: default opted_in=false is enforced at the DB
 * level (newsletter_subscribers.opted_in NOT NULL DEFAULT false). UI components
 * MUST also default to OFF/unchecked (per UI-SPEC §Critical UI Invariant #9).
 */

import { supabase } from '@/lib/supabase';

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * Client-facing shape of a newsletter subscription row.
 * NOTE: The server-managed rotation token field is intentionally absent —
 * it MUST NEVER be exposed to the browser client (T-60-12-04).
 */
export interface NewsletterSubscription {
  user_id: string;
  opted_in: boolean;
  topic_tags: string[];
  email: string;
  last_sent_at: string | null;
  opted_in_at: string | null;
  opted_out_at: string | null;
}

const COLUMNS = 'user_id,opted_in,topic_tags,email,last_sent_at,opted_in_at,opted_out_at';

// ─── Synthetic default (no row exists yet) ─────────────────────────────────

function syntheticDefault(userId: string): NewsletterSubscription {
  return {
    user_id: userId,
    opted_in: false,
    topic_tags: [],
    email: '',
    last_sent_at: null,
    opted_in_at: null,
    opted_out_at: null,
  };
}

// ─── getNewsletterSubscription ─────────────────────────────────────────────

/**
 * Fetch the current newsletter subscription row for a user.
 * Returns a synthetic default (opted_in=false) when no row exists yet.
 * Never returns the server-managed rotation token — server-only column.
 */
export async function getNewsletterSubscription(userId: string): Promise<NewsletterSubscription> {
  const { data, error } = await supabase
    .from('newsletter_subscribers')
    .select(COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return syntheticDefault(userId);
  return data as NewsletterSubscription;
}

// ─── setNewsletterOptIn ────────────────────────────────────────────────────

export interface SetNewsletterOptInArgs {
  userId: string;
  optedIn: boolean;
  topicTags?: string[];
}

/**
 * UPSERT the newsletter subscription preference for a user.
 *
 * - When `optedIn=true`: sets `opted_in_at = now()`, clears `opted_out_at`.
 * - When `optedIn=false`: sets `opted_out_at = now()`, preserves `topic_tags`
 *   if `topicTags` is not provided (avoids clobbering).
 * - Does NOT write the rotation token column — server default handles it.
 * - Uses `onConflict: 'user_id'` for idempotent UPSERT (not INSERT + ON CONFLICT DO DELETE;
 *   per [[reference_postgres_no_insert_on_conflict_do_delete]]).
 */
export async function setNewsletterOptIn({
  userId,
  optedIn,
  topicTags,
}: SetNewsletterOptInArgs): Promise<NewsletterSubscription> {
  const now = new Date().toISOString();

  // Base payload — always present fields
  const payload: Record<string, unknown> = {
    user_id: userId,
    opted_in: optedIn,
  };

  if (optedIn) {
    payload.opted_in_at = now;
    payload.opted_out_at = null;
  } else {
    payload.opted_out_at = now;
    // Don't send opted_in_at — preserve existing value
  }

  // Only include topic_tags in the payload if explicitly provided
  // (avoid clobbering existing tags when toggling off without providing tags)
  if (topicTags !== undefined) {
    payload.topic_tags = topicTags;
  }

  const { data, error } = await supabase
    .from('newsletter_subscribers')
    .upsert(payload, { onConflict: 'user_id' })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return data as NewsletterSubscription;
}
