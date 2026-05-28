/**
 * Phase 62 Plan 62-05 — PublicationEditorPage.
 *
 * Two-column editor for white-paper authoring + 2-person review:
 *   Left:  markdown textarea + markdown_path display
 *   Right: sticky metadata panel (title, status, created-by, actions)
 *
 * Critical 2-person review invariant: Publish button NEVER appears in DOM for authors.
 *   isSelfCreated = currentUserId === publication.created_by
 *   → ResearchReviewBanner receives isAuthor=true → NO Publish CTA rendered
 *   → Full conditional render — NOT disabled+hidden (INSIGHTS-07 T-62-05-01)
 *
 * State machine: draft → in_review → published → archived
 * RPC error semantics for publish_research:
 *   - message contains 'SELF_REVIEW_REJECTED' → toast "Another admin must review..."
 *   - message contains 'cannot publish research in status' → toast "Publication is not ready..."
 *   - other → generic error toast
 *
 * Per ProtocolEditorPage analog:
 *   - grid gap-6 lg:grid-cols-[1fr_320px]
 *   - Sticky right panel: lg:sticky lg:top-4 lg:self-start
 *   - ResearchReviewBanner above grid when status='in_review'
 *
 * Typography: text-[11px] / text-[13px] / text-[18px] / text-heading only.
 * @theme audit scope: this file only (WARNING 6 per plan verify block).
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/hooks/useToast';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import type { ResearchPublication } from '@/types/research';
import { PublicationStatusBadge } from './PublicationStatusBadge';
import { ResearchReviewBanner } from './ResearchReviewBanner';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parsePublicationIdFromPathname(): string | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(/\/admin\/research\/publications\/([^/]+)/);
  return m?.[1] ?? null;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function tempSlug(): string {
  return `untitled-${crypto.randomUUID().slice(0, 8)}`;
}

// ─── New Publication Form ─────────────────────────────────────────────────────

interface NewPublicationFormProps {
  currentUserId: string | null;
  onCreated: (id: string) => void;
}

function NewPublicationForm({ currentUserId, onCreated }: NewPublicationFormProps) {
  const showToast = useToast();
  const [title, setTitle] = useState('Untitled Research');
  const [slug, setSlug] = useState(() => tempSlug());
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!currentUserId) return;
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from('research_publications')
        .insert({
          slug,
          title,
          markdown_path: '',
          status: 'draft',
          created_by: currentUserId,
        })
        .select('id')
        .single();

      if (error) {
        showToast(
          error.message ?? 'Publication could not be saved. Check your connection and try again.',
          'error',
        );
        return;
      }
      onCreated((data as { id: string }).id);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-4 p-6">
      <h1 className="text-heading font-semibold">New Research Publication</h1>
      <p className="text-[13px] text-[var(--color-text-secondary)]">
        Create a draft to start authoring your white-paper.
      </p>

      <div className="space-y-2">
        <label
          htmlFor="publication-title"
          className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]"
        >
          Title
        </label>
        <input
          id="publication-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Publication title"
          className="w-full h-10 px-3 text-[13px] border border-[var(--color-border)] rounded-card bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
        />
      </div>

      <div className="space-y-2">
        <label
          htmlFor="publication-slug"
          className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]"
        >
          Slug
        </label>
        <input
          id="publication-slug"
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          aria-label="Publication slug"
          className="w-full h-10 px-3 text-[13px] font-mono border border-[var(--color-border)] rounded-card bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
        />
      </div>

      <Button
        variant="primary"
        onClick={() => void handleCreate()}
        loading={creating}
        className="w-full"
      >
        Create Draft
      </Button>
    </div>
  );
}

// ─── Main Editor ──────────────────────────────────────────────────────────────

export function PublicationEditorPage() {
  const showToast = useToast();
  const currentUserId = useStore(
    (s) => (s as { signedIn?: { user: { id: string } } | null }).signedIn?.user?.id ?? null,
  );

  const [rawId] = useState<string | null>(() => parsePublicationIdFromPathname());
  const isNew = rawId === 'new';
  const publicationId = isNew ? null : rawId;

  const [publication, setPublication] = useState<ResearchPublication | null>(null);
  const [markdownContent, setMarkdownContent] = useState('');
  const [titleValue, setTitleValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Reviewer display name (best-effort; populated when reviewer info available)
  const [reviewerName] = useState<string | undefined>(undefined);

  // ─── Load publication ──────────────────────────────────────────────────────

  const loadPublication = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('research_publications')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError) throw fetchError;
      const pub = data as ResearchPublication;
      setPublication(pub);
      setTitleValue(pub.title);
      setMarkdownContent(pub.markdown_body ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load publication.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (publicationId) {
      void loadPublication(publicationId);
    } else {
      // isNew path — NewPublicationForm handles this
      setLoading(false);
    }
  }, [publicationId, loadPublication]);

  // ─── Derived state ─────────────────────────────────────────────────────────

  // 2-person review DOM gate: isSelfCreated → Publish button absent from DOM
  const isSelfCreated = !!(
    currentUserId &&
    publication?.created_by &&
    currentUserId === publication.created_by
  );

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleSaveDraft = useCallback(async () => {
    if (!publication) return;
    setSavingDraft(true);
    try {
      const { error: updateError } = await supabase
        .from('research_publications')
        .update({
          title: titleValue,
          markdown_body: markdownContent,
          updated_at: new Date().toISOString(),
        })
        .eq('id', publication.id);

      if (updateError) throw updateError;
      setPublication((p) => (p ? { ...p, title: titleValue, markdown_body: markdownContent } : p));
      showToast('Draft saved.', 'success');
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : 'Publication could not be saved. Check your connection and try again.',
        'error',
      );
    } finally {
      setSavingDraft(false);
    }
  }, [publication, titleValue, markdownContent, showToast]);

  const handleSubmitReview = useCallback(async () => {
    if (!publication) return;
    setSubmitting(true);
    try {
      const { error: rpcError } = await supabase.rpc('submit_research_for_review', {
        p_publication_id: publication.id,
      });
      if (rpcError) {
        showToast(rpcError.message ?? 'Submit failed', 'error');
        return;
      }
      showToast('Publication submitted for review.', 'success');
      void loadPublication(publication.id);
    } finally {
      setSubmitting(false);
    }
  }, [publication, showToast, loadPublication]);

  const handlePublish = useCallback(async () => {
    if (!publication) return;
    setPublishing(true);
    try {
      const { error: rpcError } = await supabase.rpc('publish_research', {
        p_publication_id: publication.id,
      });
      if (rpcError) {
        if (rpcError.message?.includes('SELF_REVIEW_REJECTED') || rpcError.code === '42501') {
          showToast('Another admin must review this publication before publish.', 'error');
          return;
        }
        if (rpcError.message?.includes('cannot publish research in status')) {
          showToast('Publication is not ready for publish.', 'error');
          return;
        }
        showToast(rpcError.message ?? 'Publish failed', 'error');
        return;
      }
      showToast('Publication published.', 'success');
      void loadPublication(publication.id);
    } finally {
      setPublishing(false);
    }
  }, [publication, showToast, loadPublication]);

  const handleArchiveConfirm = useCallback(async () => {
    if (!publication) return;
    setArchiving(true);
    try {
      const { error: rpcError } = await supabase.rpc('archive_research', {
        p_publication_id: publication.id,
      });
      if (rpcError) {
        showToast(rpcError.message ?? 'Archive failed', 'error');
        return;
      }
      showToast('Publication archived.', 'success');
      setArchiveModalOpen(false);
      void loadPublication(publication.id);
    } finally {
      setArchiving(false);
    }
  }, [publication, showToast, loadPublication]);

  // ─── New publication route ─────────────────────────────────────────────────

  if (isNew) {
    return (
      <NewPublicationForm
        currentUserId={currentUserId}
        onCreated={(id) => {
          window.history.pushState(null, '', `/admin/research/publications/${id}`);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }}
      />
    );
  }

  // ─── Loading ───────────────────────────────────────────────────────────────

  if (!publicationId) {
    return (
      <EmptyState
        title="No publication selected"
        body="Select a publication from the list to edit it."
      />
    );
  }

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-1/3 rounded-card" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    );
  }

  if (error || !publication) {
    return (
      <p className="text-[13px] text-[var(--color-danger)] p-6">
        {error ?? 'Failed to load publication.'}
      </p>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* 2-person review banner — only when in_review */}
      {publication.status === 'in_review' && (
        <ResearchReviewBanner
          isAuthor={isSelfCreated}
          reviewerName={reviewerName}
          onPublish={!isSelfCreated ? handlePublish : undefined}
          publishing={publishing}
        />
      )}

      {/* Two-column editor grid */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left: markdown editor */}
        <div className="space-y-3">
          {/* Markdown path display */}
          <p className="text-[13px] font-mono text-[var(--color-text-secondary)] truncate">
            {publication.markdown_path || (
              <span className="italic text-[var(--color-text-tertiary)]">No markdown path set</span>
            )}
          </p>

          {/* Markdown textarea */}
          <textarea
            value={markdownContent}
            onChange={(e) => setMarkdownContent(e.target.value)}
            onBlur={() => void handleSaveDraft()}
            aria-label="Markdown content"
            placeholder="Write your research paper in Markdown..."
            className="w-full h-96 px-4 py-3 text-[13px] font-mono border border-[var(--color-border)] rounded-card bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] resize-y"
          />

          {/* Abstract */}
          <div className="space-y-1">
            <label
              htmlFor="publication-abstract"
              className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]"
            >
              Abstract
            </label>
            <textarea
              id="publication-abstract"
              value={publication.abstract ?? ''}
              onChange={(e) => setPublication((p) => (p ? { ...p, abstract: e.target.value } : p))}
              onBlur={() => void handleSaveDraft()}
              aria-label="Abstract"
              placeholder="Brief summary for the public index page..."
              className="w-full h-24 px-3 py-2 text-[13px] border border-[var(--color-border)] rounded-card bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] resize-y"
            />
          </div>
        </div>

        {/* Right: sticky metadata panel */}
        <aside className="lg:sticky lg:top-4 lg:self-start space-y-4">
          <div className="p-4 rounded-card border border-[var(--color-border)] bg-[var(--color-surface-elevated)] space-y-4">
            {/* Editable title */}
            <input
              type="text"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={() => void handleSaveDraft()}
              aria-label="Publication title"
              className="w-full text-[18px] font-semibold bg-transparent border-0 border-b border-[var(--color-border)] focus:outline-none focus:border-[var(--color-primary)] pb-1"
            />

            {/* Status badge */}
            <PublicationStatusBadge status={publication.status} />

            {/* Created by */}
            {publication.created_by && (
              <p className="text-[13px] text-[var(--color-text-secondary)]">
                Created by{' '}
                <span className="font-semibold font-mono text-[11px]">
                  {publication.created_by.slice(0, 8)}…
                </span>
              </p>
            )}

            {/* Published date (if published) */}
            {publication.published_at && (
              <p className="text-[13px] text-[var(--color-text-secondary)]">
                Published: {formatDate(publication.published_at)}
              </p>
            )}

            <hr className="border-[var(--color-border)]" />

            {/* Actions */}
            <div className="space-y-2">
              {/* Save Draft — always available */}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleSaveDraft()}
                loading={savingDraft}
                className="w-full"
              >
                Save Draft
              </Button>

              {/* Submit for Review — author only, draft state only */}
              {isSelfCreated && publication.status === 'draft' && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void handleSubmitReview()}
                  loading={submitting}
                  className="w-full"
                >
                  Submit for Review
                </Button>
              )}

              {/*
               * Publish Research button is intentionally ABSENT from DOM for authors.
               * The 2-person review rule is enforced here at the UI level (layer 2 of 3):
               *   Layer 1: DB SECDEF publish_research raises SELF_REVIEW_REJECTED
               *   Layer 2: This conditional — Publish CTA never rendered when isSelfCreated
               *   Layer 3: CI smoke test (Plan 62-02) asserts no publish button in DOM for author
               *
               * When status=in_review and !isSelfCreated, the Publish CTA lives inside
               * ResearchReviewBanner (rendered above the grid). No second Publish button here.
               */}

              {/* Archive — not when already archived */}
              {publication.status !== 'archived' && (
                <button
                  type="button"
                  onClick={() => setArchiveModalOpen(true)}
                  className="w-full text-[13px] text-[var(--color-danger)] hover:underline text-left py-1"
                >
                  Archive publication
                </button>
              )}
            </div>
          </div>

          {/* DP metadata (read-only display when cohort data exists) */}
          {(publication.cohort_size !== null || publication.epsilon !== null) && (
            <div
              className="p-4 rounded-card border border-[var(--color-border)] bg-[var(--color-surface-elevated)] space-y-2"
              aria-label="Differential privacy disclosure"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                Cohort Data
              </p>
              {publication.epsilon !== null && (
                <p className="text-[11px] font-mono text-[var(--color-text-secondary)]">
                  epsilon = {publication.epsilon}
                </p>
              )}
              {publication.cohort_size !== null && (
                <p className="text-[11px] font-mono text-[var(--color-text-secondary)]">
                  cohort: {publication.cohort_size} participants
                </p>
              )}
              {publication.suppressed_buckets !== null && (
                <p className="text-[11px] font-mono text-[var(--color-text-secondary)]">
                  suppressed buckets: {publication.suppressed_buckets}
                </p>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Archive confirm modal */}
      <Modal
        open={archiveModalOpen}
        onClose={() => setArchiveModalOpen(false)}
        title="Archive publication?"
        size="sm"
      >
        <p className="text-[13px] text-[var(--color-text-secondary)] mb-4">
          This will remove it from the public research hub. You can restore it later.
        </p>
        <div className="flex items-center gap-2 justify-end">
          <Button size="sm" variant="secondary" onClick={() => setArchiveModalOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={archiving}
            onClick={() => void handleArchiveConfirm()}
            className="bg-[var(--color-danger)] border-[var(--color-danger)] hover:opacity-90"
          >
            Archive publication
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export default PublicationEditorPage;
