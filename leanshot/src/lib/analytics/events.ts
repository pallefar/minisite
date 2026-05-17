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
} as const satisfies Record<string, EventDef>;

export type EventName = keyof typeof EVENTS;
export type PayloadOf<K extends EventName> = z.infer<(typeof EVENTS)[K]['payload']>;
