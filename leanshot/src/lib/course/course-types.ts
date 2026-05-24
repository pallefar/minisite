/**
 * Phase 46 — course domain types. Mirrors src/lib/community/community-types.ts.
 * All shapes match the public schema created in Plan 46-01
 * (supabase/migrations/20270725000001_p46_course_schema.sql).
 *
 * Pure types, no runtime code, no imports.
 *
 * snake_case fields match the column names returned by supabase-js (no field
 * transformation is configured in this codebase — see community-types.ts).
 *
 * Downstream consumers: 46-04 admin course editor, 46-05 lesson player,
 * 46-06 mux uploader, 46-08 consumer course UI, 46-09 admin gates,
 * 46-10 /verify/<cert_id> route.
 */

// ─── Course (D-01, D-11, D-12) ────────────────────────────────────────────────

export interface Course {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  cover_url: string | null;
  /** D-11: 1..100 — gate for complete_course RPC; 100 = all required lessons. */
  completion_threshold_pct: number;
  /** D-12: false short-circuits the ≥95% anti-skip gate in complete_lesson RPC. */
  enforce_completion: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Module (D-01) ────────────────────────────────────────────────────────────

export interface CourseModule {
  id: string;
  course_id: string;
  title: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

// ─── Lesson (D-01, D-05, D-06, D-07) ──────────────────────────────────────────

/** D-05: Mux video lifecycle. Set by mux-webhook Edge Fn. */
export type MuxStatus = 'pending' | 'processing' | 'ready' | 'rejected' | 'errored';

export interface CourseLesson {
  id: string;
  module_id: string;
  title: string;
  content_md: string | null;
  order_index: number;
  mux_asset_id: string | null;
  mux_playback_id: string | null;
  mux_status: MuxStatus;
  duration_seconds: number | null;
  /** D-07: is_free_preview=true bypasses RLS tier gate (anon + free can read). */
  is_free_preview: boolean;
  /** D-11: only is_required=true lessons count toward course completion threshold. */
  is_required: boolean;
  /** D-06: caption auto-generation default on (override per-lesson in admin UI). */
  captions_enabled: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Lesson progress (D-04, D-09, D-12) ───────────────────────────────────────

export interface LessonProgress {
  user_id: string;
  lesson_id: string;
  /** D-04: denormalized for complete_course RPC count queries. */
  course_id: string;
  completed_at: string | null;
  last_position_seconds: number;
  /** D-09: anti-skip server-of-record; never regresses (GREATEST in update_lesson_position RPC). */
  max_position_reached_seconds: number;
  last_seen_at: string;
}

/**
 * Input shape for update_lesson_position RPC / client-side position write.
 * Excludes server-managed fields (user_id, course_id derived, completed_at, last_seen_at).
 */
export type LessonProgressInput = Pick<
  LessonProgress,
  'lesson_id' | 'last_position_seconds' | 'max_position_reached_seconds'
>;

// ─── Certificate (D-14) ───────────────────────────────────────────────────────

export interface Certificate {
  id: string;
  user_id: string;
  course_id: string;
  issued_at: string;
  version: number;
  pdf_path: string | null;
  /**
   * D-14: HMAC(secret, cert_id:user_id:course_id:issued_at) base64url.
   * complete_course RPC inserts a placeholder (`PENDING_<uuid>`);
   * generate-course-certificate Edge Fn UPDATEs with the final HMAC.
   */
  verification_token: string;
}
