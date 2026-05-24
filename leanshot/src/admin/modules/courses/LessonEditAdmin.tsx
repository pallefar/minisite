/**
 * Phase 46 Plan 46-09 (COURSE-02/06) — Admin Lesson editor.
 *
 * Loads a single course_lessons row, allows editing text fields
 * (title, content_md, is_required, is_free_preview, captions_enabled),
 * embeds the Mux upload panel (LessonVideoUploader) and the downloadable
 * resources panel (LessonResourceUploader + list).
 *
 * Mux status branches (D-05):
 *   - 'pending'    → render LessonVideoUploader (mints upload URL)
 *   - 'processing' → "Transcoding…" with 5s auto-refresh
 *   - 'ready'      → preview playback id + "Replace video" CTA
 *   - 'rejected' | 'errored' → error message + "Re-upload" CTA
 *
 * Security: RLS via public.is_staff() gates all writes (Plan 46-01 Task 2);
 * Mux upload Fn re-checks profiles.is_staff (Plan 46-05).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';
import type { LessonResource, MuxStatus } from '@/lib/course/course-types';

import { LessonResourceUploader } from './LessonResourceUploader';
import { LessonVideoUploader } from './LessonVideoUploader';

export interface LessonEditAdminProps {
  courseId: string;
  lessonId: string;
  onNavigate: (path: string) => void;
}

interface LessonFormState {
  title: string;
  /** Internal form representation — always a string; null on row maps to ''. */
  content_md: string;
  is_required: boolean;
  is_free_preview: boolean;
  captions_enabled: boolean;
}

interface LessonState extends LessonFormState {
  module_id: string;
  mux_status: MuxStatus;
  mux_playback_id: string | null;
  duration_seconds: number | null;
  resources: LessonResource[];
}

const EMPTY_FORM: LessonFormState = {
  title: '',
  content_md: '',
  is_required: true,
  is_free_preview: false,
  captions_enabled: true,
};

