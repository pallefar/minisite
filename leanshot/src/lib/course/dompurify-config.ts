/**
 * Phase 46 — REUSES Phase 44 dompurify policy verbatim.
 *
 * Plan-checker rule: no DOMPurify constructor call may appear in any
 * src/lib/course/* or src/components/course/* file. All course markdown
 * sanitization MUST go through the Phase 44 community policy (T-46-05 mitigation).
 * (Rejected-alternative names intentionally omitted from this file per memory
 * feedback_negation_grep_defeated_by_comment_string — they live in the PLAN/SUMMARY only.)
 *
 * Re-export of sanitizeCommunityMarkdown + renderPostBodyHtml lets course
 * consumers import from `@/lib/course/dompurify-config` without crossing the
 * lib/course → lib/community boundary at every call site.
 */
export * from '@/lib/community/dompurify-config';
