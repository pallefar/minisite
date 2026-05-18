// Phase 50: rag_* events appended per CONTEXT D-35. Server-only events captured via supabase/functions/_shared/posthog-server.ts per D-34.
/**
 * Canonical event taxonomy — single source of truth for ALL PostHog events.
 *
 * Phase 24 D-10/D-11. See 24-CONTEXT.md.
 *
 * TAXO-06 reconciliation: D-10 chose ADDITIVE-ONLY (ESLint-enforced). This makes
 * the downgrade-map approach (mentioned in TAXO-06) redundant — breakage cannot
 * happen because removal + type-change are blocked at lint time. The ESLint rule
 * IS the migration tool. If a reviewer requires a downgrade-map fallback, switch
 * to version-bump + adapter (event name → versioned name `event_v2`).
 *
 * Schema rules (enforced by eslint-rules/additive-only-events.js):
 * - Adding a new event: OK
 * - Adding an OPTIONAL field to existing payload: OK
 * - Removing a field: BLOCKED
 * - Changing a field's zod type: BLOCKED
 * - Renaming a field: BLOCKED (treat as remove + add)
 *
 * PHI events: DO NOT add here. They live in events.phi.ts which is import-blocked
 * from client zones (D-12). PHI events MUST originate from Edge Functions via
 * supabase/functions/_shared/posthog-server.ts.
 */
import { z } from 'zod';

export type EventDef = {
  readonly name: string;
  readonly version: 1;
  readonly payload: z.ZodObject<z.ZodRawShape>;
  readonly phi: false;
  readonly description: string;
  readonly owner: 'growth' | 'product' | 'platform' | 'billing' | 'admin';
  /**
   * Phase 50 D-34: server-only events MUST originate from Edge Functions via
   * supabase/functions/_shared/posthog-server.ts. Client capture is forbidden
   * to ensure ITP/uBlock resilience (P24 server-side capture pattern).
   * Additive field — defaults to undefined (treated as client-emittable).
   */
  readonly server_only?: true;
};

