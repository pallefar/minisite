// Phase 50: rag_* events appended per CONTEXT D-35. Server-only events captured via supabase/functions/_shared/posthog-server.ts per D-34.
// Phase 33 D-05/D-06: AEM priority register — top-8 ordering PROPOSED, pending plan-checker iter-1 user confirmation.
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
  /**
   * Phase 33 D-05: AEM (Audience Event Manager) priority register.
   * Events with aem_priority 1-8 are forwarded to Meta CAPI via meta-capi-relay.
   * Priority 1 = highest conversion value (payment_completed).
   * Only 8 slots — top 8 events by Meta CAPI value weighting.
   * Enforced: ESLint rule blocks aem_priority on phi:true events.
   */
  readonly aem_priority?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /**
   * Phase 33 D-05: aem_dropped marks events that WERE considered for the AEM
   * top-8 but were explicitly excluded. Documents the decision; has no runtime
   * effect. Planner proposes; user confirms in plan-checker iter-1.
   */
  readonly aem_dropped?: true;
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
    aem_priority: 2,
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
    aem_priority: 3,
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
    aem_priority: 4,
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
    aem_priority: 1,
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
    aem_priority: 5,
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
    aem_dropped: true,
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
    aem_priority: 6,
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
    aem_priority: 7,
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

  // ---------------------------------------------------------------------------
  // Phase 42 Plan 42-08 (POLISH-05/06) — Smart notifications telemetry.
  // 5 events: notification_sent (server-only via posthog-server.ts per D-34
  // pattern; declared here for client-readable taxonomy + type-safety),
  // notification_dismissed / _clicked / _snoozed / _permission_granted
  // (client-fired from NotificationsSubtab + InAppNotificationToast +
  // permission flow). No PHI fields — keep `phi:false` per event-def contract.
  // ---------------------------------------------------------------------------
  notification_sent: {
    name: 'notification_sent',
    version: 1,
    phi: false,
    owner: 'product',
    server_only: true,
    description:
      'A notification was fired by notification-send Edge Fn (one event per category × channel combo that actually delivered).',
    payload: z.object({
      category: z.enum(['dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing']),
      channel: z.enum(['email', 'web-push', 'in-app']),
      urgent: z.boolean().optional(),
    }),
  },
  notification_dismissed: {
    name: 'notification_dismissed',
    version: 1,
    phi: false,
    owner: 'product',
    description: 'User dismissed an in-app or web-push notification.',
    payload: z.object({
      category: z.enum(['dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing']),
      channel: z.enum(['email', 'web-push', 'in-app']),
    }),
  },
  notification_clicked: {
    name: 'notification_clicked',
    version: 1,
    phi: false,
    owner: 'product',
    description: 'User clicked through on an in-app or web-push notification.',
    payload: z.object({
      category: z.enum(['dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing']),
      channel: z.enum(['email', 'web-push', 'in-app']),
    }),
  },
  notification_snoozed: {
    name: 'notification_snoozed',
    version: 1,
    phi: false,
    owner: 'product',
    description: 'User snoozed a category from /settings/notifications.',
    payload: z.object({
      category: z.enum(['dose-reminders', 'ai-insights', 'clinic-alerts', 'billing', 'marketing']),
      duration_days: z.number().int().refine((n) => [1, 7, 30].includes(n), {
        message: 'duration_days must be 1, 7, or 30 (D-06)',
      }),
    }),
  },
  notification_permission_granted: {
    name: 'notification_permission_granted',
    version: 1,
    phi: false,
    owner: 'product',
    description: 'User granted Notification.requestPermission inside the user-gesture flow (Pitfall 3).',
    payload: z.object({
      had_prior_subscription: z.boolean().optional(),
    }),
  },

  // ---------------------------------------------------------------------------
  // Phase 42 Plan 42-10 (POLISH-12 D-21) — Quarterly NPS instrument.
  // SEPARATE from P36 review-prompt per D-19; same V13-3 BLOCKER UNCONDITIONAL
  // principle covers both (no-conditional-native-review lint rule).
  // nps_quarterly_sent — server-only (nps-quarterly-enqueue captures via
  //                      posthog-server when Resend batch dispatches).
  // nps_quarterly_responded — fires both server-side (respond Edge Fn) and
  //                      client-side (QuarterlyNPSModal Submit); identical
  //                      payload across channels so the funnel groups them.
  // ---------------------------------------------------------------------------
  nps_quarterly_sent: {
    name: 'nps_quarterly_sent',
    version: 1,
    phi: false,
    owner: 'product',
    server_only: true,
    description:
      'Server-only: a quarterly NPS email was dispatched to a user (D-21 email-first delivery).',
    payload: z.object({
      quarter: z.string(),
      cohort: z.string().optional(),
      plan_tier: z.string().optional(),
    }),
  },
  nps_quarterly_responded: {
    name: 'nps_quarterly_responded',
    version: 1,
    phi: false,
    owner: 'product',
    description:
      'A user responded to the quarterly NPS survey (D-21). Fires server-side from the respond Edge Fn AND client-side from the in-app modal Submit.',
    payload: z.object({
      score: z.number().int().min(0).max(10),
      responded_via: z.enum(['email', 'in-app']),
    }),
  },
} as const satisfies Record<string, EventDef>;

export type EventName = keyof typeof EVENTS;
export type PayloadOf<K extends EventName> = z.infer<(typeof EVENTS)[K]['payload']>;
