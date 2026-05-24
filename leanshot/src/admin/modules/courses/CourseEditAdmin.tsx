/**
 * Phase 46 Plan 46-09 (COURSE-01) — Admin Course create/edit form.
 *
 * Mode dispatch:
 *   - courseId === null → create mode → INSERT, then navigate to /admin/courses/<new_id>
 *   - courseId === string → edit mode → load row, allow UPDATE / DELETE
 *
 * Form fields mirror the public.courses schema written by Plan 46-01:
 *   title, slug, description, cover_url, completion_threshold_pct, enforce_completion
 *
 * Security:
 *   - UX layer: AdminShell minRole='admin' gates module visibility.
 *   - DB layer: courses_insert_staff / courses_update_staff / courses_delete_staff
 *     RLS policies require public.is_staff() (Plan 46-01 Task 2).
 *
 * Navigation handled via the onNavigate prop forwarded from CoursesAdminLayout
 * (pathname-based pushState — see PATTERNS.md).
 */
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

export interface CourseEditAdminProps {
  /** null → create mode; uuid string → edit mode. */
  courseId: string | null;
  onNavigate: (path: string) => void;
}

interface CourseFormState {
  title: string;
  slug: string;
  description: string;
  cover_url: string;
  completion_threshold_pct: number;
  enforce_completion: boolean;
}

const EMPTY_FORM: CourseFormState = {
  title: '',
  slug: '',
  description: '',
  cover_url: '',
  completion_threshold_pct: 100,
  enforce_completion: true,
};

