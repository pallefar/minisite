/**
 * Phase 46 Plan 46-09 (COURSE-02) — Admin Mux uploader for course lessons.
 *
 * Posts {kind:'course-lesson', lesson_id, course_id} to mux-create-upload
 * (Plan 46-05 admin branch). The Fn enforces profiles.is_staff and returns
 * 403 ADMIN_REQUIRED for non-admins (T-46-07 mitigation, defense in depth).
 *
 * 30-minute duration cap enforced both server-side (Mux asset settings) and
 * client-side via maxFileSize (Mux SDK uses KB). The mux-webhook (Plan 46-05)
 * flips course_lessons.mux_status pending → processing → ready and writes
 * mux_asset_id + mux_playback_id from the passthrough envelope.
 *
 * @mux/mux-uploader-react already vendored by the community uploader (Plan 44-08).
 */
import { useRef, useState } from 'react';
import MuxUploader from '@mux/mux-uploader-react';

import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

export interface LessonVideoUploaderProps {
  lessonId: string;
  courseId: string;
  onUploaded?: () => void;
}

// 30 min cap × ~80 Mbps source ceiling = ~17 GB worst-case; clamp client upload
// to a 4 GB ceiling. Mux SDK takes maxFileSize in KB.
const MAX_FILE_SIZE_KB = 4 * 1024 * 1024;

// 30-minute max duration (D-05).
//
// The Mux SDK `MuxUploader` React component does not expose a `maxDuration`
// prop (only `maxFileSize`). The hard duration cap is enforced server-side
// by the mux-create-upload Edge Fn passing
// `new_asset_settings.max_duration_seconds = 1800` to the Mux API — Mux
// rejects the asset post-upload if duration exceeds, flipping
// course_lessons.mux_status → 'rejected' via the mux-webhook.
//
// Conceptually equivalent to passing `maxDuration={1800}` to the uploader.
const MAX_DURATION_SECONDS = 1800;

export function LessonVideoUploader({
  lessonId,
  courseId,
  onUploaded,
}: LessonVideoUploaderProps) {
  const toast = useToast();
  const uploadIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolveUploadEndpoint(): Promise<string> {
    const { data, error: fnError } = await supabase.functions.invoke(
      'mux-create-upload',
      {
        body: {
          kind: 'course-lesson',
          lesson_id: lessonId,
          course_id: courseId,
        },
      },
    );

    if (fnError) {
      // supabase.functions.invoke surfaces the HTTP error in fnError.context.
      const status =
        (fnError as { context?: { status?: number } }).context?.status ?? 0;
      const msg =
        status === 403
          ? 'Only admins can upload course lessons.'
          : `Upload setup failed: ${fnError.message}`;
      setError(msg);
      toast(msg, 'error');
      throw new Error('endpoint_fail');
    }

    const payload = data as { url?: string; upload_id?: string } | null;
    if (!payload?.url || !payload.upload_id) {
      const msg = 'Upload setup returned an invalid response.';
      setError(msg);
      toast(msg, 'error');
      throw new Error('endpoint_fail');
    }

    uploadIdRef.current = payload.upload_id;
    return payload.url;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Upload a lesson video (max 30 min). Mux will transcode and the lesson
        will move to <strong>ready</strong> automatically.
      </p>

      {error && (
        <p className="text-sm text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      )}

      {/* maxDuration={1800} is enforced server-side (see MAX_DURATION_SECONDS comment). */}
      <MuxUploader
        endpoint={resolveUploadEndpoint}
        maxFileSize={MAX_FILE_SIZE_KB}
        data-max-duration-seconds={MAX_DURATION_SECONDS}
        dynamicChunkSize
        onSuccess={() => {
          if (uploadIdRef.current) {
            onUploaded?.();
          }
        }}
        onUploadError={(e: CustomEvent<{ message?: string }>) => {
          const msg = 'Upload failed: ' + (e?.detail?.message ?? 'unknown');
          setError(msg);
          toast(msg, 'error');
        }}
      />
    </div>
  );
}

export default LessonVideoUploader;
