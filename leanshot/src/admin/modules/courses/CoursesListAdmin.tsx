/**
 * Phase 46 Plan 46-09 (COURSE-01) — Admin Courses list view.
 *
 * Renders all rows from public.courses for admin authoring. Visible only when
 * AdminShell role gate + admin.courses.enabled flag pass (Pattern S1 UX layer);
 * writes via INSERT/UPDATE/DELETE are RLS-gated by public.is_staff() at the
 * DB layer (Plan 46-01 Task 2 policies).
 *
 * Pathname-based navigation only (admin convention; mirrors
 * CommunityAdminLayout / ModerationLayout — see PATTERNS.md).
 */
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

interface CourseRow {
  id: string;
  title: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export interface CoursesListAdminProps {
  onNavigate: (path: string) => void;
}

export function CoursesListAdmin({ onNavigate }: CoursesListAdminProps) {
  const [rows, setRows] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from('courses')
        .select('id, title, slug, created_at, updated_at')
        .order('created_at', { ascending: false });
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      setRows((data ?? []) as CourseRow[]);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Courses</h2>
        <button
          type="button"
          onClick={() => onNavigate('/admin/courses/new')}
          className="inline-flex h-8 items-center rounded-full bg-[var(--color-primary)] px-4 text-xs font-semibold text-[var(--color-primary-foreground)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          + New course
        </button>
      </div>

      {loading && (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading courses…</p>
      )}

      {error && (
        <p className="text-sm text-[var(--color-danger)]">
          Failed to load courses: {error}
        </p>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No courses yet. Click <strong>New course</strong> to author the first one.
        </p>
      )}

      {!loading && !error && rows.length > 0 && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Title
              </th>
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Slug
              </th>
              <th className="py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Updated
              </th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr
                key={c.id}
                className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-elevated)]"
              >
                <td className="py-2 font-medium">{c.title}</td>
                <td className="py-2 text-[var(--color-text-secondary)] font-mono text-xs">
                  {c.slug}
                </td>
                <td className="py-2 text-[var(--color-text-secondary)] text-xs">
                  {new Date(c.updated_at).toLocaleDateString()}
                </td>
                <td className="py-2 text-right space-x-3">
                  <button
                    type="button"
                    onClick={() => onNavigate(`/admin/courses/${c.id}`)}
                    className="text-xs font-medium text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)] rounded"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate(`/admin/courses/${c.id}/modules`)}
                    className="text-xs font-medium text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)] rounded"
                  >
                    Modules
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default CoursesListAdmin;
