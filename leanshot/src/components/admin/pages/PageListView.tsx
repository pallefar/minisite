/**
 * Phase 15 Plan 15-04 — /admin/pages index view.
 *
 * Lists `landing_pages` rows for a staff user. Server-side RLS + page-save's
 * is_staff gate are the security boundary; this client view's only role is
 * presentation + navigation. Non-staff users will see an empty list (RLS
 * filters everything) — that's intentional.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { listPages, type PageListRow } from '@/lib/page-builder/page-api';
import { TemplatePicker } from './TemplatePicker';

const SCAFFOLD_STORAGE_KEY = 'phase15-template-scaffold';

export function PageListView() {
  const [rows, setRows] = useState<PageListRow[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listPages().then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setRows(res.value);
      } else {
        setRows([]);
        setErrorMessage("Couldn't load pages. Try refreshing.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const goToNew = (): void => {
    setPickerOpen(true);
  };

  const handleScaffold = (blocks: BlockNode[]): void => {
    try {
      sessionStorage.setItem(
        SCAFFOLD_STORAGE_KEY,
        JSON.stringify({ blocks }),
      );
    } catch {
      // Best-effort — private-mode browsers fall through to an empty editor.
    }
    window.history.pushState(null, '', '/admin/pages/new');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const goToEdit = (id: string): void => {
    window.history.pushState(null, '', `/admin/pages/${id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight">Pages</h1>
        <Button variant="primary" size="md" onClick={goToNew} data-testid="new-page">
          New page
        </Button>
      </header>

      {errorMessage && (
        <Card variant="flat" padding="md" className="mb-4">
          <p
            role="alert"
            className="text-[13px] text-[var(--color-destructive)]"
          >
            {errorMessage}
          </p>
        </Card>
      )}

      {rows === null && (
        <p className="text-[13px] text-[var(--color-text-secondary)]">Loading pages…</p>
      )}

      {rows !== null && rows.length === 0 && !errorMessage && (
        <Card variant="flat" padding="lg" className="text-center max-w-md mx-auto mt-12">
          <h2 className="text-[18px] font-semibold mb-2">No pages yet</h2>
          <p className="text-[13px] text-[var(--color-text-secondary)] mb-4">
            Build your first landing page to start converting visitors.
          </p>
          <Button variant="primary" size="md" onClick={goToNew}>
            New page
          </Button>
        </Card>
      )}

      <TemplatePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onScaffold={handleScaffold}
      />

      {rows !== null && rows.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="page-list">
          {rows.map((row) => (
            <li key={row.id}>
              <Card variant="default" padding="md">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold truncate">{row.title}</h2>
                    <p className="text-[12px] text-[var(--color-text-secondary)] truncate">
                      /{row.slug}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Pill size="sm" aria-label="status">
                      {row.is_published ? 'Published' : 'Draft'}
                    </Pill>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => goToEdit(row.id)}
                      data-testid={`edit-page-${row.id}`}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
