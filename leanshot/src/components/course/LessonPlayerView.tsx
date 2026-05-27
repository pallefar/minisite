/**
 * Phase 46 Plan 08 — LessonPlayerView (full Mux Player + anti-skip).
 *
 * Per-lesson surface that wires:
 *   - Mux Player via `@mux/mux-player-react/lazy` (CRITICAL: bare entry
 *     defeats the 30 kB ceiling — `/lazy` defers ~170 kB of player bytes
 *     to viewport intersection; same rule as CommunityVideoPlayer.tsx).
 *   - Signed playback + thumbnail tokens via the `mux-sign-playback`
 *     Edge Fn (Plan 46-04). 403 → upgrade CTA (T-46-01).
 *   - Client-side anti-skip: onTimeUpdate accumulates max_position_reached
 *     into createProgressSyncer; 15s debounce → `update_lesson_position`
 *     RPC; GREATEST() server-side preserves max across scrub-back.
 *   - Tab-close: beforeunload + visibilitychange → navigator.sendBeacon to
 *     `lesson-progress-beacon` (text/plain JSON body, access_token in body
 *     since sendBeacon cannot set headers per RESEARCH Pitfall 3).
 *   - Mark Complete (UI-gated at ≥95% via isLessonComplete; server
 *     complete_lesson RPC re-checks against DB max — T-46-02 accept-soft).
 *   - On course 100% completion: invoke `generate-course-certificate`
 *     (Plan 46-07) and surface download_url + verification_url in a card.
 *   - LessonResourceList below player (tier-gated downloads).
 *   - Prev/Next-lesson navigation via order_index lookup.
 *
 * Anti-skip note (per memory reference_mux_video_view_event_for_antiskip):
 *   Mux's `video.view` webhook DOES NOT EXIST. Anti-skip is entirely
 *   client-accumulate → server double-check from DB. This component owns
 *   the client-accumulate half; complete_lesson owns the server check.
 */
