-- Plan 70-07 cascade-51 — R-rls-matrix: grant INSERT on rag_topics to authenticated,
-- gated by the existing super-only RLS policy (user decision 2026-05-30).
--
-- Root: 20260519000009 did `revoke insert ... on rag_topics from authenticated` and added
-- `rag_topics_super_insert` (`with check (public._rag_is_super())`). RLS *policies* permit
-- the row, but PostgreSQL still requires a table-level INSERT *privilege* for the role — so
-- a super-admin (who connects as `authenticated`) had no grant and got 42501 on a DIRECT
-- `.from('rag_topics').insert()`. rls-matrix.test.ts "super-admin CAN INSERT rag_topics"
-- exercises exactly that direct path (the impersonation matrix tests RLS, not the RPC).
--
-- Fix: grant INSERT to `authenticated`. The `rag_topics_super_insert` WITH CHECK
-- (`_rag_is_super()`) still gates rows — a non-super authenticated user gets a row-level
-- security violation, so this does NOT widen who can actually insert; it only lets the
-- role reach the RLS check. (UPDATE/DELETE remain revoked + RPC-only — only INSERT was
-- requested and only the INSERT matrix assertion fails.)

grant insert on public.rag_topics to authenticated;
