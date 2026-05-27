/**
 * Phase 47 Plan 47-11 — Events admin module manifest entry.
 *
 * Re-exported from src/lib/admin/modules.ts ADMIN_MODULES (Phase 24 D-01).
 * The global manifest is the single source of truth that AdminShell.tsx
 * iterates for nav rendering + URL-prefix routing
 * (pathname.startsWith('/admin/events/') resolves here automatically per
 * AdminShell.tsx lines 118-119 and feedback_admin_module_manifest_vs_router_branch_drift).
 *
 * Module key:        'events'
 * Module route:      'events' (matches /admin/events*)
 * Module minRole:    'staff' (RPCs re-check public.is_staff() server-side, Pattern S1)
 * Module flag:       'admin.events.enabled'
 *
 * Lazy-loads AdminEventsLayout.default (chunked separately by Vite admin chunk rule).
 */
import { CalendarDays as CalendarDaysIcon } from 'lucide-react';
import type { AdminModule } from '@/lib/admin/modules';

export const eventsModule: AdminModule = {
  key: 'events',
  label: 'Events',
  route: 'events',
  icon: CalendarDaysIcon,
  lazy: () => import('./AdminEventsLayout'),
  flagKey: 'admin.events.enabled',
  minRole: 'staff',
};

export default eventsModule;
