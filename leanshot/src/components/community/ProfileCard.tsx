/**
 * Phase 45 Plan 07a — ProfileCard.
 *
 * Renders a single directory profile with up to 4 badges, sanitized bio markdown,
 * filtered HTTPS-only links, and a Message CTA that flips the Zustand
 * activeCommunityView to 'dm' (DM thread/composer surface ships in 45-07b).
 *
 * Badges (D-01..D-03):
 *   - tier (free/trial/pro/lifetime) — gated on profile.show_tier_badge
 *   - clinician (✓ verified) — gated on profile.is_clinician_verified
 *   - streak (consecutive day count) — gated on profile.show_streak_badge
 *   - level — gamification placeholder; rendered only when caller provides a value
 *
 * T-45-05 mitigation:
 *   bio rendered via Phase 44 renderPostBodyHtml (sanitizeCommunityMarkdown).
 *   NO new DOMPurify instantiation in this file.
 *
 * Analog: leanshot/src/components/community/CommunityPost.tsx (markdown render).
 */
import { MessageCircle, Stethoscope, Flame, Trophy } from 'lucide-react';
import { type JSX } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InitialsAvatar } from '@/components/ui/InitialsAvatar';
import { renderPostBodyHtml } from '@/lib/community/dompurify-config';
import type { TierLabel } from '@/lib/community/tier-gate';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Profile shape rendered by ProfileCard. Mirrors the columns selected by
 * CommunityDirectoryView's `supabase.from('profiles').select(...)` query.
 */
export interface DirectoryProfile {
  id: string;
  handle: string | null;
  display_name: string | null;
  bio: string | null;
  links: unknown; // jsonb default '[]'; we validate at render
  is_clinician_verified: boolean;
  show_tier_badge: boolean;
  show_streak_badge: boolean;
  /** Tier label resolved by caller (optional — directory query does not include it). */
  tier_label?: TierLabel | null;
  /** Streak day count resolved by caller (optional — sourced from streak_state). */
  current_streak_days?: number | null;
  /** Gamification level — placeholder; only rendered when supplied by caller. */
  level?: number | null;
}

export interface ProfileCardProps {
  profile: DirectoryProfile;
  currentUserId: string;
  /** Called when user clicks the Message CTA. Caller should set Zustand activeCommunityView='dm'. */
  onMessage: (recipientUserId: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Coerce profile.links (jsonb) into a typed array of {label, url} entries.
 * HTTPS-only — non-https URLs are dropped. Cap at 5 to bound layout (D-05).
 */
function parseLinks(raw: unknown): Array<{ label: string; url: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ label: string; url: string }> = [];
  for (const entry of raw) {
    if (out.length >= 5) break;
    if (typeof entry !== 'object' || entry === null) continue;
    const obj = entry as Record<string, unknown>;
    const url = typeof obj.url === 'string' ? obj.url : null;
    const label = typeof obj.label === 'string' ? obj.label : null;
    if (!url || !url.startsWith('https://')) continue;
    out.push({ label: label && label.length > 0 ? label : url, url });
  }
  return out;
}

const TIER_TONE: Record<TierLabel, 'neutral' | 'info' | 'success' | 'warning'> = {
  free: 'neutral',
  trial: 'info',
  pro: 'success',
  lifetime: 'warning',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ProfileCard({ profile, currentUserId, onMessage }: ProfileCardProps): JSX.Element {
  const displayName = profile.display_name ?? profile.handle ?? `User ${profile.id.slice(0, 8)}`;
  const handle = profile.handle ?? null;
  const isSelf = profile.id === currentUserId;

  // T-45-05: bio passes through sanitizeCommunityMarkdown via renderPostBodyHtml.
  // We pass `deleted_at: null` since directory rows never carry a deleted_at column;
  // the helper just calls sanitizeCommunityMarkdown when deleted_at is null.
  const sanitizedBio =
    profile.bio && profile.bio.trim().length > 0
      ? renderPostBodyHtml({ body: profile.bio, deleted_at: null })
      : null;

  const links = parseLinks(profile.links);

  return (
    <Card variant="default" padding="md">
      <article aria-label={`Profile for ${displayName}`} className="flex flex-col gap-3">
        {/* Header — avatar + name/handle + Message CTA */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <InitialsAvatar name={displayName} size="sm" rounded="full" />
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold text-[var(--color-text)] truncate">
                {displayName}
              </span>
              {handle && (
                <span className="text-xs text-[var(--color-text-secondary)] truncate">
                  @{handle}
                </span>
              )}
            </div>
          </div>
          {!isSelf && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onMessage(profile.id)}
              aria-label={`Message ${displayName}`}
              leadingIcon={<MessageCircle className="size-4" aria-hidden />}
            >
              Message
            </Button>
          )}
        </div>

        {/* Badges — 4 max, each gated by profile toggle or data presence */}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Profile badges">
          {profile.show_tier_badge && profile.tier_label && (
            <Badge tone={TIER_TONE[profile.tier_label]}>{profile.tier_label}</Badge>
          )}
          {profile.is_clinician_verified && (
            <Badge tone="info" leadingIcon={<Stethoscope className="size-3" aria-hidden />}>
              Clinician
            </Badge>
          )}
          {profile.show_streak_badge &&
            typeof profile.current_streak_days === 'number' &&
            profile.current_streak_days > 0 && (
              <Badge tone="warning" leadingIcon={<Flame className="size-3" aria-hidden />}>
                {profile.current_streak_days}d streak
              </Badge>
            )}
          {typeof profile.level === 'number' && profile.level > 0 && (
            <Badge tone="neutral" leadingIcon={<Trophy className="size-3" aria-hidden />}>
              Lv {profile.level}
            </Badge>
          )}
        </div>

        {/* Bio — sanitized markdown via Phase 44 dompurify-config */}
        {sanitizedBio && (
          <div className="prose prose-sm max-w-none text-[var(--color-text-secondary)]">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
              {sanitizedBio}
            </ReactMarkdown>
          </div>
        )}

        {/* Links — HTTPS-only, capped at 5 */}
        {links.length > 0 && (
          <ul className="flex flex-wrap gap-2 text-xs" aria-label="Profile links">
            {links.map((link) => (
              <li key={link.url}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </article>
    </Card>
  );
}

export default ProfileCard;
