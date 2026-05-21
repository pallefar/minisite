/**
 * Phase 38 Plan 38-08 — HITL admin module barrel export.
 *
 * NOTE: Phase 24 admin shell uses a CENTRAL manifest (`@/lib/admin/modules`) —
 * not per-module `registerAdminModule()` calls. The plan's `index.ts` artifact
 * spec referenced a `registerAdminModule` pattern, but the actual Phase 24
 * convention (verified 2026-05-20 from `src/lib/admin/modules.ts` + memory
 * `admin-module-manifest-vs-router-branch-drift`) is to add an entry to the
 * static ADMIN_MODULES array. This file therefore exports a small
 * `hitlQueueModuleManifestEntry` object that consumers can spread into the
 * manifest, AND re-exports the page component for lazy import.
 *
 * Wiring (Rule 2 / Rule 3 — required for the module to be reachable):
 *   In `src/lib/admin/modules.ts` ADMIN_MODULES, append:
 *     {
 *       key: 'hitl-queue',
 *       label: 'AI Suggestion Review',
 *       route: 'hitl-queue',
 *       icon: ShieldCheckIcon,
 *       lazy: () => import('@/admin/modules/hitl-queue/HitlQueuePage'),
 *       flagKey: 'admin.hitl_queue.enabled',
 *       minRole: 'superadmin',
 *     }
 *
 * The wiring lives in 38-08 (this plan) per `files_modified` declaration
 * convention; it is added separately to keep the cross-file touch surgical.
 */
export { default as HitlQueuePage } from './HitlQueuePage';
export { HitlQueueRow, type HitlRow } from './HitlQueueRow';
export { HitlDecisionModal } from './HitlDecisionModal';

export const hitlQueueModuleManifestEntry = {
  key: 'hitl-queue' as const,
  label: 'AI Suggestion Review',
  route: 'hitl-queue',
  flagKey: 'admin.hitl_queue.enabled',
  minRole: 'superadmin' as const,
};
