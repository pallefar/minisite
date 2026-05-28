/**
 * Phase 46 Plan 46-09 (COURSE-06) — Admin uploader for course lesson resources.
 *
 * Uploads to the `course-resources` Storage bucket (Plan 46-02) with
 * path layout `${courseId}/${lessonId}/${uuid}.${ext}`. After upload,
 * reads the lesson's resources jsonb, appends the new entry, and writes
 * the updated array via UPDATE — read-modify-write at the column level
 * (Plan 46-08 added the column in migration 20270725000006).
 *
 * MIME + size validated client-side from constants in course-storage.ts
 * (COURSE_RESOURCES_MIMES, COURSE_RESOURCES_MAX_BYTES). The bucket RLS
 * policy created by Plan 46-02 is the durable enforcement boundary
 * (T-46-06 path-traversal + is_staff() write gate).
 */
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import {
  COURSE_RESOURCES_BUCKET,
  COURSE_RESOURCES_MAX_BYTES,
  COURSE_RESOURCES_MIMES,
} from '@/lib/course/course-storage';
import type { LessonResource } from '@/lib/course/course-types';
import { supabase } from '@/lib/supabase';

export interface LessonResourceUploaderProps {
  lessonId: string;
  courseId: string;
  existingResources: LessonResource[];
  onUploaded: (resource: LessonResource) => void;
}

const ACCEPT_ATTR = 'application/pdf,video/mp4,application/zip';

export function LessonResourceUploader({
  lessonId,
  courseId,
  existingResources,
  onUploaded,
}: LessonResourceUploaderProps) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [requiresPro, setRequiresPro] = useState(true);

  const handleFile = async (file: File) => {
    if (!COURSE_RESOURCES_MIMES.has(file.type)) {
      toast(`Unsupported file type: ${file.type || 'unknown'}. Allowed: PDF, MP4, ZIP.`, 'error');
      return;
    }
    if (file.size > COURSE_RESOURCES_MAX_BYTES) {
      const maxMB = Math.round(COURSE_RESOURCES_MAX_BYTES / (1024 * 1024));
      toast(`File too large (max ${maxMB} MB).`, 'error');
      return;
    }

    setUploading(true);

    // Path layout: <courseId>/<lessonId>/<uuid>.<ext>
    // - keeps courseId prefix for bucket RLS path-prefix policies
    // - uuid keeps each upload unique so upsert:false never collides
    const dotIdx = file.name.lastIndexOf('.');
    const ext = dotIdx > -1 ? file.name.slice(dotIdx + 1).toLowerCase() : 'bin';
    const uuid =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const path = `${courseId}/${lessonId}/${uuid}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(COURSE_RESOURCES_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });

    if (uploadError) {
      const msg = uploadError.message.toLowerCase();
      const friendly =
        msg.includes('forbidden') || msg.includes('not authorized')
          ? 'Only admins can upload course resources.'
          : `Upload failed: ${uploadError.message}`;
      toast(friendly, 'error');
      setUploading(false);
      return;
    }

    const newResource: LessonResource = {
      name: file.name,
      path,
      mime: file.type,
      size: file.size,
      requires_pro: requiresPro,
    };

    // Read-modify-write the resources jsonb array.
    const next = [...existingResources, newResource];
    const { error: updateError } = await supabase
      .from('course_lessons')
      .update({ resources: next })
      .eq('id', lessonId);

    if (updateError) {
      // Orphan the uploaded object if the metadata update fails so the admin
      // can retry without colliding on the path (upsert:false).
      await supabase.storage.from(COURSE_RESOURCES_BUCKET).remove([path]);
      toast(`Failed to attach resource: ${updateError.message}`, 'error');
      setUploading(false);
      return;
    }

    toast(`Uploaded "${file.name}".`, 'success');
    onUploaded(newResource);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
          className="text-sm file:me-3 file:rounded-full file:border-0 file:bg-[var(--color-primary)] file:px-4 file:py-1.5 file:text-xs file:font-semibold file:text-[var(--color-primary-foreground)] disabled:opacity-60"
        />
        <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          <input
            type="checkbox"
            checked={requiresPro}
            onChange={(e) => setRequiresPro(e.target.checked)}
            disabled={uploading}
            className="h-4 w-4 rounded border-[var(--color-border)]"
          />
          Requires Pro+
        </label>
        {uploading && (
          <Button variant="ghost" size="sm" disabled aria-busy="true">
            Uploading…
          </Button>
        )}
      </div>
      <p className="text-xs text-[var(--color-text-secondary)]">
        Allowed: PDF · MP4 · ZIP · max {Math.round(COURSE_RESOURCES_MAX_BYTES / (1024 * 1024))} MB
        per file.
      </p>
    </div>
  );
}

export default LessonResourceUploader;
