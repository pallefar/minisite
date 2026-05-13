/**
 * Phase 9 Plan 09-02 — typed RPC + storage wrappers for the 16 SECURITY
 * DEFINER clinic RPCs shipped by Plan 09-01 migration 11.
 *
 * Design contract (planner iter-1 anti-pattern 4 mitigation):
 *   - EVERY wrapper returns a discriminated union: {ok:true,data:T} |
 *     {ok:false,error:string}. Wrappers NEVER throw. Downstream UIs
 *     switch on .ok and .error rather than try/catch.
 *   - EVERY wrapper that takes a ConsentScope runs the strict-shape
 *     `isConsentScope` guard BEFORE forwarding to the RPC. Bypass at
 *     the network boundary is impossible from this layer (Pitfall #8
 *     jsonb drift defense — same invariant enforced at the DB layer by
 *     `_validate_consent_scope`, but layered defense matters).
 *   - Postgres error codes map deterministically to error variants:
 *       23505 → 'slug_taken'
 *       42501 → 'forbidden'   (or 'email_mismatch' for invite_email_mismatch)
 *       28000 → 'unauthenticated'
 *       P0002 → 'invalid_invite' / 'not_found'
 *       22023 → 'invalid_scope'
 *       (thrown network err) → 'network'
 *   - NO `s.user!` non-null assertions in this file (project anti-pattern).
 *
 * W-1 fix (plan-checker iter 1): `sendInvite` returns `{invite_id}`
 * regardless of whether the email matches a real `auth.users` row. The
 * server generates `invite_id` UUID-locally and stores the
 * `invite_token_hash` we pass; if the email never resolves to a real
 * user, the invite stays pending until expiry. No email-enumeration
 * leak through this wrapper.
 */

import { supabase } from './supabase';
import { isConsentScope, type ConsentScope, type PermissionKey } from '@/types/clinic';

// =============================================================================
// Discriminated-union result types
// =============================================================================

export type Ok<T> = { ok: true; data: T };
export type Err<E extends string = string> = { ok: false; error: E };
export type Result<T, E extends string = string> = Ok<T> | Err<E>;

type CreateOrgErr = 'slug_taken' | 'unauthenticated' | 'forbidden' | 'invalid' | 'network';
type GenericErr = 'forbidden' | 'unauthenticated' | 'not_found' | 'invalid' | 'network';
type ConsentErr = GenericErr | 'invalid_scope' | 'email_mismatch' | 'invalid_invite';

// =============================================================================
// Internal helpers
// =============================================================================

interface PgError {
  code?: string;
  message?: string;
}

function mapPgError(err: PgError | null | undefined): string {
  if (!err) return 'network';
  const code = err.code ?? '';
  const msg = (err.message ?? '').toLowerCase();
  if (code === '23505' || msg.includes('slug_taken')) return 'slug_taken';
  if (code === '28000' || msg.includes('unauthenticated')) return 'unauthenticated';
  if (msg.includes('invite_email_mismatch')) return 'email_mismatch';
  if (msg.includes('invite_not_found_or_used')) return 'invalid_invite';
  if (code === '42501' || msg.includes('forbidden')) return 'forbidden';
  if (code === 'P0002' || msg.includes('not_found')) return 'not_found';
  if (code === '22023' || msg.includes('consent_scope')) return 'invalid_scope';
  return 'network';
}

async function callRpc<T>(
  fn: string,
  params: Record<string, unknown>,
): Promise<Result<T | null>> {
  try {
    const { data, error } = await supabase.rpc(fn, params);
    if (error) {
      return { ok: false, error: mapPgError(error as PgError) };
    }
    // `returns table (...)` RPCs come back as an array of 0..N rows.
    // For wrappers expecting a single-row return (create_org, send_invite, …),
    // callers pull `data[0]`. For void RPCs, data is null/empty.
    return { ok: true, data: (data ?? null) as T | null };
  } catch {
    return { ok: false, error: 'network' };
  }
}

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return (data as T) ?? null;
}

/**
 * Generate a cryptographically-strong invite token hash client-side.
 *
 * The raw token is what the patient clicks; this wrapper only ever sees
 * the SHA-256 hash and never the raw token itself. For Plan 09-02 the
 * raw token only lives in memory inside the calling component (which
 * Plan 09-06 will hand to the Edge Function for the email URL); for now
 * we generate both here so the wrapper is fully self-contained, then
 * return the hash as the RPC argument.
 *
 * Uses `crypto.subtle` (Web Crypto), available in all modern browsers
 * and in jsdom (test environment).
 */
