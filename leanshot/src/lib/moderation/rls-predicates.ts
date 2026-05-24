/**
 * Phase 48 — Moderation RLS predicate constants (documentation-only).
 *
 * Two cross-cutting invariants for content tables that touch the moderation
 * trust boundary:
 *
 *   1. Muted-content-hide: every content-table SELECT policy MUST OR-extend
 *      with MUTED_AUTHOR_HIDE_PREDICATE so viewers do not see content from
 *      muted authors (except staff + the author themselves).
 *
 *   2. Banned-user-write-deny: every user-owned write policy MUST AND-extend
 *      with BANNED_USER_WRITE_DENY_PREDICATE so users in 'banned' /
 *      'temp_suspended' state cannot insert/update content from any surface
 *      (covers the residual JWT window for the SPA blocker as well).
 *
 * Phase 49+ content-table plans MUST integrate these predicates into their
 * RLS migrations or document an explicit exception in the plan's threat
 * model. Plan-checker integration is expected in a follow-up.
 *
 * These exports are STRINGS only — they are never imported on a runtime SQL
 * execution path. The SQL-side source of truth lives in the migration files
 * for each content table (Plan 49+ owners replace `<table>` / `<author_col>`
 * with concrete identifiers).
 */

export const MUTED_AUTHOR_HIDE_PREDICATE = `
  author_id = auth.uid()
  OR public.is_staff()
  OR NOT EXISTS (
    SELECT 1 FROM public.user_moderation_state ums
    WHERE ums.user_id = <table>.<author_col> AND ums.status = 'muted'
  )
`;

export const BANNED_USER_WRITE_DENY_PREDICATE = `
  NOT EXISTS (
    SELECT 1 FROM public.user_moderation_state ums
    WHERE ums.user_id = auth.uid() AND ums.status IN ('banned','temp_suspended')
  )
`;
