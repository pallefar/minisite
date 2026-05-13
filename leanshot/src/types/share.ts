/**
 * Shared types for Phase 8 doctor read-share.
 * AI conversation history is structurally excluded per SC#3 — never add fields
 * referencing the AI message table here. The Postgres snapshot view
 * (`share_snapshot_view`) enforces the exclusion at the schema layer; this
 * type layer mirrors that contract so a reviewer can grep both for parity.
 */

export type ShareStatus = 'active' | 'expired' | 'revoked' | 'pending-redeem';

export interface Share {
  id: string;
  user_id: string;
  label: string;
  expires_at: string; // ISO timestamptz
  revoked_at: string | null;
  code_consumed_at: string | null;
  created_at: string;
  // hashes (token_hash, access_code_hash, recipient_session_hash) intentionally
  // not exposed to the browser — they're server-side credential material.
}

export interface CreateShareRequest {
  label: string; // 1..80 chars
  expires_at: string; // ISO timestamptz, must be > now()
}

export interface CreateShareResponse {
  share_id: string;
  raw_token: string; // returned ONCE — patient copies to share-link URL
  raw_code: string; // 6-digit, returned ONCE — patient delivers out-of-band
}

export interface RedeemRequest {
  token: string;
  code: string; // 6 digit
}

export type RedeemError =
  | 'invalid-code'
  | 'rate-limited'
  | 'already-consumed'
  | 'not-found'
  | 'revoked'
  | 'expired';

export interface SnapshotResponse {
  snapshot: {
    user_id: string;
    patient_first_name: string;
    injections: Array<{
      log_id: string;
      timestamp: string;
      medication: string;
      dose: number;
      unit: string;
      site: string;
    }>;
    weights: Array<{ id: string; timestamp: string; weight_kg: number }>;
    symptoms: Array<{ id: string; timestamp: string; symptom: string; severity: number }>;
    photos: Array<{ id: string; timestamp: string; signed_url: string }>;
    // NOTE: AI conversation surface NEVER appears here (SC#3 structural exclusion).
    // Do NOT add an AI-chat-history field to this shape — the exclusion is
    // enforced at three layers (view definition, Edge Function selection list,
    // this type contract); breaking any layer is a regression.
  };
  expires_at: string;
  share_id: string; // opaque share_id per D-02(c); used for print footer + display ID; NEVER the patient user_id
}

export type SnapshotError =
  | 'not-found'
  | 'requires-code'
  | 'invalid-session'
  | 'revoked'
  | 'expired';