import MuxPlayer from '@mux/mux-player-react/lazy';
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Award } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import type { TierLabel } from '@/lib/community/tier-gate';
import {
  createProgressSyncer,
  isLessonComplete,
  sendProgressBeacon,
  type ProgressRpcClient,
  type ProgressSyncer,
} from '@/lib/course/course-progress';
import type { CourseLesson, LessonProgress } from '@/lib/course/course-types';
import { sanitizeCommunityMarkdown } from '@/lib/course/dompurify-config';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { LessonResourceList } from './LessonResourceList';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LessonPlayerViewProps {
  lessonId: string;
  courseId: string;
  currentTier: TierLabel;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface MuxTokens {
  playback: string;
  thumbnail: string;
  playback_id: string;
}

interface SiblingInfo {
  prev: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
}

interface CertInfo {
  download_url: string;
  verification_url: string;
}

type GatedError = 'tier_required' | 'lesson_not_ready' | 'playback_unavailable' | null;

// ─── Component ────────────────────────────────────────────────────────────────

export function LessonPlayerView({ lessonId, courseId, currentTier }: LessonPlayerViewProps) {
  const setActiveCourse = useStore((s) => s.setActiveCourse);
  const accessToken = useStore((s) => s.signedIn?.session?.access_token ?? '');

  const [lesson, setLesson] = useState<CourseLesson | null>(null);
  const [progress, setProgress] = useState<LessonProgress | null>(null);
  const [tokens, setTokens] = useState<MuxTokens | null>(null);
  const [gatedError, setGatedError] = useState<GatedError>(null);
  const [siblings, setSiblings] = useState<SiblingInfo>({ prev: null, next: null });
  const [completing, setCompleting] = useState(false);
  const [certReady, setCertReady] = useState<CertInfo | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Syncer + last-known position refs survive across renders without
  // re-creating the debounce timer.
  const syncerRef = useRef<ProgressSyncer | null>(null);

  // Vite env: import.meta.env.VITE_SUPABASE_URL is the project's supabase URL.
  const supabaseUrl = useMemo(
    () => (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '',
    [],
  );

  // ─── Load lesson + progress + siblings on lessonId change ───────────────────
  useEffect(() => {
    let cancelled = false;
    setLesson(null);
    setProgress(null);
    setTokens(null);
    setGatedError(null);
    setCertReady(null);

    void (async () => {
      // 1. Lesson row (RLS course_lessons_select_tier enforces tier gate;
      //    free-preview lessons bypass — anon ok per Plan 46-02).
      const { data: lessonData, error: lessonErr } = await supabase
        .from('course_lessons')
        .select('id, module_id, title, content_md, order_index, mux_asset_id, mux_playback_id, mux_status, duration_seconds, is_free_preview, is_required, captions_enabled, resources, created_at, updated_at')
        .eq('id', lessonId)
        .single();
      if (cancelled) return;
      if (lessonErr || !lessonData) {
        setGatedError('playback_unavailable');
        return;
      }
      setLesson(lessonData as CourseLesson);

      // 2. Per-user progress (single-row, may be absent on first watch).
      const { data: progressData } = await supabase
        .from('lesson_progress')
        .select('user_id, lesson_id, course_id, completed_at, last_position_seconds, max_position_reached_seconds, last_seen_at')
        .eq('lesson_id', lessonId)
        .maybeSingle();
      if (cancelled) return;
      setProgress((progressData as LessonProgress | null) ?? null);

      // 3. Siblings (module → lessons in order; module ordering ignored —
      //    prev/next within the same module is the common UX; cross-module
      //    nav happens via the sidebar).
      const { data: siblingData } = await supabase
        .from('course_lessons')
        .select('id, title, order_index, module_id')
        .eq('module_id', (lessonData as CourseLesson).module_id)
        .order('order_index', { ascending: true });
      if (cancelled) return;
      const lessons = (siblingData as Array<{ id: string; title: string; order_index: number }>) ?? [];
      const idx = lessons.findIndex((l) => l.id === lessonId);
      setSiblings({
        prev: idx > 0 ? { id: lessons[idx - 1]!.id, title: lessons[idx - 1]!.title } : null,
        next: idx >= 0 && idx < lessons.length - 1
          ? { id: lessons[idx + 1]!.id, title: lessons[idx + 1]!.title }
          : null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  // ─── Fetch signed playback tokens (separate effect — runs after lesson loads) ──
  useEffect(() => {
    if (!lesson) return;
    let cancelled = false;

    void (async () => {
      const { data, error } = await supabase.functions.invoke('mux-sign-playback', {
        body: { lesson_id: lessonId },
      });
      if (cancelled) return;
      if (error) {
        // FunctionsHttpError carries the JSON body on .context — extract the
        // server-side error code so we can branch the gate UI accordingly.
        const ctx = (error as { context?: { error?: string } }).context;
        const code = ctx?.error ?? '';
        if (code === 'tier_required') {
          setGatedError('tier_required');
          return;
        }
        if (code === 'lesson_not_ready' || code === 'lesson_not_found') {
          setGatedError('lesson_not_ready');
          return;
        }
        setGatedError('playback_unavailable');
        return;
      }
      setTokens(data as MuxTokens);
    })();

    return () => {
      cancelled = true;
    };
  }, [lesson, lessonId]);

  // ─── Progress syncer lifecycle (create on lessonId change; flush on cleanup) ──
  useEffect(() => {
    // supabase-js's rpc() returns a thenable PostgrestFilterBuilder; the
    // ProgressRpcClient narrow shape only needs `rpc(name, args) => Promise<{data,error}>`.
    // Cast through the narrow contract to avoid the structural mismatch on
    // PostgrestFilterBuilder's catch/finally/Symbol.toStringTag.
    const syncer = createProgressSyncer({
      lessonId,
      supabaseClient: supabase as unknown as ProgressRpcClient,
    });
    syncerRef.current = syncer;
    return () => {
      // Best-effort flush on unmount / lesson change.
      void syncer.flush();
      syncerRef.current = null;
    };
  }, [lessonId]);

  // ─── Tab-close beacons (beforeunload + visibilitychange→hidden) ────────────
  useEffect(() => {
    if (!supabaseUrl) return;

    function fireBeacon(): void {
      const syncer = syncerRef.current;
      if (!syncer) return;
      sendProgressBeacon({
        lessonId,
        lastPosition: syncer.getLastPosition(),
        maxReached: syncer.getMaxReached(),
        accessToken,
        supabaseUrl,
      });
    }

    function onVisibility(): void {
      if (document.visibilityState === 'hidden') fireBeacon();
    }

    window.addEventListener('beforeunload', fireBeacon);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', fireBeacon);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [accessToken, lessonId, supabaseUrl]);

  // ─── onTimeUpdate handler ──────────────────────────────────────────────────
  const handleTimeUpdate = useCallback((event: Event) => {
    // MuxPlayer's onTimeUpdate event.target is the underlying <mux-player>
    // custom element which exposes `currentTime` (HTMLMediaElement-shaped).
    const target = event.target as HTMLMediaElement | null;
    if (!target || typeof target.currentTime !== 'number') return;
    syncerRef.current?.onTimeUpdate(target.currentTime);
  }, []);

  // ─── Mark Complete handler ─────────────────────────────────────────────────
  const handleMarkComplete = useCallback(async () => {
    if (!lesson) return;
    setCompleting(true);
    setStatusMessage(null);

    // Force-flush any pending position write so complete_lesson re-reads the
    // freshest server max (otherwise a click within the 15s debounce window
    // could see a stale DB value and refuse the ≥95% gate).
    await syncerRef.current?.flush();

    const { data: ok, error } = await supabase.rpc('complete_lesson', {
      p_lesson_id: lesson.id,
    });
    if (error || !ok) {
      setCompleting(false);
      setStatusMessage('Could not mark this lesson complete. Try again in a moment.');
      return;
    }

    // Reload progress to reflect completed_at.
    const { data: refreshedProgress } = await supabase
      .from('lesson_progress')
      .select('user_id, lesson_id, course_id, completed_at, last_position_seconds, max_position_reached_seconds, last_seen_at')
      .eq('lesson_id', lesson.id)
      .maybeSingle();
    setProgress((refreshedProgress as LessonProgress | null) ?? null);

    // Try the course-complete cert (Fn returns 400/404 if not yet 100% — silent).
    const { data: cert } = await supabase.functions.invoke('generate-course-certificate', {
      body: { course_id: courseId },
    });
    const certPayload = cert as Partial<CertInfo> | null;
    if (certPayload?.download_url && certPayload.verification_url) {
      setCertReady({
        download_url: certPayload.download_url,
        verification_url: certPayload.verification_url,
      });
    }
    setCompleting(false);
  }, [courseId, lesson]);

  // ─── Render branches ───────────────────────────────────────────────────────

  if (gatedError === 'tier_required') {
    return (
      <div className="p-4 max-w-3xl mx-auto">
        <BackLink onClick={() => setActiveCourse(courseId)} />
        <Card variant="default" padding="lg">
          <h2 className="text-[18px] font-semibold text-[var(--color-text)] mb-2">
            Upgrade required
          </h2>
          <p className="text-[14px] text-[var(--color-text-secondary)] mb-4">
            This lesson is part of the Pro course catalog. Upgrade to start watching.
          </p>
        </Card>
      </div>
    );
  }

  if (gatedError === 'lesson_not_ready') {
    return (
      <div className="p-4 max-w-3xl mx-auto">
        <BackLink onClick={() => setActiveCourse(courseId)} />
        <Card variant="default" padding="lg">
          <p className="text-[14px] text-[var(--color-text)]">
            This lesson is still being prepared. Please check back shortly.
          </p>
        </Card>
      </div>
    );
  }

  if (gatedError === 'playback_unavailable') {
    return (
      <div className="p-4 max-w-3xl mx-auto">
        <BackLink onClick={() => setActiveCourse(courseId)} />
        <Card variant="default" padding="lg">
          <p className="text-[14px] text-[var(--color-text)]">
            We couldn&apos;t load this lesson. Please try again.
          </p>
        </Card>
      </div>
    );
  }

  if (!lesson) {
    return (
      <div className="p-4 max-w-3xl mx-auto space-y-4" role="status" aria-live="polite" aria-label="Loading lesson">
        <Skeleton className="h-8 w-1/3 rounded" />
        <Skeleton className="aspect-video w-full rounded-xl" />
        <Skeleton className="h-4 w-2/3 rounded" />
      </div>
    );
  }

  const canComplete = !!progress?.completed_at || isLessonComplete(progress, lesson);
  const alreadyComplete = !!progress?.completed_at;
  const contentHtml = lesson.content_md ? sanitizeCommunityMarkdown(lesson.content_md) : null;

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <BackLink onClick={() => setActiveCourse(courseId)} />
      <h1 className="text-[22px] font-semibold tracking-tight text-[var(--color-text)] mb-4">
        {lesson.title}
      </h1>

      {tokens ? (
        <div className="aspect-video w-full overflow-hidden rounded-xl bg-black mb-4">
          <MuxPlayer
            playbackId={tokens.playback_id}
            tokens={{ playback: tokens.playback, thumbnail: tokens.thumbnail }}
            streamType="on-demand"
            startTime={progress?.last_position_seconds ?? 0}
            onTimeUpdate={handleTimeUpdate}
            className="w-full h-full"
          />
        </div>
      ) : (
        <Skeleton className="aspect-video w-full rounded-xl mb-4" />
      )}

      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => void handleMarkComplete()}
          disabled={!canComplete || completing || alreadyComplete}
          aria-label={alreadyComplete ? 'Lesson complete' : 'Mark lesson complete'}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-primary)] text-white h-10 px-4 text-[13px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
        >
          <CheckCircle2 className="size-4" />
          {alreadyComplete ? 'Completed' : completing ? 'Saving…' : 'Mark Complete'}
        </button>
        {!alreadyComplete && !canComplete && lesson.duration_seconds && lesson.duration_seconds > 0 && (
          <p className="text-[12px] text-[var(--color-text-secondary)]">
            Watch at least 95% of the lesson to enable.
          </p>
        )}
        {statusMessage && (
          <p role="alert" className="text-[12px] text-[var(--color-warning)]">{statusMessage}</p>
        )}
      </div>

      {certReady && (
        <Card variant="elevated" padding="md" className="mb-6 border-[var(--color-primary)]">
          <div className="flex items-start gap-3">
            <Award className="size-6 text-[var(--color-primary)] shrink-0" aria-hidden />
            <div className="flex-1">
              <h2 className="text-[16px] font-semibold text-[var(--color-text)]">
                Course complete — certificate ready
              </h2>
              <p className="text-[13px] text-[var(--color-text-secondary)] mt-1">
                Download your certificate or share the verification link.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <a
                  href={certReady.download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] text-white px-3 py-1.5 text-[12px] font-semibold"
                >
                  Download PDF
                </a>
                <a
                  href={certReady.verification_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-surface-elevated)] text-[var(--color-text)] px-3 py-1.5 text-[12px] font-semibold"
                >
                  Verify
                </a>
              </div>
            </div>
          </div>
        </Card>
      )}

      {contentHtml && (
        <div
          className="prose prose-sm max-w-none text-[var(--color-text)] mb-6"
          // T-46-05: sanitized via Phase 44 DOMPurify policy reused through
          // @/lib/course/dompurify-config. NO new policy in this file.
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />
      )}

      <LessonResourceList lesson={lesson} currentTier={currentTier} />

      <nav aria-label="Lesson navigation" className="mt-8 flex items-center justify-between gap-3">
        {siblings.prev ? (
          <button
            type="button"
            onClick={() => setActiveCourse(courseId, siblings.prev!.id)}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            aria-label={`Previous lesson: ${siblings.prev.title}`}
          >
            <ChevronLeft className="size-4" />
            Previous
          </button>
        ) : <span />}
        {siblings.next ? (
          <button
            type="button"
            onClick={() => setActiveCourse(courseId, siblings.next!.id)}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            aria-label={`Next lesson: ${siblings.next.title}`}
          >
            Next
            <ChevronRight className="size-4" />
          </button>
        ) : <span />}
      </nav>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back to course"
      className="inline-flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] mb-4 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
    >
      <ArrowLeft className="size-4" />
      Back to course
    </button>
  );
}

export default LessonPlayerView;
