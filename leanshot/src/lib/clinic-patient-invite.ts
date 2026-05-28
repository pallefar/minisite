/**
 * Browser-side helpers for the `clinic-patient-invite` Edge Function.
 *
 * Phase 29 Plan 05 — ORG-10 patient consent invite flow.
 *
 * Consumers:
 *   - Plan 29-06 ClinicBillingCard (clinic admin sends invite)
 *   - Plan 29-06 ConsentAcceptScreen (patient previews + accepts invite)
 *
 * All requests use fetch + Authorization Bearer JWT (admin, for /send) or
 * anonymous (for /preview + /accept — patient-side routes).
 *
 * Result type follows src/lib/clinic.ts `Result<T, E>` discriminated-union
 * pattern: `{ok:true, data:T} | {ok:false, error:string}`. Wrappers NEVER
 * throw on expected error codes. Network errors re-throw for caller to handle.
 */

import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/clinic-patient-invite`;

// ---------------------------------------------------------------------------
// Result type (mirrors src/lib/clinic.ts Result<T, E>)
// ---------------------------------------------------------------------------

export type InviteOk<T> = { ok: true; data: T };
export type InviteErr = { ok: false; error: string };
export type InviteResult<T> = InviteOk<T> | InviteErr;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface SendInviteData {
  invite_id: string;
}

export interface PreviewInviteData {
  org_name: string;
  org_logo_url: string | null;
  scope_summary: Record<string, unknown>;
}

export interface AcceptInviteData {
  redirect_url: string;
}

// ---------------------------------------------------------------------------
// Internal helper — parse JSON response into discriminated union
// ---------------------------------------------------------------------------

async function parseResult<T>(res: Response): Promise<InviteResult<T>> {
  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'invalid_response' };
  }

  if (!res.ok || body.ok === false) {
    const errCode = typeof body.error === 'string' ? body.error : `http_${res.status}`;
    return { ok: false, error: errCode };
  }

  return { ok: true, data: body as T };
}

// ---------------------------------------------------------------------------
// sendPatientInvite — clinic admin route (JWT-authed)
// ---------------------------------------------------------------------------

/**
 * Send a patient consent invite from a clinic admin.
 *
 * Requires an active session with clinic-admin privileges for `orgId`.
 * The server-side SECDEF RPC enforces the admin check (Pattern S1 dual-layer).
 *
 * W-1 invariant: returns `{ok:true, data:{invite_id}}` regardless of whether
 * `patientEmail` already exists in auth.users (anti-enumeration).
 *
 * @param orgId        UUID of the organization sending the invite.
 * @param patientEmail Email of the patient to invite.
 * @param consentScope Consent scope JSON (validated server-side by `_validate_consent_scope`).
 */
export async function sendPatientInvite(
  orgId: string,
  patientEmail: string,
  consentScope: Record<string, unknown>,
): Promise<InviteResult<SendInviteData>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return { ok: false, error: 'unauthenticated' };
  }

  const res = await fetch(`${EDGE_URL}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      org_id: orgId,
      patient_email: patientEmail,
      consent_scope: consentScope,
    }),
  });

  return parseResult<SendInviteData>(res);
}

// ---------------------------------------------------------------------------
// previewInvite — anonymous route (patient-side)
// ---------------------------------------------------------------------------

/**
 * Preview a patient consent invite by raw token.
 *
 * Anonymous — no session required. The server hashes the raw token and
 * looks up the invite row. Returns 404 for invalid, expired, OR used tokens
 * (identical body per W-1 anti-enumeration invariant).
 *
 * @param token Raw 64-hex-char invite token from the URL query parameter.
 */
export async function previewInvite(token: string): Promise<InviteResult<PreviewInviteData>> {
  const res = await fetch(`${EDGE_URL}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });

  return parseResult<PreviewInviteData>(res);
}

// ---------------------------------------------------------------------------
// acceptInvite — anonymous route (patient-side); two-phase D-08
// ---------------------------------------------------------------------------

/**
 * Accept a patient consent invite.
 *
 * Anonymous — no session required. Implements D-08 two-phase pattern:
 *   1. Server calls `accept_org_patient_invite` RPC (commits all DB writes atomically).
 *   2. Server calls `admin.auth.admin.generateLink` for magic-link (best-effort).
 *
 * On full success: `data.redirect_url` is the Supabase magic-link action_link
 * which the caller should `window.location.href = data.redirect_url` to.
 *
 * On generateLink failure (rare): `ok:false, error:'magic_link_failed'` is returned
 * with the invite still accepted in the DB. The caller should redirect to
 * `data.redirect_url` (which is the recovery login path) or prompt the user
 * to request a fresh magic link.
 *
 * @param token        Raw invite token from URL.
 * @param patientEmail Patient's email (used for magic-link generation).
 */
export async function acceptInvite(
  token: string,
  patientEmail: string,
): Promise<
  | InviteResult<AcceptInviteData>
  | { ok: false; error: 'magic_link_failed'; invite_accepted: true; redirect_url: string }
> {
  const res = await fetch(`${EDGE_URL}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, patient_email: patientEmail }),
  });

  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'invalid_response' };
  }

  // Special case: invite accepted but magic-link generation failed (D-08 fallback).
  if (
    body.ok === false &&
    body.error === 'magic_link_failed' &&
    body.invite_accepted === true &&
    typeof body.redirect_url === 'string'
  ) {
    return {
      ok: false,
      error: 'magic_link_failed',
      invite_accepted: true,
      redirect_url: body.redirect_url,
    };
  }

  if (!res.ok || body.ok === false) {
    const errCode = typeof body.error === 'string' ? body.error : `http_${res.status}`;
    return { ok: false, error: errCode };
  }

  const redirectUrl = typeof body.redirect_url === 'string' ? body.redirect_url : '';
  return { ok: true, data: { redirect_url: redirectUrl } };
}