export function CourseEditAdmin({ courseId, onNavigate }: CourseEditAdminProps) {
  const toast = useToast();
  const isNew = courseId === null;

  const [form, setForm] = useState<CourseFormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Load existing course in edit mode.
  useEffect(() => {
    if (isNew) return;

    void (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('courses')
        .select(
          'title, slug, description, cover_url, completion_threshold_pct, enforce_completion',
        )
        .eq('id', courseId)
        .single();

      if (error || !data) {
        toast(`Failed to load course: ${error?.message ?? 'Not found'}`, 'error');
        setLoading(false);
        return;
      }

      const row = data as Partial<CourseFormState>;
      setForm({
        title: row.title ?? '',
        slug: row.slug ?? '',
        description: row.description ?? '',
        cover_url: row.cover_url ?? '',
        completion_threshold_pct:
          typeof row.completion_threshold_pct === 'number'
            ? row.completion_threshold_pct
            : 100,
        enforce_completion: row.enforce_completion ?? true,
      });
      setLoading(false);
    })();
  }, [courseId, isNew, toast]);

  // ── Validation ─────────────────────────────────────────────────────────────
  const titleError =
    form.title.trim().length === 0
      ? 'Title is required.'
      : form.title.length > 200
        ? 'Title must be 200 characters or fewer.'
        : '';

  const slugError = !/^[a-z0-9-]+$/.test(form.slug.trim())
    ? 'Slug must be lowercase letters, digits, and hyphens only.'
    : '';

  const thresholdError =
    !Number.isInteger(form.completion_threshold_pct) ||
    form.completion_threshold_pct < 1 ||
    form.completion_threshold_pct > 100
      ? 'Threshold must be an integer between 1 and 100.'
      : '';

  const isValid = !titleError && !slugError && !thresholdError;

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!isValid || saving) return;
    setSaving(true);

    const payload = {
      title: form.title.trim(),
      slug: form.slug.trim(),
      description: form.description.trim() || null,
      cover_url: form.cover_url.trim() || null,
      completion_threshold_pct: form.completion_threshold_pct,
      enforce_completion: form.enforce_completion,
    };

    if (isNew) {
      const { data, error } = await supabase
        .from('courses')
        .insert(payload)
        .select('id')
        .single();

      if (error || !data) {
        toast(`Failed to create course: ${error?.message ?? 'Unknown error'}`, 'error');
        setSaving(false);
        return;
      }
      toast(`Course "${payload.title}" created.`, 'success');
      setSaving(false);
      onNavigate(`/admin/courses/${(data as { id: string }).id}`);
    } else {
      const { error } = await supabase.from('courses').update(payload).eq('id', courseId!);
      if (error) {
        toast(`Failed to update course: ${error.message}`, 'error');
        setSaving(false);
        return;
      }
      toast(`Course "${payload.title}" updated.`, 'success');
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (isNew || deleting) return;
    const ok = window.confirm(
      'Delete this course? Modules, lessons, progress, and certificates will cascade. This cannot be undone.',
    );
    if (!ok) return;

    setDeleting(true);
    const { error } = await supabase.from('courses').delete().eq('id', courseId!);
    if (error) {
      toast(`Failed to delete course: ${error.message}`, 'error');
      setDeleting(false);
      return;
    }
    toast('Course deleted.', 'success');
    setDeleting(false);
    onNavigate('/admin/courses');
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="p-6 text-sm text-[var(--color-text-secondary)]">Loading course…</div>;
  }

  return (
    <div className="space-y-5 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] max-w-lg">
      <h3 className="text-base font-semibold">{isNew ? 'New course' : 'Edit course'}</h3>

      {/* Title */}
      <div>
        <label htmlFor="course-title" className="block text-sm font-medium mb-1">
          Title <span aria-hidden="true" className="text-[var(--color-danger)]">*</span>
        </label>
        <Input
          id="course-title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          maxLength={200}
          disabled={saving}
          aria-invalid={!!titleError}
          aria-describedby={titleError ? 'course-title-error' : undefined}
          placeholder="e.g. GLP-1 onboarding 101"
        />
        {titleError && (
          <p id="course-title-error" className="mt-1 text-xs text-[var(--color-danger)]">
            {titleError}
          </p>
        )}
      </div>

      {/* Slug */}
      <div>
        <label htmlFor="course-slug" className="block text-sm font-medium mb-1">
          Slug <span aria-hidden="true" className="text-[var(--color-danger)]">*</span>
        </label>
        <Input
          id="course-slug"
          value={form.slug}
          onChange={(e) => setForm({ ...form, slug: e.target.value })}
          maxLength={120}
          disabled={saving}
          aria-invalid={!!slugError}
          aria-describedby={slugError ? 'course-slug-error' : undefined}
          placeholder="glp1-onboarding-101"
        />
        {slugError && (
          <p id="course-slug-error" className="mt-1 text-xs text-[var(--color-danger)]">
            {slugError}
          </p>
        )}
      </div>

      {/* Description */}
      <div>
        <label htmlFor="course-description" className="block text-sm font-medium mb-1">
          Description (optional)
        </label>
        <textarea
          id="course-description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          maxLength={2000}
          disabled={saving}
          rows={3}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60"
          placeholder="What will students learn?"
        />
      </div>

      {/* Cover URL */}
      <div>
        <label htmlFor="course-cover-url" className="block text-sm font-medium mb-1">
          Cover image URL (optional)
        </label>
        <Input
          id="course-cover-url"
          value={form.cover_url}
          onChange={(e) => setForm({ ...form, cover_url: e.target.value })}
          disabled={saving}
          placeholder="https://…/cover.png"
        />
      </div>

      {/* Threshold */}
      <div>
        <label
          htmlFor="course-threshold"
          className="block text-sm font-medium mb-1"
        >
          Completion threshold (%)
        </label>
        <Input
          id="course-threshold"
          type="number"
          min={1}
          max={100}
          step={1}
          value={String(form.completion_threshold_pct)}
          onChange={(e) =>
            setForm({
              ...form,
              completion_threshold_pct: Number.parseInt(e.target.value, 10) || 0,
            })
          }
          disabled={saving}
          aria-invalid={!!thresholdError}
          aria-describedby={thresholdError ? 'course-threshold-error' : undefined}
        />
        {thresholdError && (
          <p id="course-threshold-error" className="mt-1 text-xs text-[var(--color-danger)]">
            {thresholdError}
          </p>
        )}
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          Percentage of required lessons that must be completed before a certificate is issued (1–100).
        </p>
      </div>

      {/* Enforce completion */}
      <div className="flex items-start gap-2">
        <input
          id="course-enforce-completion"
          type="checkbox"
          checked={form.enforce_completion}
          onChange={(e) => setForm({ ...form, enforce_completion: e.target.checked })}
          disabled={saving}
          className="mt-1 h-4 w-4 rounded border-[var(--color-border)]"
        />
        <label htmlFor="course-enforce-completion" className="text-sm">
          Enforce ≥95% anti-skip on each lesson
          <span className="block text-xs text-[var(--color-text-secondary)]">
            When off, lessons can be marked complete without watching the full video.
          </span>
        </label>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2 border-t border-[var(--color-border)]">
        <Button
          variant="primary"
          onClick={() => void handleSave()}
          disabled={!isValid || saving}
          aria-busy={saving}
        >
          {saving ? 'Saving…' : isNew ? 'Create course' : 'Save changes'}
        </Button>
        {!isNew && (
          <>
            <Button
              variant="secondary"
              onClick={() => onNavigate(`/admin/courses/${courseId}/modules`)}
              disabled={saving || deleting}
            >
              Manage modules →
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={saving || deleting}
              aria-busy={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default CourseEditAdmin;
