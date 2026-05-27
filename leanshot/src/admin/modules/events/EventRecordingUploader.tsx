/**
 * Phase 47 Plan 47-11 (EVENT-05) — Admin Mux uploader for event recordings.
 *
 * Posts { kind: 'event-recording', event_id } to mux-create-upload (Phase 47
 * Plan 47-09 admin branch). The Fn enforces public.is_staff and returns
 * 403 ADMIN_REQUIRED for non-admins (T-46-07 mirror) — defense in depth on
 * top of the AdminShell minRole='staff' UX gate (Pattern S1 dual-layer).
 *
 * When the recording is "attached to a course module" (events.attach_to_module_id
 * is set), the mux-webhook converts the Mux asset to a course_lessons row under
 * that module. When attach_to_module_id is NULL, the recording lives on the
 * events row itself as a standalone Mux asset (events.recording_mux_asset_id +
 * events.recording_playback_id, Phase 47 Plan 47-01 schema D-15).
 *
 * Mirrors the LessonVideoUploader.tsx Mux pattern (admin sibling shipped Plan 46-09).
 *
 * Admin surface — pathname-based, no client-router package imports.
 */
import MuxUploader from '@mux/mux-uploader-react';
import { useRef, useState } from 'react';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabase';

export interface EventRecordingUploaderProps {
  eventId: string;
  onUploaded?: () => void;
}

// Upload size ceiling — events can run up to ~3h; clamp to 8 GB to stay below
// the practical browser PUT ceiling. Mux SDK takes maxFileSize in KB.
const MAX_FILE_SIZE_KB = 8 * 1024 * 1024;

export function EventRecordingUploader({
  eventId,
  onUploaded,
}: EventRecordingUploaderProps) {
  const toast = useToast();
  const uploadIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolveUploadEndpoint(): Promise<string> {
    const { data, error: fnError } = await supabase.functions.invoke(
      'mux-create-upload',
      {
        body: { kind: 'event-recording', event_id: eventId },
      },
    );

    if (fnError) {
      const status =
        (fnError as { context?: { status?: number } }).context?.status ?? 0;
      const msg =
        status === 403
          ? 'Only staff can upload event recordings.'
          : status === 404
          ? 'Event not found.'
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
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Upload event recording</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Upload the post-event video. Mux will transcode automatically. If this
          event has an attached course module, the recording will be converted
          to a lesson under that module; otherwise it will be attached to the
          event row directly as a standalone Mux asset.
        </p>
      </div>

      {error && (
        <p className="text-sm text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      )}

      <MuxUploader
        endpoint={resolveUploadEndpoint}
        maxFileSize={MAX_FILE_SIZE_KB}
        dynamicChunkSize
        onSuccess={() => {
          if (uploadIdRef.current) {
            toast('Recording uploaded; Mux is transcoding.', 'success');
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

export default EventRecordingUploader;
