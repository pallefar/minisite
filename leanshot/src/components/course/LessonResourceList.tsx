/**
 * Phase 46 Plan 08 — LessonResourceList.
 *
 * Renders the tier-gated downloadable resources for a single lesson.
 * Source: `course_lessons.resources` jsonb array (column added by
 * `20270725000006_p46_course_lessons_resources_column.sql`, this plan).
 *
 * Gate stack (per CONTEXT D-16 / COURSE-06 / threats T-46-06 + T-46-08):
 *   1. Client UX gate — isResourceAllowed(tier, type) hides the download
 *      button for Free users on requires_pro resources (renders upgrade CTA).
 *   2. Bucket RLS gate — 403 from createSignedUrl when tier_effective.has_active
 *      is false. The advisory message becomes 'forbidden' from
 *      downloadResourceSignedUrl mapping.
 *   3. Signed-URL TTL — 60 min default (T-46-08 — short-window leakage).
 */
import { Download, FileArchive, FileText, Lock, Video } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import type { TierLabel } from '@/lib/community/tier-gate';
import { isResourceAllowed } from '@/lib/community/tier-gate';
import { downloadResourceSignedUrl, mimeToResourceType } from '@/lib/course/course-storage';
import type { CourseLesson, LessonResource } from '@/lib/course/course-types';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LessonResourceListProps {
  lesson: CourseLesson;
  currentTier: TierLabel;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function ResourceIcon({ mime }: { mime: string }): ReactNode {
  if (mime === 'application/pdf') return <FileText className="size-5" aria-hidden />;
  if (mime === 'video/mp4') return <Video className="size-5" aria-hidden />;
  if (mime === 'application/zip') return <FileArchive className="size-5" aria-hidden />;
  return <FileText className="size-5" aria-hidden />;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface RowState {
  downloading: boolean;
  error: 'forbidden' | 'not_found' | 'network' | null;
}

export function LessonResourceList({ lesson, currentTier }: LessonResourceListProps) {
  const resources: LessonResource[] = Array.isArray(lesson.resources) ? lesson.resources : [];
  const [rowState, setRowState] = useState<Record<string, RowState>>({});

  if (resources.length === 0) {
    return null;
  }

  async function handleDownload(resource: LessonResource): Promise<void> {
    setRowState((s) => ({ ...s, [resource.path]: { downloading: true, error: null } }));
    const result = await downloadResourceSignedUrl(resource.path);
    if (result.ok) {
      window.open(result.url, '_blank', 'noopener,noreferrer');
      setRowState((s) => ({ ...s, [resource.path]: { downloading: false, error: null } }));
      return;
    }
    setRowState((s) => ({
      ...s,
      [resource.path]: { downloading: false, error: result.error },
    }));
  }

  return (
    <section aria-label="Lesson resources" className="mt-6">
      <h3 className="text-[15px] font-semibold tracking-tight text-[var(--color-text)] mb-3">
        Resources
      </h3>
      <ul className="space-y-2">
        {resources.map((resource) => {
          const allowed =
            !resource.requires_pro ||
            isResourceAllowed(currentTier, mimeToResourceType(resource.mime));
          const state = rowState[resource.path] ?? { downloading: false, error: null };
          return (
            <li key={resource.path}>
              <Card variant="default" padding="sm">
                <div className="flex items-center gap-3">
                  <span className="text-[var(--color-text-secondary)] shrink-0">
                    <ResourceIcon mime={resource.mime} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-[var(--color-text)] truncate">
                      {resource.name}
                    </p>
                    <p className="text-[12px] text-[var(--color-text-secondary)]">
                      {resource.mime}
                      {resource.size ? ` · ${formatBytes(resource.size)}` : ''}
                    </p>
                    {state.error === 'forbidden' && (
                      <p className="text-[12px] text-[var(--color-warning)] mt-1">
                        Upgrade required to download this resource.
                      </p>
                    )}
                    {state.error === 'not_found' && (
                      <p className="text-[12px] text-[var(--color-warning)] mt-1">
                        This file is no longer available.
                      </p>
                    )}
                    {state.error === 'network' && (
                      <p className="text-[12px] text-[var(--color-warning)] mt-1">
                        Could not load the download — please retry.
                      </p>
                    )}
                  </div>
                  {allowed ? (
                    <button
                      type="button"
                      onClick={() => void handleDownload(resource)}
                      disabled={state.downloading}
                      aria-label={`Download ${resource.name}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
                    >
                      <Download className="size-4" />
                      {state.downloading ? 'Loading…' : 'Download'}
                    </button>
                  ) : (
                    <span
                      aria-label="Upgrade required"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] px-3 py-1.5 text-[12px] font-semibold"
                    >
                      <Lock className="size-4" />
                      Pro
                    </span>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default LessonResourceList;
