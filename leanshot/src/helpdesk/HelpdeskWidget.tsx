/**
 * HelpdeskWidget — Phase 37 Plan 06 (HELP-02 / HELP-07 / HELP-09 / HELP-10 / HELP-11).
 *
 * Single root component for the in-app help affordance, lazy-loaded into the
 * `helpdesk-widget` chunk (≤25 kB gz ceiling — see scripts/assert-helpdesk-bundle-budget.sh).
 *
 * Auth-aware surfaces (D-13/D-15/D-17):
 *  - marketing  — anonymous: KB search + article view only; no ticket form.
 *  - phi        — authenticated on a PHI-bearing route: KB-only mode; no ticket form
 *                 + no realtime channel so PHI never reaches Sentry replay / PostHog SR.
 *  - auth       — authenticated on a non-PHI route: full widget (KB + ticket form +
 *                 thread view + realtime + macro slash command).
 *
 * Chunk-split discipline (T-37-06-06 mitigation / [[phase5-bundle-regression]]):
 *  - The widget root pulls only Sheet + Button + lightweight UI.
 *  - KBSearchTypeahead is the only home-view child statically imported into
 *    helpdesk-widget — it's required for first interaction.
 *  - KBArticleView (react-markdown + dompurify), TicketForm, TicketList,
 *    TicketThread, and MacroTypeahead (via ReplyComposer → cmdk + fuse) are
 *    React.lazy()'d so they don't bloat the root chunk.
 */
import { lazy, Suspense, useEffect, useState, type JSX } from 'react';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { track } from '@/lib/analytics';
import { isPhiRoutePath } from '@/lib/posthog-route-disable';
import { useStore } from '@/lib/store';
import KBSearchTypeahead from './KBSearchTypeahead';

const KBArticleView = lazy(() => import('./KBArticleView'));
const TicketForm = lazy(() => import('./TicketForm'));
const TicketList = lazy(() => import('./TicketList'));
const TicketThread = lazy(() => import('./TicketThread'));

type ViewState =
  | { kind: 'home' }
  | { kind: 'article'; articleId: string }
  | { kind: 'form' }
  | { kind: 'thread'; ticketId: string };

export function HelpdeskWidget(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ViewState>({ kind: 'home' });
  // `user` (domain) drives marketing-vs-auth surface decision; `authUser` (Supabase
  // session user) provides the auth.uid() string needed by TicketThread for
  // typing-broadcast self-filtering. Both can be null during anonymous browsing.
  const user = useStore((s) => s.user);
  const authUserId = useStore((s) => s.signedIn?.user?.id ?? null);
  const phiRoute = isPhiRoutePath();
  const isAuthenticated = Boolean(user) && authUserId !== null;

  const surface: 'auth' | 'marketing' | 'phi' = !isAuthenticated
    ? 'marketing'
    : phiRoute
      ? 'phi'
      : 'auth';

  useEffect(() => {
    if (open) track('helpdesk.widget.opened', { surface });
  }, [open, surface]);

  // Reset to home view whenever the sheet is closed so the next open starts fresh.
  useEffect(() => {
    if (!open) setView({ kind: 'home' });
  }, [open]);

  const showTicketSurfaces = isAuthenticated && !phiRoute;

  return (
    <>
      <Button
        aria-label="Open helpdesk"
        onClick={() => setOpen(true)}
        variant="ghost"
        className="fixed bottom-4 right-4 z-40"
        data-testid="helpdesk-widget-launcher"
      >
        Help
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Help">
        <Suspense fallback={<div className="p-4 text-sm">Loading…</div>}>
          {view.kind === 'home' && (
            <div className="flex flex-col gap-3 p-3">
              <KBSearchTypeahead
                onSelectArticle={(id) => setView({ kind: 'article', articleId: id })}
              />
              {showTicketSurfaces && (
                <>
                  <Button onClick={() => setView({ kind: 'form' })}>
                    Still need help? Create a ticket
                  </Button>
                  <TicketList
                    onSelect={(ticketId) => setView({ kind: 'thread', ticketId })}
                  />
                </>
              )}
              {surface === 'marketing' && (
                <p className="text-xs text-[var(--color-fg-muted)]">
                  Email{' '}
                  <a href="mailto:support@app.leanshot.app" className="underline">
                    support@app.leanshot.app
                  </a>{' '}
                  for direct help.
                </p>
              )}
              {surface === 'phi' && (
                <p className="text-xs text-[var(--color-fg-muted)]">
                  This screen handles protected health information. Use the knowledge base
                  above, or email{' '}
                  <a href="mailto:support@app.leanshot.app" className="underline">
                    support@app.leanshot.app
                  </a>{' '}
                  to create a ticket.
                </p>
              )}
            </div>
          )}
          {view.kind === 'article' && (
            <KBArticleView
              articleId={view.articleId}
              onBack={() => setView({ kind: 'home' })}
            />
          )}
          {view.kind === 'form' && showTicketSurfaces && (
            <TicketForm
              onSubmitted={(ticketId) => setView({ kind: 'thread', ticketId })}
              onCancel={() => setView({ kind: 'home' })}
            />
          )}
          {view.kind === 'thread' && showTicketSurfaces && authUserId !== null && (
            <TicketThread
              ticketId={view.ticketId}
              currentUserId={authUserId}
              onBack={() => setView({ kind: 'home' })}
            />
          )}
        </Suspense>
      </Sheet>
    </>
  );
}

export default HelpdeskWidget;
