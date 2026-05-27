/**
 * LevelUpShareModal — share a level-up milestone to social platforms (GAME-07).
 *
 * Opened from LevelUpBurst (Plan 35-07 Task 3 additive integration seam).
 * Mints a signed HMAC share token via the `mint_share_token` Supabase RPC
 * (SECDEF — secret stays server-side), then builds a share URL with a
 * cache-bust ?v= param (Pitfall 9 — Twitter caches by URL).
 *
 * Viral attribution: the share URL routes through /share/level/<token>
 * which redirects to APP_URL/?ref=share, triggering Phase 19's _aff cookie setter.
 *
 * Privacy: handle is leaderboard handle if opted-in (D-13), else 'GLP-1 Tracker'.
 * The token payload contains only an anonymized userIdAnon (16 hex chars of a
 * SHA-256 hash), level (int), and ts — no PII.
 *
 * Instagram has no web share-intent API; users must copy the link and paste in DM/story.
 */
import { Twitter, Linkedin, Instagram, Link as LinkIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/hooks/useToast';
import { mintShareToken, buildShareUrl } from '@/lib/gamification/share-token';

interface Props {
  open: boolean;
  onClose: () => void;
  level: number;
}

export function LevelUpShareModal({ open, onClose, level }: Props) {
  const toast = useToast();
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      // Reset state when modal closes so next open re-mints
      setShareUrl(null);
      setMintError(null);
      return;
    }
    setLoading(true);
    setMintError(null);
    mintShareToken(level)
      .then((tok) => setShareUrl(buildShareUrl(tok, level)))
      .catch((e: unknown) =>
        setMintError(e instanceof Error ? e.message : 'unknown error'),
      )
      .finally(() => setLoading(false));
  }, [open, level]);

  const handleCopy = async (): Promise<void> => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast('Link copied', 'success');
    } catch {
      toast('Copy failed — long-press to copy', 'error');
    }
  };

  // Phase 19 viral attribution: ?ref=share is included in the share URL via the
  // SSR redirect at /share/level/<token> → APP_URL/?ref=share — no extra param needed here.
  const twitterIntent = shareUrl
    ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(`I reached Level ${level} on LeanShot!`)}&url=${encodeURIComponent(shareUrl)}`
    : null;
  const linkedinIntent = shareUrl
    ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`
    : null;

  return (
    <Modal open={open} onClose={onClose} title={`Share Level ${level}`} size="sm">
      {loading && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          Preparing share link…
        </p>
      )}

      {mintError && !loading && (
        <p className="text-sm text-[var(--color-error)]">
          Could not create share link. Please try again.
        </p>
      )}

      {shareUrl && !loading && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Share your Level {level} milestone:
          </p>

          <div className="flex flex-wrap gap-2">
            {twitterIntent && (
              <a
                href={twitterIntent}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm hover:bg-[var(--color-surface-secondary)] transition-colors"
              >
                <Twitter size={16} aria-hidden />
                X / Twitter
              </a>
            )}

            {linkedinIntent && (
              <a
                href={linkedinIntent}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm hover:bg-[var(--color-surface-secondary)] transition-colors"
              >
                <Linkedin size={16} aria-hidden />
                LinkedIn
              </a>
            )}

            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm hover:bg-[var(--color-surface-secondary)] transition-colors"
            >
              <LinkIcon size={16} aria-hidden />
              Copy link
            </button>
          </div>

          <p className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
            <Instagram size={12} aria-hidden />
            Instagram: copy the link and paste it in a DM or story.
          </p>

          <pre className="text-xs bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-2 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
            {shareUrl}
          </pre>
        </div>
      )}
    </Modal>
  );
}
