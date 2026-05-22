/**
 * Phase 36 Plan 36-04 — admin reviews module barrel.
 *
 * AdminShell consumes this via `@/admin/modules/reviews` (lazy import in
 * `src/lib/admin/modules.ts`) and expects a default export router component.
 * Sub-route table lives in ReviewsLayout.tsx.
 */
export { default } from './ReviewsLayout';