export function LessonEditAdmin({ courseId, lessonId, onNavigate }: LessonEditAdminProps) {
  const toast = useToast();
  const [state, setState] = useState<LessonState>({
    ...EMPTY_FORM,
    module_id: '',
    mux_status: 'pending',
    mux_playback_id: null,
    duration_seconds: null,
    resources: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showReupload, setShowReupload] = useState(false);
  const pollTimerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('course_lessons')
      .select(
        'module_id, title, content_md, is_required, is_free_preview, captions_enabled, mux_status, mux_playback_id, duration_seconds, resources',
      )
      .eq('id', lessonId)
      .single();

    if (error || !data) {
      toast(`Failed to load lesson: ${error?.message ?? 'Not found'}`, 'error');
      setLoading(false);
      return;
    }

    const row = data as {
      module_id: string;
      title: string;
      content_md: string | null;
      is_required: boolean;
      is_free_preview: boolean;
      captions_enabled: boolean;
      mux_status: MuxStatus;
      mux_playback_id: string | null;
      duration_seconds: number | null;
      resources: LessonResource[] | null;
    };

    setState({
      module_id: row.module_id,
      title: row.title ?? '',
      content_md: row.content_md ?? '',
      is_required: row.is_required ?? true,
      is_free_preview: row.is_free_preview ?? false,
      captions_enabled: row.captions_enabled ?? true,
      mux_status: row.mux_status ?? 'pending',
      mux_playback_id: row.mux_playback_id,
      duration_seconds: row.duration_seconds,
      resources: Array.isArray(row.resources) ? row.resources : [],
    });
    setLoading(false);
    setShowReupload(false);
  }, [lessonId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Mux status polling while processing ────────────────────────────────────
  useEffect(() => {
    if (state.mux_status !== 'processing') {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    pollTimerRef.current = window.setInterval(() => {
      void load();
    }, 5000);
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [state.mux_status, load]);

  // ── Validation ─────────────────────────────────────────────────────────────
  const titleError =
    state.title.trim().length === 0
      ? 'Title is required.'
      : state.title.length > 200
        ? 'Title must be 200 characters or fewer.'
        : '';
  const isValid = !titleError;

  // ── Save / delete ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!isValid || saving) return;
    setSaving(true);
    const { error } = await supabase
      .from('course_lessons')
      .update({
        title: state.title.trim(),
        content_md: state.content_md.trim() || null,
        is_required: state.is_required,
        is_free_preview: state.is_free_preview,
        captions_enabled: state.captions_enabled,
      })
      .eq('id', lessonId);
    if (error) {
      toast(`Failed to save lesson: ${error.message}`, 'error');
      setSaving(false);
      return;
    }
    toast('Lesson saved.', 'success');
    setSaving(false);
  };

  const handleDelete = async () => {
    if (deleting) return;
    const ok = window.confirm('Delete this lesson? Progress rows will cascade.');
    if (!ok) return;
    setDeleting(true);
    const { error } = await supabase.from('course_lessons').delete().eq('id', lessonId);
    if (error) {
      toast(`Failed to delete lesson: ${error.message}`, 'error');
      setDeleting(false);
      return;
    }
    toast('Lesson deleted.', 'success');
    setDeleting(false);
    onNavigate(`/admin/courses/${courseId}/modules`);
  };

  // ── Resource handlers ──────────────────────────────────────────────────────
  const handleResourceUploaded = (resource: LessonResource) => {
    setState((prev) => ({ ...prev, resources: [...prev.resources, resource] }));
  };

  const handleResourceDelete = async (path: string) => {
    const ok = window.confirm('Remove this resource from the lesson?');
    if (!ok) return;
    const next = state.resources.filter((r) => r.path !== path);
    const { error } = await supabase
      .from('course_lessons')
      .update({ resources: next })
      .eq('id', lessonId);
    if (error) {
      toast(`Failed to remove resource: ${error.message}`, 'error');
      return;
    }
    setState((prev) => ({ ...prev, resources: next }));
    toast('Resource removed.', 'success');
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6 text-sm text-[var(--color-text-secondary)]">Loading lesson…</div>
    );
  }

  const showUploader =
    state.mux_status === 'pending' ||
    state.mux_status === 'rejected' ||
    state.mux_status === 'errored' ||
    showReupload;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="space-y-5 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <h3 className="text-base font-semibold">Edit lesson</h3>

        {/* Title */}
        <div>
          <label htmlFor="lesson-title" className="block text-sm font-medium mb-1">
            Title <span aria-hidden="true" className="text-[var(--color-danger)]">*</span>
          </label>
          <Input
            id="lesson-title"
            value={state.title}
            onChange={(e) => setState((p) => ({ ...p, title: e.target.value }))}
            maxLength={200}
            disabled={saving}
            aria-invalid={!!titleError}
            placeholder="e.g. Why injection-site rotation matters"
          />
          {titleError && (
            <p className="mt-1 text-xs text-[var(--color-danger)]">{titleError}</p>
          )}
        </div>

        {/* Markdown content */}
        <div>
          <label htmlFor="lesson-content" className="block text-sm font-medium mb-1">
            Lesson notes (Markdown, optional)
          </label>
          <textarea
            id="lesson-content"
            value={state.content_md}
            onChange={(e) => setState((p) => ({ ...p, content_md: e.target.value }))}
            disabled={saving}
            rows={8}
            className="w-full font-mono text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60"
            placeholder="# Outline&#10;&#10;- Why this matters&#10;- Key takeaways"
          />
        </div>

        {/* Flags */}
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={state.is_required}
              onChange={(e) => setState((p) => ({ ...p, is_required: e.target.checked }))}
              disabled={saving}
              className="h-4 w-4 rounded border-[var(--color-border)]"
            />
            Required for completion
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={state.is_free_preview}
              onChange={(e) =>
                setState((p) => ({ ...p, is_free_preview: e.target.checked }))
              }
              disabled={saving}
              className="h-4 w-4 rounded border-[var(--color-border)]"
            />
            Free preview (bypass tier gate)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={state.captions_enabled}
              onChange={(e) =>
                setState((p) => ({ ...p, captions_enabled: e.target.checked }))
              }
              disabled={saving}
              className="h-4 w-4 rounded border-[var(--color-border)]"
            />
            Auto-generate captions
          </label>
        </div>

        {/* Save / delete */}
        <div className="flex items-center gap-3 pt-2 border-t border-[var(--color-border)]">
          <Button
            variant="primary"
            onClick={() => void handleSave()}
            disabled={!isValid || saving}
            aria-busy={saving}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleDelete()}
            disabled={saving || deleting}
            aria-busy={deleting}
          >
            {deleting ? 'Deleting…' : 'Delete lesson'}
          </Button>
        </div>
      </div>

      {/* Mux video panel */}
      <div className="space-y-3 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <h4 className="text-sm font-semibold">Lesson video</h4>

        {state.mux_status === 'processing' && (
          <p className="text-sm text-[var(--color-text-secondary)]" aria-live="polite">
            Transcoding… (auto-refreshing every 5 s)
          </p>
        )}

        {state.mux_status === 'ready' && !showReupload && (
          <div className="space-y-2">
            <p className="text-sm">
              Video ready.{' '}
              {state.duration_seconds !== null && (
                <span className="text-[var(--color-text-secondary)]">
                  Duration: {Math.round(state.duration_seconds)} s
                </span>
              )}
            </p>
            {state.mux_playback_id && (
              <p className="text-xs font-mono text-[var(--color-text-secondary)]">
                playback_id: {state.mux_playback_id}
              </p>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowReupload(true)}
            >
              Replace video
            </Button>
          </div>
        )}

        {(state.mux_status === 'rejected' || state.mux_status === 'errored') && (
          <p className="text-sm text-[var(--color-danger)]">
            Video upload failed ({state.mux_status}). Re-upload below.
          </p>
        )}

        {showUploader && (
          <LessonVideoUploader
            lessonId={lessonId}
            courseId={courseId}
            onUploaded={() => {
              setShowReupload(false);
              // Optimistic flip; webhook will move pending→processing→ready.
              setState((p) => ({ ...p, mux_status: 'processing' }));
              void load();
            }}
          />
        )}
      </div>

      {/* Resources panel */}
      <div className="space-y-3 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <h4 className="text-sm font-semibold">Downloadable resources</h4>

        <LessonResourceUploader
          lessonId={lessonId}
          courseId={courseId}
          existingResources={state.resources}
          onUploaded={handleResourceUploaded}
        />

        {state.resources.length === 0 && (
          <p className="text-xs text-[var(--color-text-secondary)] italic">
            No resources attached yet.
          </p>
        )}

        {state.resources.length > 0 && (
          <ul className="space-y-2">
            {state.resources.map((r) => (
              <li
                key={r.path}
                className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{r.name}</p>
                  <p className="text-xs text-[var(--color-text-secondary)] font-mono truncate">
                    {r.mime}
                    {typeof r.size === 'number' && (
                      <> · {(r.size / (1024 * 1024)).toFixed(2)} MB</>
                    )}
                    {r.requires_pro ? ' · Pro+' : ' · all tiers'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleResourceDelete(r.path)}
                  className="text-xs text-[var(--color-danger)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-danger)] rounded"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default LessonEditAdmin;
