/**
 * Phase 44 Plan 08 — Community Feed Foundation: Mux adaptive HLS player.
 *
 * CRITICAL: Must import from '@mux/mux-player-react/lazy' NOT '@mux/mux-player-react'.
 * The /lazy entry point defers the ~170 kB gz player bytes to viewport intersection
 * (Mux blurhash placeholder) — importing the bare package defeats the bundle ceiling.
 * See 44-RESEARCH.md §Pitfall 1 and §State of the Art.
 *
 * Path under media/ is CRITICAL for bundle hygiene:
 * 44-09's vite.config.ts routes media/ → 'community-media' chunk.
 * This component itself is also lazy-imported by CommunityPostMediaStrip via React.lazy.
 */
import MuxPlayer from '@mux/mux-player-react/lazy';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CommunityVideoPlayerProps {
  playbackId: string;
  /** Thumbnail poster time in seconds. Defaults to 1 (D-07). */
  posterTime?: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommunityVideoPlayer({ playbackId, posterTime = 1 }: CommunityVideoPlayerProps) {
  const posterUrl = `https://image.mux.com/${encodeURIComponent(playbackId)}/thumbnail.jpg?time=${posterTime}`;

  return (
    <div aria-label="Community video player" className="w-full overflow-hidden rounded-lg">
      <MuxPlayer
        playbackId={playbackId}
        poster={posterUrl}
        streamType="on-demand"
        className="w-full"
      />
    </div>
  );
}

export default CommunityVideoPlayer;
