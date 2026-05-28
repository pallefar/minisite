/**
 * Phase 44 Plan 08 — Community Feed Foundation: Mux direct-upload component.
 *
 * D-06: Video upload is gated to Pro + Lifetime + Trial tiers.
 *       This component returns null for Free users.
 *       The mux-create-upload Edge Fn (Plan 44-04) is the authoritative 403 gate.
 *
 * D-05: 500 MB file size cap; 5 min duration enforced server-side via Mux webhook.
 *
 * T-44-02 (defense in depth): isVideoAllowed() hides the uploader for Free users;
 *          the Edge Fn rejects the request with 403 even if bypassed.
 *
 * Path under media/ is CRITICAL for bundle hygiene:
 * 44-09's vite.config.ts routes media/ → 'community-media' chunk (~16 kB gz for uploader).
 */
import MuxUploader from '@mux/mux-uploader-react';
import { useRef } from 'react';
import { isVideoAllowed } from '@/lib/community/tier-gate';
import type { TierLabel } from '@/lib/community/tier-gate';
import { supabase } from '@/lib/supabase';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CommunityMediaUploaderProps {
  postId: string;
  currentTier: TierLabel;
  onSuccess: (uploadId: string) => void;
  onError: (msg: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommunityMediaUploader({
  postId,
  currentTier,
  onSuccess,
  onError,
}: CommunityMediaUploaderProps) {
  // Hooks must be called unconditionally (Rules of Hooks).
  // Store the upload_id returned by mux-create-upload so onSuccess can forward it.
  const uploadIdRef = useRef<string | null>(null);

  // D-06: video upload is gated to Pro + Lifetime + Trial; hide for Free users.
  // Return null AFTER hooks to comply with Rules of Hooks.
  if (!isVideoAllowed(currentTier)) return null;

  async function resolveUploadEndpoint(): Promise<string> {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mux-create-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ post_id: postId }),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      onError(
        err.error === 'VIDEO_TIER_REQUIRED'
          ? 'Video upload requires a Pro or Lifetime membership.'
          : 'Upload setup failed.',
      );
      throw new Error('endpoint_fail');
    }

    const { url, upload_id } = (await res.json()) as { url: string; upload_id: string };
    uploadIdRef.current = upload_id;
    return url;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Upload a video (max 5 min, 500 MB)
      </p>
      <MuxUploader
        endpoint={resolveUploadEndpoint}
        maxFileSize={500 * 1024} // D-05: 500 MB (Mux SDK uses KB)
        dynamicChunkSize
        onSuccess={() => {
          if (uploadIdRef.current) {
            onSuccess(uploadIdRef.current);
          }
        }}
        onUploadError={(e: CustomEvent<{ message?: string }>) =>
          onError('Upload failed: ' + (e?.detail?.message ?? 'unknown'))
        }
      />
    </div>
  );
}

export default CommunityMediaUploader;
