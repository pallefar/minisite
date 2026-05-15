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
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Pill';
import type { BlockNode, BlockType } from '@/lib/page-builder/block-schema';
import {
  getPage,
  listRevisions,
  newBlock,
  publishPage,
  savePage,
  type PageSeoFields,
  type RevisionListRow,
} from '@/lib/page-builder/page-api';
import { BlockTreePanel } from './editor/BlockTreePanel';
import { PreviewPane } from './editor/PreviewPane';
import { PropertyPanel } from './editor/PropertyPanel';
import { SEOPanel, type SEOFields, type SEOFieldKey } from './editor/SEOPanel';
import { VersionHistoryPanel } from './editor/VersionHistoryPanel';

const SCAFFOLD_STORAGE_KEY = 'phase15-template-scaffold';

const EMPTY_SEO: SEOFields = {
  seo_title: '',
  seo_description: '',
  seo_og_image: '',
  seo_canonical: '',
  seo_schema_type: 'WebPage',
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type PublishState = 'idle' | 'publishing' | 'published' | 'error';

function readPageIdFromPath(): string {
  // /admin/pages/{id}  or  /admin/pages/new
  const m = window.location.pathname.match(/^\/admin\/pages\/([^/?#]+)/);
  return m ? (m[1] ?? 'new') : 'new';
}

function toSeoFields(seo: PageSeoFields): SEOFields {
  const validTypes = new Set([
    'WebPage',
    'Product',
    'Article',
    'Service',
    'Organization',
  ]);
  return {
    seo_title: seo.seo_title,
    seo_description: seo.seo_description,
    seo_og_image: seo.seo_og_image,
    seo_canonical: seo.seo_canonical,
    seo_schema_type: validTypes.has(seo.seo_schema_type)
      ? (seo.seo_schema_type as SEOFields['seo_schema_type'])
      : 'WebPage',
  };
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

  // SEO + history (PAGE-05, PAGE-07).
  const [seo, setSeo] = useState<SEOFields>(EMPTY_SEO);
  const [seoOpen, setSeoOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<RevisionListRow[]>([]);

  // Template scaffold handoff (PAGE-04): TemplatePicker on /admin/pages
  // writes a JSON blob into sessionStorage before navigating here; consume it
  // ONCE on mount for a new draft.
  useEffect(() => {
    if (!isNewDraft) return;
    try {
      const raw = sessionStorage.getItem(SCAFFOLD_STORAGE_KEY);
      if (!raw) return;
      sessionStorage.removeItem(SCAFFOLD_STORAGE_KEY);
      const parsed = JSON.parse(raw) as { blocks?: unknown };
      if (Array.isArray(parsed.blocks)) {
        setBlocks(parsed.blocks as BlockNode[]);
      }
    } catch {
      // Best-effort — corrupt scaffold should not block editor.
    }
  }, [isNewDraft]);

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
        setSeo(toSeoFields(res.value.seo));
      } else {
        setErrorMessage("Couldn't load this page. Try refreshing.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pageId, isNewDraft]);

  // Refresh revision list whenever the history sheet opens (and on first save).
  useEffect(() => {
    if (!historyOpen || isNewDraft) return;
    void listRevisions(pageId).then((res) => {
      if (res.ok) setRevisions(res.value);
    });
  }, [historyOpen, pageId, isNewDraft, latestRevisionId]);

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

  const handleSeoChange = (field: SEOFieldKey, value: string): void => {
    setSeo((prev) => ({ ...prev, [field]: value }));
  };

  const handlePublish = async (): Promise<void> => {
    if (!latestRevisionId || pageId === 'new') return;
    setErrorMessage('');
    setPublishState('publishing');
    const res = await publishPage({
      pageId,
      revisionId: latestRevisionId,
      seo: {
        title: seo.seo_title || null,
        description: seo.seo_description || null,
        og_image: seo.seo_og_image || null,
        canonical: seo.seo_canonical || null,
        schema_type: seo.seo_schema_type || null,
      },
    });
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
            variant="ghost"
            size="md"
            onClick={() => setSeoOpen(true)}
            data-testid="open-seo"
          >
            SEO
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => setHistoryOpen(true)}
            disabled={isNewDraft}
            data-testid="open-history"
          >
            History
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
        {/* 15-05: live preview iframe + viewport toggle. Renders the staff
            user's own /{slug}?preview=true draft via page-render. For a new
            unsaved draft (no slug yet) we keep a hint instead of pointing at
            a broken URL. */}
        {slug ? (
          <PreviewPane pageSlug={slug} />
        ) : (
          <Card variant="flat" padding="md" className="h-full overflow-auto">
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Fill in the slug and save once to enable the live preview.
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
        )}
        <PropertyPanel
          selectedBlockId={selectedId}
          blocks={blocks}
          onChange={setBlocks}
        />
      </div>

      <Modal
        open={seoOpen}
        onClose={() => setSeoOpen(false)}
        title="SEO settings"
        size="md"
      >
        <SEOPanel value={seo} onChange={handleSeoChange} />
      </Modal>

      {!isNewDraft && (
        <VersionHistoryPanel
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          pageId={pageId}
          revisions={revisions.map((r) => ({
            id: r.id,
            created_at: r.created_at,
            created_by_email: r.created_by_email,
          }))}
          onRestored={() => {
            setHistoryOpen(false);
            void getPage(pageId).then((res) => {
              if (res.ok) {
                setBlocks(res.value.blocks);
                setIsPublished(res.value.is_published);
                setLatestRevisionId(res.value.latestRevisionId);
              }
            });
          }}
        />
      )}
    </div>
  );
}
