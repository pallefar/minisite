/**
 * Phase 36 Plan 36-02 — client-side wrappers for the 3 NPS Edge Functions.
 *
 * These functions are the network seam between Wave 3 modal code
 * (NPSPromptModal / PromoterCtaModal / DetractorFeedbackModal) and the
 * server-side Edge Fns. They do NOT contain UI logic and they do NOT
 * import the consumer modals — keeping this file as a pure transport
 * layer keeps Wave 3 modal bundles small.
 *
 * The anon Supabase client (`@/lib/supabase`) automatically forwards the
 * user's session JWT via the Authorization header (per the canonical
 * project pattern in src/components/admin/onboarding-builder/OnboardingABPanel.tsx:102).
 *
 * Error semantics: every wrapper throws a typed `NpsClientError` on
 * non-2xx or invoke-error responses. Wave 3 modals catch this at their
 * surface to show error UX (toast + retry).
 *
 * V13-3 compliance: this file does NOT import useNativeReviewTrigger or
 * reviewShim. Native-review surface is wired separately at the
 * trigger-event handler layer (per CONTEXT D-20) and is enforced by the
 * ESLint AST rule + import-x zones from Plan 36-01.
 */

import { supabase } from '@/lib/supabase';

// ============================================================================
// Edge Fn response contracts (mirror the W9-extended Edge Fn shapes)
// ============================================================================

export type CtaSlug = 'trustpilot' | 'g2' | 'capterra';
export type CtaItem = { slug: CtaSlug; url_pattern: string };

export type DecideResponse =
  | { fire: false; reason: 'lifetime_cap' | 'global_cooldown' | 'no_rule' | 'per_rule_cooldown' }
  | { fire: true; copy_variant: string; cta_set: CtaItem[]; rule_id: string };

export type FeedbackResponse = { ticket_id: string };

export class NpsClientError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'NpsClientError';
    this.code = code;
  }
}

// ============================================================================
// Wrappers
// ============================================================================

/**
 * Invoke `nps-trigger-decide` with the supplied trigger event name.
 *
 * The anon supabase client forwards the user's session JWT via the
 * Authorization header automatically — no per-call header wiring needed.
 *
 * Returns the typed Edge Fn response. Wave 3 callers branch on `fire`:
 *   - fire: true → render NPSPromptModal with copy_variant + cta_set
 *   - fire: false → no-op (cooldown / no-rule / lifetime cap respected)
 *
 * Per CONTEXT D-08: cooldown decisions live entirely on the server —
 * the client has no authority to override or bypass them.
 */
export async function decideNpsTrigger(eventName: string): Promise<DecideResponse> {
  const { data, error } = await supabase.functions.invoke('nps-trigger-decide', {
    body: { event_name: eventName },
  });
  if (error) {
    throw new NpsClientError('invoke_error', error.message ?? 'nps-trigger-decide failed');
  }
  const payload = data as DecideResponse | { error?: string } | null;
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
    throw new NpsClientError(payload.error, `nps-trigger-decide returned error: ${payload.error}`);
  }
  if (!payload || typeof (payload as { fire?: unknown }).fire !== 'boolean') {
    throw new NpsClientError('invalid_response', 'nps-trigger-decide returned malformed payload');
  }
  return payload as DecideResponse;
}

/**
 * Invoke `nps-feedback-submit` with the user's open-text feedback.
 *
 * Server-side validation:
 *   - trimmed length < 10 → 400 too_short (Edge Fn returns { error: 'too_short' })
 *   - trimmed length > 4000 → silently truncated to 4000 before RPC call
 *
 * Returns the created ticket_id. Wave 3 DetractorFeedbackModal renders the
 * "Thanks — we'll follow up" confirmation on success.
 */
export async function submitNpsFeedback(text: string): Promise<FeedbackResponse> {
  const { data, error } = await supabase.functions.invoke('nps-feedback-submit', {
    body: { feedback_text: text },
  });
  if (error) {
    throw new NpsClientError('invoke_error', error.message ?? 'nps-feedback-submit failed');
  }
  const payload = data as FeedbackResponse | { error?: string } | null;
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
    throw new NpsClientError(payload.error, `nps-feedback-submit returned error: ${payload.error}`);
  }
  if (!payload || typeof (payload as { ticket_id?: unknown }).ticket_id !== 'string') {
    throw new NpsClientError('invalid_response', 'nps-feedback-submit returned malformed payload');
  }
  return payload as FeedbackResponse;
}

/**
 * Invoke `nps-cta-click-log` with the platform the user clicked.
 *
 * Fire-and-forget by design — the caller (PromoterCtaModal) opens the
 * external URL in parallel without awaiting this call. We still return a
 * Promise<void> so the caller can `void logCtaClick(...)` or `await` for
 * test purposes.
 *
 * Closes Pitfall 10 — the server-side captureServer dual-writes into
 * events_mirror, which the funnel-anomaly cron consumes (client-side
 * posthog.capture() does NOT dual-write).
 */
export async function logCtaClick(platform: CtaSlug): Promise<void> {
  const { error } = await supabase.functions.invoke('nps-cta-click-log', {
    body: { platform },
  });
  if (error) {
    throw new NpsClientError('invoke_error', error.message ?? 'nps-cta-click-log failed');
  }
}
