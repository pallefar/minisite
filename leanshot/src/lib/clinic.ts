/**
 * Phase 9 Plan 09-04 — Client-side wrappers for the clinic acceptance RPCs.
 *
 * Plan 09-01 shipped the 16 SECURITY DEFINER RPCs in migration
 * `20260801000011_clinic_rpcs.sql`. The three exports below are the strict
 * client-side seams the patient-facing invite flow calls. Each wrapper
 * SHA-256-hashes the raw URL token before submission (the DB stores
 * `invite_token_hash`, never the raw token).
 *
 * Centralizing here:
 *   - Mockable seam for RTL/unit tests (`vi.mock('@/lib/clinic')`).
 *   - Single hashing site → no chance of an UI surface accidentally
 *     submitting the raw token.
 *   - Pitfall #8 jsonb drift defense: `consent_scope` is typed as the
 *     strict 10-key `ConsentScope`. The DB-side `_validate_consent_scope`
 *     helper (Plan 09-01 deviation #1) is the second backstop.
 *
 * Every export is async and NEVER throws — errors surface via
 * `{ ok: false, error }` so the UI renders inline or via toast.
 */
import { supabase } from '@/lib/supabase';
import type { ConsentScope } from '@/types/clinic';

/**
 * SHA-256-hash the raw invite token (from the URL) into the hex digest
 * stored on `invites.invite_token_hash`. Uses Web Crypto so the hash
 * stays out of the JS module graph (no `crypto` polyfill).
 */
export async function hashInviteToken(rawToken: string): Promise<string> {
  const bytes = new TextEncoder().encode(rawToken);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface AcceptInviteSuccess {
  ok: true;
  data: { membership_id: string; org_id: string };
}
export interface AcceptInviteFailure {
  ok: false;
  error: string;
}
export type AcceptInviteResult = AcceptInviteSuccess | AcceptInviteFailure;

export interface RejectInviteSuccess {
  ok: true;
}
export type RejectInviteResult = RejectInviteSuccess | AcceptInviteFailure;

/**
 * RPC: `accept_invite_existing(p_invite_token_hash, p_consent_scope)`.
 *
 * Preconditions (enforced server-side):
 *   - Caller is an authenticated `auth.users` row.
 *   - `lower(auth.users.email) = lower(invites.email)` for the hash.
 *   - `invites.expires_at > now()` and `invites.accepted_at IS NULL`
 *     and `invites.rejected_at IS NULL`.
 *
 * Pitfall #8 invariant: writes a `memberships` row referencing the
 * existing user — never a duplicate `auth.users`.
 */
export async function acceptInviteExisting(p: {
  invite_token_hash: string;
  consent_scope: ConsentScope;
}): Promise<AcceptInviteResult> {
  const { data, error } = await supabase.rpc('accept_invite_existing', {
    p_invite_token_hash: p.invite_token_hash,
    p_consent_scope: p.consent_scope,
  });
  if (error) return { ok: false, error: error.message };
  // RPC returns a single row { membership_id, org_id }. supabase-js
  // unwraps it to either an object or an array depending on the
  // function's RETURNS clause; defensively normalise both shapes.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    return { ok: false, error: 'Unexpected RPC response shape' };
  }
  return {
    ok: true,
    data: {
      membership_id: (row as { membership_id: string }).membership_id,
      org_id: (row as { org_id: string }).org_id,
    },
  };
}

/**
 * RPC: `accept_invite_new(p_invite_token_hash, p_consent_scope)`.
 *
 * Preconditions (enforced server-side):
 *   - Caller has just completed `supabase.auth.signUp` + email confirm
 *     and is now signed-in as the freshly-created user.
 *   - Same email-match + expiry checks as `accept_invite_existing`.
 *
 * Pitfall #1 mitigation: the signup goes through `supabase.auth.signUp`
 * (the single-identity serializer), not a server-side `admin.createUser`,
 * so a colliding email surfaces as "User already registered" and the UI
 * transitions to State C (sign-in path).
 */
export async function acceptInviteNew(p: {
  invite_token_hash: string;
  consent_scope: ConsentScope;
}): Promise<AcceptInviteResult> {
  const { data, error } = await supabase.rpc('accept_invite_new', {
    p_invite_token_hash: p.invite_token_hash,
    p_consent_scope: p.consent_scope,
  });
  if (error) return { ok: false, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    return { ok: false, error: 'Unexpected RPC response shape' };
  }
  return {
    ok: true,
    data: {
      membership_id: (row as { membership_id: string }).membership_id,
      org_id: (row as { org_id: string }).org_id,
    },
  };
}

/**
 * RPC: `reject_invite(p_invite_token_hash)`. Anonymous-callable so the
 * patient can decline without signing up. Marks `rejected_at` and
 * `consumed_at`; subsequent lookups return State F.
 */
export async function rejectInvite(p: {
  invite_token_hash: string;
}): Promise<RejectInviteResult> {
  const { error } = await supabase.rpc('reject_invite', {
    p_invite_token_hash: p.invite_token_hash,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
