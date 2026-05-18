/**
 * Phase 27 Plan 27-03 — palette index builder (CONTEXT D-11).
 *
 * Merges three sources into a single PaletteItem[] consumed by
 * AdminCommandPalette to render Command.Item nodes:
 *
 *   1. Modules     — ADMIN_MODULES (Phase 24) filtered by role + posthog flag
 *   2. Recent      — RecentItem[] from admin_palette_recent SECDEF RPC
 *   3. Quick       — QUICK_ACTIONS static registry (destructive flag preserved)
 *
 * The cmdk Command.Item's own onSelect drives the dispatch — the builder
 * attaches a navigation-or-callback closure on each item. Destructive items
 * are NOT directly executable; the palette component routes them through
 * PaletteAal2Gate.run(item.onSelect) before firing.
 */
import type { ComponentType } from 'react';
import { ADMIN_MODULES } from '@/lib/admin/modules';
import { QUICK_ACTIONS } from '@/lib/admin/palette/quick-actions';
import type { RecentItem } from '@/lib/admin/palette/recent';
import { hasMinRole, type AdminRole } from '@/lib/admin/roles';

export type PaletteGroup = 'modules' | 'recent' | 'quick_actions';

export interface PaletteItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: ComponentType<{ size?: number; className?: string }>;
  readonly group: PaletteGroup;
  readonly destructive?: boolean;
  /** Synchronous or async — called when the user selects the cmdk item. */
  readonly onSelect: () => void | Promise<void>;
}

export interface PosthogProbe {
  isFeatureEnabled: (key: string) => boolean | undefined;
}

/**
 * Tiny navigation helper. LeanShot uses hash routing (CLAUDE.md: "No router.")
 * so module navigation is `location.hash = '#/admin/<route>'`. For the
 * quick-actions registry routes (which include query params) we set the
 * full hash verbatim.
 */
function navigateHash(target: string): () => void {
  return () => {
    if (typeof window === 'undefined') return;
    // Module routes come in as bare keys ('users'); recent + quick-action
    // routes come in with a leading '/admin/...'. Normalize.
    if (target.startsWith('/')) {
      window.location.hash = `#${target}`;
    } else {
      window.location.hash = `#/admin/${target}`;
    }
  };
}

/**
 * Build the merged PaletteItem[] in canonical group order:
 *   modules → recent → quick_actions
 *
 * Filter rules (per CONTEXT D-11 + interfaces in 27-03-PLAN):
 *   - Modules: hasMinRole(role, m.minRole) AND posthog.isFeatureEnabled(m.flagKey) !== false
 *     (undefined or true KEEPS the module — only an explicit false hides it)
 *   - Recent: passed through verbatim
 *   - Quick: passed through verbatim; destructive flag preserved
 */
export function buildPaletteIndex(
  adminRole: AdminRole,
  posthog: PosthogProbe,
  recentItems: ReadonlyArray<RecentItem>,
): PaletteItem[] {
  const items: PaletteItem[] = [];

  // 1. Modules
  for (const m of ADMIN_MODULES) {
    if (!hasMinRole(adminRole, m.minRole)) continue;
    if (posthog.isFeatureEnabled(m.flagKey) === false) continue;
    items.push({
      id: `module:${m.key}`,
      label: m.label,
      icon: m.icon,
      group: 'modules',
      destructive: false,
      onSelect: navigateHash(m.route),
    });
  }

  // 2. Recent
  for (const r of recentItems) {
    items.push({
      id: `recent:${r.item_type}:${r.item_id}`,
      label: r.label,
      group: 'recent',
      destructive: false,
      onSelect: navigateHash(r.route),
    });
  }

  // 3. Quick actions
  for (const q of QUICK_ACTIONS) {
    items.push({
      id: `quick:${q.id}`,
      label: q.label,
      icon: q.icon,
      group: 'quick_actions',
      destructive: q.destructive,
      onSelect: navigateHash(q.route),
    });
  }

  return items;
}

// Re-export RecentItem so the palette component can import a single facade.
export type { RecentItem };
