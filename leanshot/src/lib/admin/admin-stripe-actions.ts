/**
 * Phase 22 Plan 22-07 — admin-stripe-action client wrapper for ADMIN-04.
 *
 * Wraps the `admin-stripe-action` Supabase Edge Function (Plan 22-03) which
 * dispatches Stripe refund / cancel / comp operations. Every successful call
 * also writes an audit_logs row via the admin_log_* RPCs (migration
 * 20270601000015) — the wrapper just relays the response.
 *
 * Error mapping (discriminated `AdminStripeError` pattern, mirrors
 * `src/lib/admin/admin-api.ts AdminApiError`):
 *   - 'stripe_<code>'  → operation rejected by Stripe; UI shows inline error
 *                        (UI-SPEC line 680). `stripeCode` carries the raw
 *                        Stripe code (e.g. 'charge_already_refunded').
 *   - 'forbidden'      → caller failed is_staff re-check.
 *   - 'unauthorized'   → missing/invalid bearer.
 *   - 'invalid'        → discriminated-union body validation failed.
 *   - 'network'        → fetch / connection error.
 *   - 'unknown'        → fallback.
 *
 * The Supabase functions.invoke() helper attaches the caller's JWT
 * automatically; the gateway re-verifies with verify_jwt=true.
 */
import { supabase } from '@/lib/supabase';

// ─── Discriminated error ────────────────────────────────────────────────────

export type AdminStripeErrorCode =
  | 'stripe' // Stripe rejected — see stripeCode for the specific Stripe error
  | 'forbidden' // 403 — is_staff gate refused
  | 'unauthorized' // 401 — invalid/missing bearer
  | 'invalid' // 400 — invalid body
  | 'network' // fetch error
  | 'unknown';

export class AdminStripeError extends Error {
  code: AdminStripeErrorCode;
  /** When code='stripe', the underlying Stripe error code (e.g. 'charge_already_refunded'). */
  stripeCode?: string;
  constructor(code: AdminStripeErrorCode, stripeCode?: string, options?: { cause?: unknown }) {
    super(`admin-stripe-action:${code}${stripeCode ? `:${stripeCode}` : ''}`, options);
    this.name = 'AdminStripeError';
    this.code = code;
    this.stripeCode = stripeCode;
  }
}

// ─── Refund ─────────────────────────────────────────────────────────────────

export interface RefundChargeInput {
  targetUserId: string;
  chargeId: string;
  amountCents: number;
  reason?: string;
}

export interface RefundChargeResult {
  refundId: string | null;
  amountRefunded: number;
}

export async function refundCharge(input: RefundChargeInput): Promise<RefundChargeResult> {
  return await invokeAdminStripeAction(
    {
      operation: 'refund',
      target_user_id: input.targetUserId,
      charge_id: input.chargeId,
      amount_cents: input.amountCents,
      reason: input.reason,
    },
    (data) => ({
      refundId: (data as { refund_id?: string | null }).refund_id ?? null,
      amountRefunded: (data as { amount_refunded?: number }).amount_refunded ?? input.amountCents,
    }),
  );
}

// ─── Cancel subscription ────────────────────────────────────────────────────

export interface CancelSubscriptionInput {
  targetUserId: string;
  subscriptionId: string;
}

export async function cancelSubscription(input: CancelSubscriptionInput): Promise<void> {
  await invokeAdminStripeAction(
    {
      operation: 'cancel',
      target_user_id: input.targetUserId,
      subscription_id: input.subscriptionId,
    },
    () => undefined,
  );
}

// ─── Comp subscription ──────────────────────────────────────────────────────

export interface CompSubscriptionInput {
  targetUserId: string;
  subscriptionId: string;
  compDays: number;
}

export async function compSubscription(input: CompSubscriptionInput): Promise<void> {
  await invokeAdminStripeAction(
    {
      operation: 'comp',
      target_user_id: input.targetUserId,
      subscription_id: input.subscriptionId,
      comp_days: input.compDays,
    },
    () => undefined,
  );
}

// ─── Internals ──────────────────────────────────────────────────────────────

type FunctionInvokeError = {
  message?: string;
  context?: { body?: string } | unknown;
} | null;

interface FunctionInvokeResult {
  data: unknown;
  error: FunctionInvokeError;
}

async function invokeAdminStripeAction<T>(
  body: Record<string, unknown>,
  shape: (data: unknown) => T,
): Promise<T> {
  let res: FunctionInvokeResult;
  try {
    res = (await supabase.functions.invoke('admin-stripe-action', {
      body,
    })) as FunctionInvokeResult;
  } catch (cause) {
    throw new AdminStripeError('network', undefined, { cause });
  }
  if (res.error) {
    // The Edge Function returns JSON error bodies like {"error":"stripe_<code>"}.
    // supabase-js attaches the raw body to `error.context.body` for non-2xx responses.
    const err = parseInvokeError(res.error);
    throw err;
  }
  return shape(res.data);
}

function parseInvokeError(err: NonNullable<FunctionInvokeError>): AdminStripeError {
  // Try to extract the structured `{error: '<code>'}` body the Edge Fn returns.
  let bodyCode: string | undefined;
  const ctx = err.context as { body?: unknown } | undefined;
  if (ctx && typeof ctx.body === 'string') {
    try {
      const parsed = JSON.parse(ctx.body) as { error?: unknown };
      if (typeof parsed.error === 'string') {
        bodyCode = parsed.error;
      }
    } catch {
      // ignore — fall through to message parsing
    }
  }
  // Fallback: parse the JSON body from the message itself if supabase-js
  // didn't attach context (older client versions).
  if (bodyCode === undefined && typeof err.message === 'string') {
    const m = err.message.match(/\{"error":"([^"]+)"\}/);
    if (m && m[1]) bodyCode = m[1];
  }

  if (bodyCode === undefined) {
    return new AdminStripeError('unknown', undefined, { cause: err });
  }

  if (bodyCode === 'forbidden') return new AdminStripeError('forbidden', undefined, { cause: err });
  if (bodyCode === 'unauthorized') {
    return new AdminStripeError('unauthorized', undefined, { cause: err });
  }
  if (bodyCode.startsWith('invalid')) {
    return new AdminStripeError('invalid', undefined, { cause: err });
  }
  if (bodyCode.startsWith('stripe_')) {
    return new AdminStripeError('stripe', bodyCode.slice('stripe_'.length), { cause: err });
  }
  return new AdminStripeError('unknown', undefined, { cause: err });
}

// ─── Typed-confirm gate ─────────────────────────────────────────────────────

/**
 * RefundModal step-3 typed-confirm gate (UI-SPEC line 388). Exact-match,
 * case-sensitive. Compares against `REFUND $<amount.dollars>.<cents>`.
 *
 * Mirrors `typedConfirmMatches` from `@/lib/account-delete` in spirit but
 * different copy + the gate compares against an amount, not an email.
 */
export function typedConfirmMatchesRefund(typed: string, amountCents: number): boolean {
  if (!typed) return false;
  const dollars = (amountCents / 100).toFixed(2);
  return typed === `REFUND $${dollars}`;
}
