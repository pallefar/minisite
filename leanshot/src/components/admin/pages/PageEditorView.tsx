/**
 * Phase 15 Plan 15-04 — 3-panel editor shell for /admin/pages/{id}.
 *
 * Slice 1 scope (the thinnest end-to-end loop):
 *   - Read page id from `window.location.pathname` (`/admin/pages/{id}`;
 *     `new` = unsaved).
 *   - Left rail: <BlockTreePanel> (sortable, dnd-kit).
 *   - Center: static placeholder ("Live preview lands in plan 15-05") —
 *     the iframe PreviewPane is owned by 15-05 (cross-plan contract).
 *   - Right rail: <PropertyPanel> for the selected block.
 *   - Topbar: title + StatusBadge + Save draft + Publish + live region.
 *   - "Add block" controls offer Hero/CTA/Footer.
 *
 * For a `new` page: a slug+title inline form must be filled in before the
 * first Save can succeed. After the first Save the returned `pageId` is
 * pushed into `window.history` so URL deep-links work and a refresh keeps
 * the user on the same draft.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Pill } from '@/components/ui/Pill';
import type { BlockNode, BlockType } from '@/lib/page-builder/block-schema';
import {
  getPage,
  newBlock,
  publishPage,
  savePage,
} from '@/lib/page-builder/page-api';
import { BlockTreePanel } from './editor/BlockTreePanel';
import { PropertyPanel } from './editor/PropertyPanel';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type PublishState = 'idle' | 'publishing' | 'published' | 'error';

function readPageIdFromPath(): string {
  // /admin/pages/{id}  or  /admin/pages/new
  const m = window.location.pathname.match(/^\/admin\/pages\/([^/?#]+)/);
  return m ? (m[1] ?? 'new') : 'new';
}

export function PageEditorView() {
  const [pageId, setPageId] = useState<string>(() => readPageIdFromPath());
  const isNewDraft = pageId === 'new';

  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [blocks, setBlocks] = useState<BlockNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPublished, setIsPublished] = useState(false);
  const [latestRevisionId, setLatestRevisionId] = useState<string | null>(null);

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [publishState, setPublishState] = useState<PublishState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Load existing page on mount when not a new draft.
  useEffect(() => {
    if (isNewDraft) return;
    let cancelled = false;
    void getPage(pageId).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setSlug(res.value.slug);
        setTitle(res.value.title);
        setBlocks(res.value.blocks);
        setIsPublished(res.value.is_published);
        setLatestRevisionId(res.value.latestRevisionId);
      } else {
        setErrorMessage("Couldn't load this page. Try refreshing.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pageId, isNewDraft]);

  const addBlock = (type: BlockType): void => {
    const b = newBlock(type, blocks);
    setBlocks([...blocks, b]);
    setSelectedId(b.id);
  };

  const handleSave = async (): Promise<void> => {
    setErrorMessage('');
    setSaveState('saving');
    const res = await savePage({
      pageId: isNewDraft ? undefined : pageId,
      slug,
      title,
      blocks,
    });
    if (!res.ok) {
      setSaveState('error');
      // UI-SPEC error copy.
      setErrorMessage(
        res.error === 'reserved_slug'
          ? "That slug is reserved. Pick a different one."
          : res.error === 'invalid_slug'
            ? 'Slug must be lowercase letters, numbers, and hyphens.'
            : "Couldn't save changes. Check your connection and try again.",
      );
      return;
    }
    // Update local state + URL on first save of a new draft.
    if (isNewDraft) {
      setPageId(res.value.pageId);
      window.history.replaceState(null, '', `/admin/pages/${res.value.pageId}`);
    }
    setLatestRevisionId(res.value.revisionId);
    setSaveState('saved');
  };

  const handlePublish = async (): Promise<void> => {
    if (!latestRevisionId || pageId === 'new') return;
    setErrorMessage('');
    setPublishState('publishing');
    const res = await publishPage({ pageId, revisionId: latestRevisionId });
    if (!res.ok) {
      setPublishState('error');
      setErrorMessage(
        'Publish failed. Try again, or reload the page if the problem continues.',
      );
      return;
    }
    setIsPublished(true);
    setPublishState('published');
  };

  const statusLabel =
    publishState === 'publishing'
      ? 'Publishing...'
      : publishState === 'published'
        ? 'Published'
        : saveState === 'saving'
          ? 'Saving...'
          : saveState === 'saved'
            ? 'Saved'
            : '';

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* Topbar */}
      <header className="flex items-center justify-between gap-4 px-6 py-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-[16px] font-semibold truncate">{title || 'Untitled page'}</h1>
          <Pill size="sm" aria-label="page status">
            {isPublished ? 'Published' : 'Draft'}
          </Pill>
        </div>
        <div
          className="text-[13px] text-[var(--color-text-secondary)]"
          role="status"
          aria-live="polite"
          data-testid="editor-status"
        >
          {statusLabel}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="md"
            onClick={() => addBlock('hero')}
            data-testid="add-hero"
          >
            + Hero
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => addBlock('cta')}
            data-testid="add-cta"
          >
            + CTA
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => addBlock('footer')}
            data-testid="add-footer"
          >
            + Footer
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={() => void handleSave()}
            aria-busy={saveState === 'saving'}
            data-testid="save-draft"
          >
            Save draft
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => void handlePublish()}
            disabled={!latestRevisionId || publishState === 'publishing'}
            aria-busy={publishState === 'publishing'}
            data-testid="publish-page"
          >
            Publish page
          </Button>
        </div>
      </header>

      {/* New-draft slug + title fields */}
      {isNewDraft && (
        <div className="px-6 py-3 border-b border-[var(--color-border)] flex items-end gap-3">
          <div className="flex-1 max-w-sm">
            <Input
              label="Page title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="flex-1 max-w-sm">
            <Input
              label="Slug"
              hint="Lowercase letters, numbers, hyphens"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
            />
          </div>
        </div>
      )}

      {/* Error region (sibling to the status live region so consumers find both) */}
      {errorMessage && (
        <div
          role="alert"
          className="px-6 py-2 text-[13px] text-[var(--color-destructive)] bg-[var(--color-destructive-soft,var(--color-surface))]"
          data-testid="editor-error"
        >
          {errorMessage}
        </div>
      )}

      {/* 3-panel layout */}
      <div className="grid grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)_320px] gap-4 p-4 h-[calc(100vh-72px)]">
        <BlockTreePanel
          blocks={blocks}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onChange={setBlocks}
        />
        <Card variant="flat" padding="md" className="h-full overflow-auto">
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Live preview lands in plan 15-05.
          </p>
          <ul className="mt-4 flex flex-col gap-2 text-[12px]">
            {blocks
              .filter((b) => b.parent_id === null)
              .map((b) => (
                <li key={b.id} className="px-2 py-1 rounded bg-[var(--color-surface)]">
                  {b.type}
                </li>
              ))}
          </ul>
        </Card>
        <PropertyPanel
          selectedBlockId={selectedId}
          blocks={blocks}
          onChange={setBlocks}
        />
      </div>
    </div>
  );
}
