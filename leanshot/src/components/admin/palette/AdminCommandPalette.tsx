/**
 * Phase 27 Plan 27-03 — AdminCommandPalette: cmdk-based Cmd+K palette.
 *
 * Architecture (CONTEXT D-10/11/12/13 + RESEARCH Pattern 1):
 *   - Single mount expected from AdminGlobals (Plan 27-04 Task 5) via
 *     React.lazy(() => import('@/components/admin/palette/AdminCommandPalette'))
 *   - Default export so the lazy import resolves cleanly.
 *   - Global Cmd+K (metaKey) / Ctrl+K (ctrlKey) listener on document; toggles open.
 *   - Three Command.Group nodes: Modules / Recent / Quick Actions
 *   - Recent group is lazy-loaded on first open via fetchRecentItems()
 *     (admin_palette_recent SECDEF RPC).
 *   - Destructive Quick Actions route through PaletteAal2Gate.run(item.onSelect)
 *     which presents a fresh TOTP challenge when the most recent aal2 challenge
 *     is older than 15 minutes (D-12).
 *
 * Bundle: the cmdk dep + this wrapper land in admin-shell chunk (Vite manualChunks
 * routes src/components/admin/** to admin-shell). Phase 24 D-18 ceiling: 45 kB gz
 * (per scripts/assert-bundle-budget.sh; plan target was 30 kB but baseline is 45 kB
 * after page-builder consolidation). Task 4 measures the post-cmdk delta.
 */
import { Command } from 'cmdk';
import { useEffect, useRef, useState } from 'react';
import PaletteAal2Gate, {
  type PaletteAal2GateHandle,
} from '@/components/admin/palette/PaletteAal2Gate';
import { buildPaletteIndex, type PaletteItem } from '@/lib/admin/palette/index-builder';
import { fetchRecentItems, type RecentItem } from '@/lib/admin/palette/recent';
import type { AdminRole } from '@/lib/admin/roles';

export interface AdminCommandPaletteProps {
  adminRole: AdminRole;
}

/**
 * Minimal posthog probe — if the global PostHog client isn't loaded (test envs,
 * marketing build), treat every flag as undefined → index-builder keeps the
 * module (only explicit `false` filters it out). Plan 27-04 owns wiring the
 * real posthog-js client through this surface.
 */
function resolvePosthogProbe(): { isFeatureEnabled: (k: string) => boolean | undefined } {
  if (typeof window === 'undefined') return { isFeatureEnabled: () => undefined };
  const ph = (window as unknown as { posthog?: { isFeatureEnabled?: (k: string) => boolean | undefined } })
    .posthog;
  if (ph && typeof ph.isFeatureEnabled === 'function') {
    return { isFeatureEnabled: ph.isFeatureEnabled.bind(ph) };
  }
  return { isFeatureEnabled: () => undefined };
}

export function AdminCommandPalette({ adminRole }: AdminCommandPaletteProps) {
  const [open, setOpen] = useState(false);
  // null = not yet fetched; [] = empty result; RecentItem[] = populated.
  const [recentItems, setRecentItems] = useState<RecentItem[] | null>(null);
  const [recentLoading, setRecentLoading] = useState(false);
  const gateRef = useRef<PaletteAal2GateHandle>(null);

  // Global Cmd+K / Ctrl+K listener.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  // Lazy-load recent items the first time the palette opens.
  useEffect(() => {
    if (!open) return;
    if (recentItems !== null || recentLoading) return;
    setRecentLoading(true);
    fetchRecentItems()
      .then((items) => setRecentItems(items))
      .catch(() => setRecentItems([])) // soft-fail — palette stays usable
      .finally(() => setRecentLoading(false));
  }, [open, recentItems, recentLoading]);

  const posthog = resolvePosthogProbe();
  const index: PaletteItem[] = buildPaletteIndex(
    adminRole,
    posthog,
    recentItems ?? [],
  );

  const modules = index.filter((i) => i.group === 'modules');
  const recents = index.filter((i) => i.group === 'recent');
  const quicks = index.filter((i) => i.group === 'quick_actions');

  const handleSelect = async (item: PaletteItem) => {
    if (item.destructive) {
      try {
        await gateRef.current?.run(async () => {
          await item.onSelect();
          setOpen(false);
        });
      } catch {
        // user_cancelled or aal2_challenge_failed — keep palette open
      }
      return;
    }
    await item.onSelect();
    setOpen(false);
  };

  return (
    <>
      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        label="Admin command palette"
        className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh]"
      >
        <div className="w-full max-w-[640px] mx-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card,var(--color-bg))] text-[var(--color-text)] shadow-2xl">
          <Command.Input
            placeholder="Type a command or search…"
            className="w-full px-4 py-3 bg-transparent outline-none border-b border-[var(--color-border)] text-[15px]"
          />
          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-[14px] text-[var(--color-text-secondary)]">
              No results.
            </Command.Empty>

            {modules.length > 0 && (
              <Command.Group heading="Modules" className="text-[12px] uppercase tracking-wide text-[var(--color-text-secondary)] px-2 pt-2 pb-1">
                {modules.map((item) => (
                  <Command.Item
                    key={item.id}
                    value={`${item.label} ${item.id}`}
                    onSelect={() => void handleSelect(item)}
                    className="flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-[14px] text-[var(--color-text)] data-[selected=true]:bg-[var(--color-bg-muted,#f0f0f0)]"
                  >
                    {item.icon ? <item.icon size={16} className="opacity-70" /> : null}
                    <span>{item.label}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group heading="Recent" className="text-[12px] uppercase tracking-wide text-[var(--color-text-secondary)] px-2 pt-3 pb-1">
              {recentLoading && (
                <div className="px-3 py-2 text-[14px] text-[var(--color-text-secondary)]">
                  Loading recent…
                </div>
              )}
              {!recentLoading && recents.length === 0 && (
                <div className="px-3 py-2 text-[14px] text-[var(--color-text-secondary)]">
                  No recent items.
                </div>
              )}
              {recents.map((item) => (
                <Command.Item
                  key={item.id}
                  value={`${item.label} ${item.id}`}
                  onSelect={() => void handleSelect(item)}
                  className="flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-[14px] text-[var(--color-text)] data-[selected=true]:bg-[var(--color-bg-muted,#f0f0f0)]"
                >
                  <span>{item.label}</span>
                </Command.Item>
              ))}
            </Command.Group>

            {quicks.length > 0 && (
              <Command.Group heading="Quick Actions" className="text-[12px] uppercase tracking-wide text-[var(--color-text-secondary)] px-2 pt-3 pb-1">
                {quicks.map((item) => (
                  <Command.Item
                    key={item.id}
                    value={`${item.label} ${item.id}`}
                    onSelect={() => void handleSelect(item)}
                    className={
                      'flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-[14px] data-[selected=true]:bg-[var(--color-bg-muted,#f0f0f0)] ' +
                      (item.destructive
                        ? 'text-[var(--color-danger,#c14b4b)]'
                        : 'text-[var(--color-text)]')
                    }
                    data-destructive={item.destructive ? 'true' : 'false'}
                  >
                    {item.icon ? <item.icon size={16} className="opacity-70" /> : null}
                    <span>{item.label}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </div>
      </Command.Dialog>
      <PaletteAal2Gate ref={gateRef} />
    </>
  );
}

export default AdminCommandPalette;
