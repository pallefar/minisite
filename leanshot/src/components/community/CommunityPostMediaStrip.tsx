// Owner: Plan 44-08. Replaces 44-06 STUB. CommunityPost.tsx (Plan 44-06) renders this as the media surface.
// Merge note: 44-06 ships this file as a null-rendering STUB; 44-08 provides the real implementation.
// At Wave 1 merge time the orchestrator runs `git checkout --ours leanshot/src/components/community/CommunityPostMediaStrip.tsx`
// to keep the 44-08 version. See 44-08-SUMMARY.md for full merge protocol.

import { lazy, Suspense, useState } from 'react';

import type { CommunityPost, CommunityPostMedia } from '@/lib/community/community-types';

// Extended post type that includes the joined community_post_media relation.
// CommunityFeed (Plan 44-06) selects this relation in its Supabase query and
// passes the combined shape to CommunityPost → CommunityPostMediaStrip.
type CommunityPostWithMedia = CommunityPost & {
  community_post_media: CommunityPostMedia[];
};

// ─── Lazy Mux Player ─────────────────────────────────────────────────────────
// CommunityVideoPlayer lives under media/ which 44-09's vite.config.ts routes to
// the 'community-media' chunk (~170 kB gz). React.lazy defers that chunk to
// click-to-play so the community-feed chunk stays within the 20 kB ceiling.
const CommunityVideoPlayer = lazy(() => import('./media/CommunityVideoPlayer'));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function muxThumbnailUrl(playbackId: string, timeSec = 1): string {
  return `https://image.mux.com/${encodeURIComponent(playbackId)}/thumbnail.jpg?time=${timeSec}&width=640&height=360`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CommunityPostMediaStripProps {
  /** CommunityPost with the joined community_post_media relation (selected by CommunityFeed). */
  post: CommunityPostWithMedia;
  /** Signed URLs keyed by storage path (60-min TTL, resolved by parent CommunityFeed). */
  mediaSignedUrls: Record<string, string>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommunityPostMediaStrip({
  post,
  mediaSignedUrls,
}: CommunityPostMediaStripProps) {
  const [showPlayer, setShowPlayer] = useState(false);

  const hasImages = post.community_post_media.length > 0;
  const hasReadyVideo = post.video_status === 'ready' && post.mux_playback_id != null;
  const isVideoProcessing = post.video_status === 'uploading' || post.video_status === 'processing';
  const isVideoRejected = post.video_status === 'rejected';

  // Nothing to render
  if (!hasImages && !hasReadyVideo && !isVideoProcessing && !isVideoRejected) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── Image carousel (D-04) ── */}
      {hasImages && (
        <ul
          role="list"
          aria-label={`${post.community_post_media.length} attached image${post.community_post_media.length === 1 ? '' : 's'}`}
          className="flex flex-wrap gap-2 overflow-x-auto"
        >
          {[...post.community_post_media]
            .sort((a, b) => a.display_order - b.display_order)
            .map((media) => {
              const src = mediaSignedUrls[media.path];
              return (
                <li key={media.id}>
                  <img
                    src={src}
                    alt=""
                    aria-label={`Post image ${media.display_order}`}
                    width={256}
                    height={256}
                    loading="lazy"
                    className="h-64 w-64 rounded-lg object-cover ring-1 ring-[var(--color-border)]"
                  />
                </li>
              );
            })}
        </ul>
      )}

      {/* ── Ready video: thumbnail + click-to-load player (D-07) ── */}
      {hasReadyVideo && post.mux_playback_id != null && (
        <div className="relative overflow-hidden rounded-lg">
          {showPlayer ? (
            <Suspense
              fallback={
                <div
                  role="status"
                  aria-live="polite"
                  className="flex h-40 items-center justify-center rounded-lg bg-[var(--color-surface-muted)] text-sm text-[var(--color-text-secondary)]"
                >
                  Loading player…
                </div>
              }
            >
              <CommunityVideoPlayer playbackId={post.mux_playback_id} posterTime={1} />
            </Suspense>
          ) : (
            <button
              type="button"
              aria-label="Play video"
              onClick={() => setShowPlayer(true)}
              className="group relative block w-full cursor-pointer overflow-hidden rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
            >
              <img
                src={muxThumbnailUrl(post.mux_playback_id)}
                alt="Video thumbnail"
                width={640}
                height={360}
                loading="lazy"
                className="w-full object-cover"
              />
              {/* Play overlay */}
              <span
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center bg-black/30 text-4xl text-white transition-colors group-hover:bg-black/40"
              >
                ▶
              </span>
            </button>
          )}
        </div>
      )}

      {/* ── Video is processing (D-07 status badge) ── */}
      {isVideoProcessing && (
        <div className="flex items-center gap-2 rounded-lg bg-[var(--color-surface-muted)] px-3 py-2">
          {/* Skeleton shimmer */}
          <div
            aria-hidden="true"
            className="h-10 w-16 animate-pulse rounded bg-[var(--color-border)]"
          />
          <span className="text-sm text-[var(--color-text-secondary)]">Video is processing</span>
        </div>
      )}

      {/* ── Video rejected (D-07 status badge) ── */}
      {isVideoRejected && (
        <span className="inline-flex items-center rounded-full bg-[var(--color-error-subtle)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-error)]">
          Video could not be processed
        </span>
      )}
    </div>
  );
}

export default CommunityPostMediaStrip;
