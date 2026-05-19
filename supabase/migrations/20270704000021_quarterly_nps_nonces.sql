-- Phase 42 Plan 42-07 (POLISH-12) — Quarterly NPS signed-token nonce ledger.
--
-- Pitfall 11 mitigation: forwarded NPS email URLs are bearer tokens. The HMAC
-- proves authenticity of the score/user_id/quarter triplet, but does NOT
-- prevent replay. The nonce table is the server-side single-use ledger:
--   - enqueue: INSERT one row per user per quarter; nonce embedded in the
--     signed token's payload.
--   - respond: atomic `UPDATE … SET used_at = now() WHERE used_at IS NULL`
--     returning the row. used_at IS NOT NULL → 'replay' (409).
--
-- Service-role only: no authenticated direct access. Edge Functions use
-- service-role client; the respond Fn is unauthenticated but its only DB
-- mutation is gated by HMAC verification + this single-use ledger.

CREATE TABLE IF NOT EXISTS public.quarterly_nps_nonces (
  nonce      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quarter    text NOT NULL CHECK (quarter ~ '^[0-9]{4}-Q[1-4]$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at    timestamptz NULL
);

-- The enqueue path queries for "pending nonces for this user/quarter"; the
-- respond path UPDATEs by nonce PK. Composite index covers eligibility checks.
CREATE INDEX IF NOT EXISTS quarterly_nps_nonces_user_quarter_used_idx
  ON public.quarterly_nps_nonces (user_id, quarter, used_at);

COMMENT ON TABLE public.quarterly_nps_nonces IS
  'Phase 42 POLISH-12. Single-use ledger for signed quarterly-NPS response tokens (Pitfall 11). Service-role only; RLS denies all authenticated access.';
COMMENT ON COLUMN public.quarterly_nps_nonces.used_at IS
  'Atomic UPDATE … SET used_at = now() WHERE used_at IS NULL is the single-use guard; rowcount=0 → replay (409).';