async function makeInviteTokenHash(): Promise<string> {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Convert random bytes to hex for the raw token, then hash it.
  const rawTokenHex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const enc = new TextEncoder().encode(rawTokenHex);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  const hashBytes = new Uint8Array(digest);
  return Array.from(hashBytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// =============================================================================
// Org RPCs
// =============================================================================

export async function createOrg(p: {
  name: string;
  slug: string;
  description?: string | null;
  website_url?: string | null;
}): Promise<Result<{ org_id: string; slug: string }, CreateOrgErr>> {
  try {
    const { data, error } = await supabase.rpc('create_org', {
      p_name: p.name,
      p_slug: p.slug,
      p_description: p.description ?? null,
      p_website_url: p.website_url ?? null,
    });
    if (error) {
      return { ok: false, error: mapPgError(error as PgError) as CreateOrgErr };
    }
    const row = firstRow<{ id?: string; org_id?: string; slug: string }>(data);
    if (!row) return { ok: false, error: 'network' };
    return {
      ok: true,
      data: { org_id: row.id ?? row.org_id ?? '', slug: row.slug },
    };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function updateOrg(p: {
  org_id: string;
  name?: string | null;
  description?: string | null;
  website_url?: string | null;
  logo_storage_path?: string | null;
}): Promise<Result<null, GenericErr>> {
  const r = await callRpc<null>('update_org', {
    p_org_id: p.org_id,
    p_name: p.name ?? null,
    p_description: p.description ?? null,
    p_website_url: p.website_url ?? null,
    p_logo_storage_path: p.logo_storage_path ?? null,
  });
  return r as Result<null, GenericErr>;
}

// =============================================================================
// Invite RPCs
// =============================================================================

export async function sendInvite(p: {
  org_id: string;
  email: string;
  requested_scope: ConsentScope;
}): Promise<Result<{ invite_id: string }, ConsentErr>> {
  if (!isConsentScope(p.requested_scope)) {
    return { ok: false, error: 'invalid_scope' };
  }
  try {
    const invite_token_hash = await makeInviteTokenHash();
    const { data, error } = await supabase.rpc('send_invite', {
      p_email: p.email.trim().toLowerCase(),
      p_org_id: p.org_id,
      p_invite_token_hash: invite_token_hash,
      p_requested_scope: p.requested_scope,
    });
    if (error) {
      return { ok: false, error: mapPgError(error as PgError) as ConsentErr };
    }
    const row = firstRow<{ invite_id: string }>(data);
    if (!row || !row.invite_id) return { ok: false, error: 'network' };
    return { ok: true, data: { invite_id: row.invite_id } };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function cancelInvite(p: { invite_id: string }): Promise<Result<null, GenericErr>> {
  const r = await callRpc<null>('cancel_invite', { p_invite_id: p.invite_id });
  return r as Result<null, GenericErr>;
}

export async function acceptInviteExisting(p: {
  invite_token_hash: string;
  consent_scope: ConsentScope;
}): Promise<Result<{ membership_id: string; org_id: string }, ConsentErr>> {
  if (!isConsentScope(p.consent_scope)) {
    return { ok: false, error: 'invalid_scope' };
  }
  try {
    const { data, error } = await supabase.rpc('accept_invite_existing', {
      p_invite_token_hash: p.invite_token_hash,
      p_consent_scope: p.consent_scope,
    });
    if (error) {
      return { ok: false, error: mapPgError(error as PgError) as ConsentErr };
    }
    const row = firstRow<{ membership_id: string; org_id: string }>(data);
    if (!row) return { ok: false, error: 'network' };
    return { ok: true, data: row };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function acceptInviteNew(p: {
  invite_token_hash: string;
  consent_scope: ConsentScope;
}): Promise<Result<{ membership_id: string; org_id: string }, ConsentErr>> {
  if (!isConsentScope(p.consent_scope)) {
    return { ok: false, error: 'invalid_scope' };
  }
  try {
    const { data, error } = await supabase.rpc('accept_invite_new', {
      p_invite_token_hash: p.invite_token_hash,
      p_consent_scope: p.consent_scope,
    });
    if (error) {
      return { ok: false, error: mapPgError(error as PgError) as ConsentErr };
    }
    const row = firstRow<{ membership_id: string; org_id: string }>(data);
    if (!row) return { ok: false, error: 'network' };
    return { ok: true, data: row };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function rejectInvite(p: {
  invite_token_hash: string;
}): Promise<Result<null, GenericErr>> {
  const r = await callRpc<null>('reject_invite', { p_invite_token_hash: p.invite_token_hash });
  return r as Result<null, GenericErr>;
}

// =============================================================================
// Membership RPCs
// =============================================================================

export async function revokeMembership(p: {
  membership_id: string;
}): Promise<Result<null, GenericErr>> {
  const r = await callRpc<null>('revoke_membership', { p_membership_id: p.membership_id });
  return r as Result<null, GenericErr>;
}

export async function updateConsentScope(p: {
  membership_id: string;
  consent_scope: ConsentScope;
}): Promise<Result<null, ConsentErr>> {
  if (!isConsentScope(p.consent_scope)) {
    return { ok: false, error: 'invalid_scope' };
  }
  const r = await callRpc<null>('update_consent_scope', {
    p_membership_id: p.membership_id,
    p_consent_scope: p.consent_scope,
  });
  return r as Result<null, ConsentErr>;
}

export async function updateMemberRole(p: {
  membership_id: string;
  role_id: string;
}): Promise<Result<null, GenericErr>> {
  const r = await callRpc<null>('update_member_role', {
    p_membership_id: p.membership_id,
    p_role_id: p.role_id,
  });
  return r as Result<null, GenericErr>;
}

// =============================================================================
// Role RPCs
// =============================================================================

export async function createRole(p: {
  org_id: string;
  name: string;
  description: string | null;
  permission_keys: PermissionKey[] | string[];
}): Promise<Result<{ role_id: string }, GenericErr>> {
  try {
    const { data, error } = await supabase.rpc('create_role', {
      p_org_id: p.org_id,
      p_name: p.name,
      p_description: p.description,
      p_permission_keys: p.permission_keys,
    });
    if (error) {
      return { ok: false, error: mapPgError(error as PgError) as GenericErr };
    }
    const row = firstRow<{ role_id: string }>(data);
    if (!row) return { ok: false, error: 'network' };
    return { ok: true, data: row };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function updateRole(p: {
  role_id: string;
  name: string;
  description: string | null;
  permission_keys: PermissionKey[] | string[];
}): Promise<Result<null, GenericErr>> {
  const r = await callRpc<null>('update_role', {
    p_role_id: p.role_id,
    p_name: p.name,
    p_description: p.description,
    p_permission_keys: p.permission_keys,
  });
  return r as Result<null, GenericErr>;
}

export async function deleteRole(p: { role_id: string }): Promise<Result<null, GenericErr>> {
  const r = await callRpc<null>('delete_role', { p_role_id: p.role_id });
  return r as Result<null, GenericErr>;
}

// =============================================================================
// Storage — org logo upload (D-12 trust-boundary primitive)
// =============================================================================

const ORG_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const ORG_LOGO_MIMES = new Set(['image/png', 'image/jpeg']);
const ORG_LOGO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

export async function uploadOrgLogo(
  orgId: string,
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; error: 'file_too_large' | 'invalid_mime' | 'network' }> {
  if (file.size > ORG_LOGO_MAX_BYTES) {
    return { ok: false, error: 'file_too_large' };
  }
  if (!ORG_LOGO_MIMES.has(file.type)) {
    return { ok: false, error: 'invalid_mime' };
  }
  const ext = ORG_LOGO_EXT[file.type];
  const path = `${orgId}/logo.${ext}`;
  try {
    const { error } = await supabase.storage.from('org-logos').upload(path, file, {
      contentType: file.type,
      upsert: true,
    });
    if (error) return { ok: false, error: 'network' };
    return { ok: true, path };
  } catch {
    return { ok: false, error: 'network' };
  }
}

// =============================================================================
// Slug availability — UX hint only; server-side UNIQUE constraint is the floor.
// =============================================================================

const RESERVED_SLUGS = new Set([
  'api',
  'auth',
  'settings',
  'admin',
  'app',
  'clinic',
  'clinic-invite',
  'legal',
  'share',
  'dashboard',
  'login',
  'signup',
  'logout',
  'help',
  'support',
  'about',
  'pricing',
  'terms',
  'privacy',
  'www',
  'mail',
  'static',
  'assets',
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

export async function checkSlugAvailable(
  slug: string,
): Promise<{ available: true } | { available: false; reason: 'invalid' | 'reserved' | 'taken' }> {
  if (!slug || !SLUG_RE.test(slug)) {
    return { available: false, reason: 'invalid' };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { available: false, reason: 'reserved' };
  }
  try {
    const { data } = await supabase
      .from('orgs')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (data) return { available: false, reason: 'taken' };
    return { available: true };
  } catch {
    // RLS-protected: a non-owner reading `orgs` by slug returns null (the
    // visibility floor — see migration 02 `orgs_select_by_member`). Treat
    // network errors as "available" for the UX hint; server-side UNIQUE
    // is the security floor on submission.
    return { available: true };
  }
}

// =============================================================================
// Re-exports for downstream plans
// =============================================================================

export { RESERVED_SLUGS, SLUG_RE };
