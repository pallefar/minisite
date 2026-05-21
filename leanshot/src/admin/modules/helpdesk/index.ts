/**
 * Phase 37 Plan 37-07 — helpdesk admin module barrel.
 *
 * AdminShell consumes this via `@/admin/modules/helpdesk` and expects
 * `{ HelpdeskLayout }` as the named export (lazy-resolved to default).
 *
 * Sub-pages registered in HelpdeskLayout.SUB_ROUTES:
 *   - inbox        (this plan)
 *   - kb           (Plan 37-08 — placeholder until then)
 *   - macros       (Plan 37-08 — placeholder until then)
 *   - routing      (Plan 37-08 — placeholder until then)
 *   - sla          (Plan 37-08 — placeholder until then)
 *   - sentiment    (this plan)
 *   - trends       (Plan 37-08 — placeholder until then)
 */
export { default as HelpdeskLayout } from './HelpdeskLayout';
