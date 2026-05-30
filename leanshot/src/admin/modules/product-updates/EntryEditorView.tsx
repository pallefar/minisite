/**
 * Phase 71 Plan 71-01 (PU-01) — EntryEditorView.
 *
 * Authoring form for a changelog entry: title (auto-fills slug via slugify
 * until the user manually edits the slug), version, status, and a markdown
 * body with a side-by-side LIVE PREVIEW rendered through the EXACT same
 * `SafeMarkdown` renderer the WhatsNewDrawer uses — so the admin sees what
 * users see and the XSS sanitization (react-markdown + DOMPurify) is identical.
 *
 * Save → createEntry / updateEntry. Publish → publishEntry. Archive →
 * archiveEntry. On a 42501 RLS denial we surface the dual-layer denial copy
 * inline (Pattern S1: the UI gate is UX-only; the security boundary is RLS).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { SafeMarkdown } from '@/components/changelog/WhatsNewDrawer';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import {
  createEntry,
  updateEntry,
  publishEntry,
  archiveEntry,
  slugify,
  type ProductUpdateEntry,
  type ProductUpdateStatus,
} from '@/lib/admin/product-updates';
import { supabase } from '@/lib/supabase';

export interface EntryEditorViewProps {
  /** Existing entry to edit; null/undefined → new-entry mode. */
  entry?: ProductUpdateEntry | null;
  /** Fires after a successful save / publish / archive so the parent refetches + navigates. */
  onSaved?: (entry: ProductUpdateEntry) => void;
  /** Back link to the list view. */
  onCancel?: () => void;
}

function denialCopy(err: unknown): string | null {
  const e = err as { code?: string; message?: string };
  if (e?.code === '42501' || /forbidden|not authorized|permission/i.test(e?.message ?? '')) {
    return 'Only admins can publish product updates. Your account does not have permission.';
  }
  return null;
}

export function EntryEditorView({ entry, onSaved, onCancel }: EntryEditorViewProps) {
  const isEdit = Boolean(entry?.id);
  const [title, setTitle] = useState(entry?.title ?? '');
  const [slug, setSlug] = useState(entry?.slug ?? '');
  const [version, setVersion] = useState(entry?.version ?? '');
  const [status, setStatus] = useState<ProductUpdateStatus>(entry?.status ?? 'draft');
  const [bodyMd, setBodyMd] = useState(entry?.body_md ?? '');
  // The slug auto-fills from the title UNTIL the user manually edits it.
  const [slugDirty, setSlugDirty] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // Keep the slug in sync with the title until the user manually dirties it.
  useEffect(() => {
    if (!slugDirty) setSlug(slugify(title));
  }, [title, slugDirty]);

  async function withWrite(
    run: () => Promise<ProductUpdateEntry>,
    successMsg: string,
  ): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const saved = await run();
      toast(successMsg, 'success');
      onSaved?.(saved);
    } catch (err) {
      const denial = denialCopy(err);
      setError(denial ?? (err as { message?: string })?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  function handleSave(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (!title.trim() || !slug.trim() || !bodyMd.trim()) {
      setError('Title, slug, and body are required.');
      return;
    }
    const payload = {
      title: title.trim(),
      slug: slug.trim(),
      version: version.trim() ? version.trim() : null,
      body_md: bodyMd,
      status,
    };
    void withWrite(
      () =>
        isEdit && entry
          ? updateEntry(supabase, entry.id, payload)
          : createEntry(supabase, payload),
      isEdit ? 'Update saved' : 'Draft created',
    );
  }

  return (
    <div className="space-y-4">
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-[var(--color-primary)] hover:underline focus-visible:outline-none"
        >
          ← Back to updates
        </button>
      )}

      <Card variant="elevated" padding="lg">
        <form onSubmit={handleSave} className="space-y-4" noValidate>
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="Title"
              placeholder="What's new in v2.1"
              value={title}
              onChange={(ev) => {
                setTitle(ev.currentTarget.value);
                if (error) setError(null);
              }}
              autoComplete="off"
            />
            <Input
              label="Slug"
              hint="Auto-filled from the title until you edit it."
              placeholder="whats-new-in-v2-1"
              value={slug}
              onChange={(ev) => {
                setSlug(ev.currentTarget.value);
                setSlugDirty(true);
                if (error) setError(null);
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="Version"
              hint="Optional — e.g. 2.1.0 (matched to the store release)."
              placeholder="2.1.0"
              value={version}
              onChange={(ev) => setVersion(ev.currentTarget.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <Select
              label="Status"
              value={status}
              onChange={(ev) => setStatus(ev.currentTarget.value as ProductUpdateStatus)}
            >
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </Select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Textarea
              label="Body (markdown)"
              placeholder={'## Highlights\n\n- New thing\n- Another thing'}
              value={bodyMd}
              onChange={(ev) => {
                setBodyMd(ev.currentTarget.value);
                if (error) setError(null);
              }}
              rows={14}
              className="font-mono text-[13px]"
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
                Live preview
              </span>
              <div
                data-testid="markdown-preview"
                className="min-h-[14rem] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 prose prose-sm max-w-none text-[14px] leading-relaxed text-[var(--color-text)] [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:mt-3 [&_ul]:list-disc [&_ul]:ps-5 [&_a]:text-[var(--color-primary)] [&_a]:underline"
              >
                {bodyMd.trim() ? (
                  <SafeMarkdown source={bodyMd} />
                ) : (
                  <p className="text-[var(--color-text-tertiary)]">
                    Start typing to see a live preview.
                  </p>
                )}
              </div>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-[13px] text-[var(--color-danger)]">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button type="submit" variant="primary" loading={busy} disabled={busy}>
              {isEdit ? 'Save changes' : 'Save draft'}
            </Button>
            {isEdit && entry && (
              <>
                <Button
                  type="button"
                  variant="success"
                  disabled={busy || entry.status === 'published'}
                  onClick={() =>
                    void withWrite(() => publishEntry(supabase, entry.id), 'Update published')
                  }
                >
                  Publish
                </Button>
                <Button
                  type="button"
                  variant="tonal"
                  disabled={busy || entry.status === 'archived'}
                  onClick={() =>
                    void withWrite(() => archiveEntry(supabase, entry.id), 'Update archived')
                  }
                >
                  Archive
                </Button>
              </>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}

export default EntryEditorView;
