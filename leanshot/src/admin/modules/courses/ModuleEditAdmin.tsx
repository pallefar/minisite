/**
 * Phase 46 Plan 46-09 (COURSE-02) — Module + lesson tree editor.
 *
 * Replaces the stub in Task 2 — full SortableTreePanel-driven nested DnD
 * reorder for modules and lessons, with Add/Delete CTAs.
 *
 * Loads: supabase.from('course_modules').select(..., course_lessons(...)).
 * Writes: supabase.from('course_modules' | 'course_lessons').{insert,update,delete}.
 * Security: RLS via public.is_staff() gates all writes (Plan 46-01 Task 2).
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SortableTreePanel } from '@/components/ui/SortableTreePanel';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

export interface ModuleEditAdminProps {
  courseId: string;
  onNavigate: (path: string) => void;
}

interface LessonRow {
  id: string;
  title: string;
  order_index: number;
  is_required: boolean;
  is_free_preview: boolean;
}

interface ModuleRow {
  id: string;
  title: string;
  order_index: number;
  lessons: LessonRow[];
}

interface LoadedModuleRow {
  id: string;
  title: string;
  order_index: number;
  course_lessons: Array<{
    id: string;
    title: string;
    order_index: number;
    is_required: boolean;
    is_free_preview: boolean;
  }> | null;
}

export function ModuleEditAdmin({ courseId, onNavigate }: ModuleEditAdminProps) {
  const toast = useToast();
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('course_modules')
      .select(
        'id, title, order_index, course_lessons(id, title, order_index, is_required, is_free_preview)',
      )
      .eq('course_id', courseId)
      .order('order_index', { ascending: true });

    if (error) {
      toast(`Failed to load modules: ${error.message}`, 'error');
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as LoadedModuleRow[];
    const next: ModuleRow[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      order_index: r.order_index,
      lessons: [...(r.course_lessons ?? [])].sort((a, b) => a.order_index - b.order_index),
    }));
    setModules(next);
    setLoading(false);
  }, [courseId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Module reorder ─────────────────────────────────────────────────────────
  const handleModulesReorder = async (next: ModuleRow[]) => {
    setModules(next); // optimistic
    setBusy(true);
    // Serial UPDATEs of order_index per memory feedback_batched_edits_verify_file_count.
    for (let i = 0; i < next.length; i++) {
      const m = next[i]!;
      const { error } = await supabase
        .from('course_modules')
        .update({ order_index: i })
        .eq('id', m.id);
      if (error) {
        toast(`Reorder failed: ${error.message}`, 'error');
        await load();
        setBusy(false);
        return;
      }
    }
    setBusy(false);
  };

  // ── Lesson reorder within a module ─────────────────────────────────────────
  const handleLessonsReorder = async (moduleId: string, nextLessons: LessonRow[]) => {
    setModules((prev) => prev.map((m) => (m.id === moduleId ? { ...m, lessons: nextLessons } : m)));
    setBusy(true);
    for (let i = 0; i < nextLessons.length; i++) {
      const l = nextLessons[i]!;
      const { error } = await supabase
        .from('course_lessons')
        .update({ order_index: i })
        .eq('id', l.id);
      if (error) {
        toast(`Reorder failed: ${error.message}`, 'error');
        await load();
        setBusy(false);
        return;
      }
    }
    setBusy(false);
  };

  // ── Module create / delete ─────────────────────────────────────────────────
  const handleAddModule = async () => {
    const title = window.prompt('New module title');
    if (!title || !title.trim()) return;
    setBusy(true);
    const { error } = await supabase
      .from('course_modules')
      .insert({ course_id: courseId, title: title.trim(), order_index: modules.length });
    if (error) {
      toast(`Failed to add module: ${error.message}`, 'error');
      setBusy(false);
      return;
    }
    await load();
    setBusy(false);
  };

  const handleDeleteModule = async (moduleId: string) => {
    const ok = window.confirm(
      'Delete this module? All its lessons + progress + uploaded videos metadata will cascade.',
    );
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from('course_modules').delete().eq('id', moduleId);
    if (error) {
      toast(`Failed to delete module: ${error.message}`, 'error');
      setBusy(false);
      return;
    }
    await load();
    setBusy(false);
  };

  // ── Lesson create / delete ─────────────────────────────────────────────────
  const handleAddLesson = async (moduleId: string, existingLessons: LessonRow[]) => {
    const title = window.prompt('New lesson title');
    if (!title || !title.trim()) return;
    setBusy(true);
    const { data, error } = await supabase
      .from('course_lessons')
      .insert({
        module_id: moduleId,
        title: title.trim(),
        order_index: existingLessons.length,
      })
      .select('id')
      .single();
    if (error || !data) {
      toast(`Failed to add lesson: ${error?.message ?? 'Unknown error'}`, 'error');
      setBusy(false);
      return;
    }
    await load();
    setBusy(false);
    onNavigate(`/admin/courses/${courseId}/lesson/${(data as { id: string }).id}`);
  };

  const handleDeleteLesson = async (lessonId: string) => {
    const ok = window.confirm('Delete this lesson? Progress rows will cascade.');
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from('course_lessons').delete().eq('id', lessonId);
    if (error) {
      toast(`Failed to delete lesson: ${error.message}`, 'error');
      setBusy(false);
      return;
    }
    await load();
    setBusy(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="p-6 text-sm text-[var(--color-text-secondary)]">Loading modules…</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Modules &amp; lessons</h2>
        <Button variant="primary" size="sm" onClick={() => void handleAddModule()} disabled={busy}>
          + Add module
        </Button>
      </div>

      {modules.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No modules yet. Click <strong>Add module</strong> to start.
        </p>
      )}

      {modules.length > 0 && (
        <SortableTreePanel
          items={modules}
          getId={(m) => m.id}
          onReorder={(next) => void handleModulesReorder(next)}
          announceItemLabel={(m) => `Module ${m.title}`}
          renderItem={(mod) => (
            <div className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm">{mod.title}</strong>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleAddLesson(mod.id, mod.lessons)}
                    disabled={busy}
                  >
                    + Lesson
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => void handleDeleteModule(mod.id)}
                    disabled={busy}
                  >
                    Delete
                  </Button>
                </div>
              </div>

              {mod.lessons.length === 0 ? (
                <p className="text-xs text-[var(--color-text-secondary)] italic ps-2">
                  No lessons yet.
                </p>
              ) : (
                <SortableTreePanel
                  items={mod.lessons}
                  getId={(l) => l.id}
                  onReorder={(next) => void handleLessonsReorder(mod.id, next)}
                  announceItemLabel={(l) => `Lesson ${l.title}`}
                  renderItem={(lesson) => (
                    <div className="flex flex-1 items-center justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2">
                      <button
                        type="button"
                        onClick={() => onNavigate(`/admin/courses/${courseId}/lesson/${lesson.id}`)}
                        className="text-sm text-start font-medium text-[var(--color-text)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)] rounded"
                      >
                        {lesson.title}
                      </button>
                      <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                        {lesson.is_required && <span>required</span>}
                        {lesson.is_free_preview && <span>free preview</span>}
                        <button
                          type="button"
                          onClick={() => void handleDeleteLesson(lesson.id)}
                          disabled={busy}
                          className="text-[var(--color-danger)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-danger)] rounded"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                />
              )}
            </div>
          )}
        />
      )}
    </div>
  );
}

export default ModuleEditAdmin;
