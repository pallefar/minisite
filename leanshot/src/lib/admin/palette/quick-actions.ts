/**
 * Phase 27 Plan 27-03 — static quick-actions registry for the cmdk palette.
 *
 * Per CONTEXT D-11: "Build-time quick actions list" — no DB lookup; the
 * registry IS the source of truth, frozen at build time.
 *
 * Destructive flag drives PaletteAal2Gate routing (D-12): selecting a
 * destructive entry forces a fresh aal2 challenge when the most recent
 * challenge is >15 minutes old.
 *
 * onSelect handlers are intentionally lightweight here — the palette
 * mounts in a single AdminGlobals slot (Plan 27-04) and dispatches to the
 * appropriate UI flow via a small navigation helper (`location.hash = ...`).
 * Heavy modal lifecycle (BulkConfirmModal, BanUserFlow) lives elsewhere;
 * each handler just navigates to the route that owns the flow.
 */
import {
  Ban as BanIcon,
  KeyRound as KeyIcon,
  Crown as CrownIcon,
  Download as DownloadIcon,
  ListChecks as ListIcon,
  Search as SearchIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface QuickAction {
  readonly id: string;
  readonly label: string;
  readonly icon: ComponentType<{ size?: number; className?: string }>;
  /** When true, PaletteAal2Gate forces an aal2 step-up before executing. */
  readonly destructive: boolean;
  /** Hash-router target invoked when the action is selected. */
  readonly route: string;
}

/**
 * v1 quick-action registry. Six entries — three destructive, three not.
 *
 * Destructive set (D-12):
 *   - ban-user            → /admin/users?action=ban
 *   - force-password-reset → /admin/users?action=reset-password
 *   - grant-pro           → /admin/users?action=comp-plan
 *
 * Non-destructive set:
 *   - export-members-csv  → /admin/users?action=export-csv
 *   - open-audit-log      → /admin/audit-log
 *   - search-by-email     → /admin/users?focus=email-search
 */
export const QUICK_ACTIONS: ReadonlyArray<QuickAction> = [
  {
    id: 'ban-user',
    label: 'Ban a user…',
    icon: BanIcon,
    destructive: true,
    route: '/admin/users?action=ban',
  },
  {
    id: 'force-password-reset',
    label: 'Force password reset…',
    icon: KeyIcon,
    destructive: true,
    route: '/admin/users?action=reset-password',
  },
  {
    id: 'grant-pro',
    label: 'Grant Pro (comp plan)…',
    icon: CrownIcon,
    destructive: true,
    route: '/admin/users?action=comp-plan',
  },
  {
    id: 'export-members-csv',
    label: 'Export members CSV…',
    icon: DownloadIcon,
    destructive: false,
    route: '/admin/users?action=export-csv',
  },
  {
    id: 'open-audit-log',
    label: 'Open audit log',
    icon: ListIcon,
    destructive: false,
    route: '/admin/audit-log',
  },
  {
    id: 'search-by-email',
    label: 'Search members by email',
    icon: SearchIcon,
    destructive: false,
    route: '/admin/users?focus=email-search',
  },
];