export const EVENTS = {
  signup_started: {
    name: 'signup_started',
    version: 1,
    phi: false,
    owner: 'growth',
    description: 'User opened the signup flow.',
    payload: z.object({
      source: z.enum(['web', 'landing', 'invite']),
    }),
  },
  signup_completed: {
    name: 'signup_completed',
    version: 1,
    phi: false,
    owner: 'growth',
    description: 'User successfully created an account and completed signup.',
    payload: z.object({
      auth_provider: z.enum(['email', 'google', 'apple']),
    }),
  },
  activation_first_log: {
    name: 'activation_first_log',
    version: 1,
    phi: false,
    owner: 'product',
    description: 'User logged their first entry in any tracking tab.',
    payload: z.object({
      tab: z.enum(['medication', 'body', 'food', 'activity']),
    }),
  },
  payment_initiated: {
    name: 'payment_initiated',
    version: 1,
    phi: false,
    owner: 'billing',
    description: 'User clicked upgrade and initiated the payment flow.',
    payload: z.object({
      plan: z.enum(['monthly', 'annual']),
      price_cents: z.number().int().positive(),
    }),
  },
  payment_completed: {
    name: 'payment_completed',
    version: 1,
    phi: false,
    owner: 'billing',
    description: 'Stripe checkout session completed successfully.',
    payload: z.object({
      plan: z.enum(['monthly', 'annual']),
      price_cents: z.number().int().positive(),
      stripe_session_id_hash: z.string(),
    }),
  },
  refund_issued: {
    name: 'refund_issued',
    version: 1,
    phi: false,
    owner: 'billing',
    description: 'A refund was issued for a user subscription.',
    payload: z.object({
      reason: z.string(),
      days_since_signup: z.number().int().nonnegative(),
    }),
  },
  admin_action: {
    name: 'admin_action',
    version: 1,
    phi: false,
    owner: 'admin',
    description: 'An admin performed a privileged action on a target user.',
    payload: z.object({
      action_name: z.string(),
      target_user_hash: z.string(),
    }),
  },
  feature_flag_evaluated: {
    name: 'feature_flag_evaluated',
    version: 1,
    phi: false,
    owner: 'platform',
    description: 'A PostHog feature flag was evaluated for the current user.',
    payload: z.object({
      flag_key: z.string(),
      variant: z.string(),
    }),
  },
  // Phase 32 Plan 32-01 — i18n missing-key telemetry (32-RESEARCH Open Item #2).
  // Fired by src/lib/i18n/missing-key-handler.ts when i18next emits its
  // `missingKey` event (a runtime t() call had no translation in the
  // requested or fallback locale). Per RESEARCH Open Question #2: no
  // `org_id` in v1 — additive flip later if growth needs the slice.
  i18n_missing_key: {
    name: 'i18n_missing_key',
    version: 1,
    phi: false,
    owner: 'platform',
    description:
      'i18next fired missingKey — a runtime t() call had no translation in the requested or fallback locale.',
    payload: z.object({
      lng: z.string(),
      ns: z.string(),
      key: z.string(),
    }),
  },

  // ---------------------------------------------------------------------------
  // Phase 50 — Admin-curated RAG knowledge base (CONTEXT.md §D-35).
  // 13 events. 4 are server_only (impression/click/pageview) per D-34 for
  // ITP/uBlock resilience — emit only from Edge Fns via posthog-server.ts.
  // All carry phi:false (no PHI in RAG telemetry surface).
  // ---------------------------------------------------------------------------
  rag_topic_created: {
    name: 'rag_topic_created',
    version: 1,
    phi: false,
    owner: 'admin',
    description: 'Admin created a new RAG topic in the curation queue.',
    payload: z.object({
      topic_id: z.string().uuid(),
      tag: z.string(),
      mode: z.enum(['curated', 'open-web']),
      cadence: z.enum(['daily', 'weekly', 'monthly', 'manual']),
    }),
  },
  rag_topic_edited: {
    name: 'rag_topic_edited',
    version: 1,
    phi: false,
    owner: 'admin',
    description: 'Admin edited an existing RAG topic (cadence, sources, tags).',
    payload: z.object({
      topic_id: z.string().uuid(),
      fields_changed: z.array(z.string()),
    }),
  },
  rag_topic_deleted: {
    name: 'rag_topic_deleted',
    version: 1,
    phi: false,
    owner: 'admin',
    description: 'Admin deleted a RAG topic (soft or hard delete).',
    payload: z.object({
      topic_id: z.string().uuid(),
      soft: z.boolean(),
    }),
  },
  rag_scrape_run: {
    name: 'rag_scrape_run',
    version: 1,
    phi: false,
    owner: 'admin',
    description: 'A scheduled or manual scrape run completed for a RAG topic.',
    payload: z.object({
      topic_id: z.string().uuid(),
      source_count: z.number().int().min(0),
      chunks_found: z.number().int().min(0),
      duration_ms: z.number().int().min(0),
      status: z.enum(['ok', 'partial', 'failed']),
      cost_usd: z.number().min(0),
    }),
  },
  rag_chunk_reviewed: {
    name: 'rag_chunk_reviewed',
    version: 1,
    phi: false,
    owner: 'admin',
    description: 'Admin reviewed a scraped RAG chunk in the moderation queue.',
    payload: z.object({
      chunk_id: z.string().uuid(),
      source_tier: z.enum(['A', 'B', 'C']),
      action: z.enum(['approved', 'rejected', 'edited']),
      reject_reason: z
        .enum([
          'off-topic',
          'factually-wrong',
          'off-label',
          'low-quality',
          'duplicate',
          'safety-concern',
        ])
        .optional(),
      queue_age_hours: z.number().min(0),
    }),
  },
  rag_chunk_published: {
    name: 'rag_chunk_published',
    version: 1,
    phi: false,
    owner: 'admin',
    description: 'A RAG chunk was published into the embeddings table.',
    payload: z.object({
      chunk_id: z.string().uuid(),
      source_tier: z.enum(['A', 'B', 'C']),
      topic_tag: z.string(),
      auto_published: z.boolean(),
    }),
  },
  rag_chunk_retracted: {
    name: 'rag_chunk_retracted',
    version: 1,
    phi: false,
    owner: 'admin',
    description: 'A previously-published RAG chunk was retracted from surfaces.',
    payload: z.object({
      chunk_id: z.string().uuid(),
      reason: z.string(),
      surfaces_affected: z.array(z.enum(['coach', 'tip', 'news', 'hub'])),
    }),
  },
  rag_tip_impression: {
    name: 'rag_tip_impression',
    version: 1,
    phi: false,
    owner: 'product',
    server_only: true,
    description: 'Tip-of-day chunk impression (server-only per D-34, ITP/uBlock resilient).',
    payload: z.object({
      chunk_id: z.string().uuid(),
      topic_tag: z.string(),
      surface: z.literal('tip-of-day'),
    }),
  },
  rag_tip_clicked: {
    name: 'rag_tip_clicked',
    version: 1,
    phi: false,
    owner: 'product',
    server_only: true,
    description: 'User clicked the tip-of-day chunk (server-only per D-34).',
    payload: z.object({
      chunk_id: z.string().uuid(),
      topic_tag: z.string(),
      surface: z.literal('tip-of-day'),
    }),
  },
  rag_citation_clicked: {
    name: 'rag_citation_clicked',
    version: 1,
    phi: false,
    owner: 'product',
    server_only: true,
    description: 'User clicked a RAG citation link on a coach/tip/news/hub surface.',
    payload: z.object({
      chunk_id: z.string().uuid(),
      source_tier: z.enum(['A', 'B', 'C']),
      topic_tag: z.string(),
      surface: z.enum(['coach', 'tip', 'news', 'hub']),
    }),
  },
  rag_newsletter_subscribed: {
    name: 'rag_newsletter_subscribed',
    version: 1,
    phi: false,
    owner: 'growth',
    description: 'User subscribed to the Research newsletter.',
    payload: z.object({
      frequency: z.enum(['weekly']),
      tags_followed: z.array(z.string()),
    }),
  },
  rag_newsletter_unsubscribed: {
    name: 'rag_newsletter_unsubscribed',
    version: 1,
    phi: false,
    owner: 'growth',
    description: 'User unsubscribed from the Research newsletter (1-click or settings).',
    payload: z.object({
      via: z.enum(['1click', 'settings']),
    }),
  },
  rag_hub_pageview: {
    name: 'rag_hub_pageview',
    version: 1,
    phi: false,
    owner: 'growth',
    server_only: true,
    description: 'Public /research hub pageview (server-only per D-34).',
    payload: z.object({
      chunk_id: z.string().uuid().optional(),
      topic_tag: z.string().optional(),
    }),
  },
} as const satisfies Record<string, EventDef>;

export type EventName = keyof typeof EVENTS;
export type PayloadOf<K extends EventName> = z.infer<(typeof EVENTS)[K]['payload']>;
