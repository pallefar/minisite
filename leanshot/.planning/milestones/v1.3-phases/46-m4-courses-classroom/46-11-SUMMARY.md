---
phase: 46-m4-courses-classroom
plan: 11
status: complete
disposition: approved automated-verify-only
created: 2026-05-24
requirements: [COURSE-01, COURSE-02, COURSE-03, COURSE-04, COURSE-05, COURSE-06]
---

# Plan 46-11 SUMMARY — Phase 46 close-out

## What shipped

**Task 1 (pre-flight) — COMPLETE:**

| Check | Result |
|-------|--------|
| Cross-Fn Deno sweep (mux-sign-playback + lesson-progress-beacon + generate-course-certificate) | 37/37 pass |
| tsc clean | exit 0 |
| 6 real migrations + 1 test fixture, valid 14-digit regex | PASS |
| HMAC cross-runtime parity vector LOCKED | PASS (browser + Deno + Node stdlib all yield same token) |

**Task 2 (live infra) — DEFERRED to milestone UAT.** 3 NEW Function Secrets unset (MUX_SIGNING_KEY_ID/PRIVATE + CERT_VERIFICATION_SECRET). Phase 44 Mux secrets may also be unset. Plus mux pair-deploy ordering constraint. Operator commands in 46-CARRY-OVER.md.

**Task 3 (6 HUMAN-UAT signals) — DEFERRED to milestone UAT.** Consolidated with Phase 32 + 45 + 48 deferred HITL gates.

**Task 4 (metadata flips) — COMPLETE.** ROADMAP + STATE + REQUIREMENTS + CARRY-OVER.

## Phase 46 inventory (11/11 plans shipped with this close-out)

| Plan | Wave | Scope | Shipped |
|------|------|-------|---------|
| 46-01 | 0 | Course schema (5 tables) + RLS + 3 SECDEF RPCs | ✓ |
| 46-02 | 0 | certificates + course-resources Storage buckets | ✓ |
| 46-03 | 0 | course-types + DOMPurify + cert-verify-token (browser HMAC) + tier-gate ext | ✓ |
| 46-04 | 1 | mux-sign-playback Edge Fn (tier-gated RS256 JWT) | ✓ |
| 46-05 | 1 | mux-create-upload + mux-webhook EXTEND (course-lesson kind) | ✓ |
| 46-06 | 1 | lesson-progress-beacon Edge Fn (sendBeacon text/plain) | ✓ |
| 46-07 | 1 | generate-course-certificate Edge Fn (jsPDF + qrcode + HMAC) | ✓ |
| 46-08 | 2 | Consumer Classroom UI (TabId 'classroom' + Mux signed playback + anti-skip + cert) | ✓ |
| 46-09 | 2 | Admin Course Editor (pathname-routed module + uploaders) | ✓ |
| 46-10 | 3 | Public /verify/<cert_id> route (path (b) — secret stays server-side) | ✓ |
| 46-11 | 4 | This close-out (automated-verify-only disposition) | ✓ |

## Total artifact footprint

- **6 real migrations** at 20270725000001..000006 + 1 test fixture (000003a, deliberately silently skipped)
- **3 new Edge Fns** (mux-sign-playback, lesson-progress-beacon, generate-course-certificate) + 2 EXTENDED (mux-create-upload, mux-webhook)
- **3 SECDEF RPCs** (update_lesson_position, complete_lesson, complete_course) + 2 Storage buckets + 1 column addition
- **Consumer:** ClassroomTabShell + CourseListView + CourseDetailView + CourseSidebar + LessonPlayerView + LessonResourceList + course-progress + course-storage + TabId widening
- **Admin:** CoursesAdminLayout + 5 sub-views (List + Edit + ModuleEdit + LessonEdit + LessonVideoUploader + LessonResourceUploader)
- **Public:** /verify/<cert_id> route (App.tsx pathname pre-check + CertVerifyPage)
- **HMAC parity vector LOCKED:** browser cert-verify-token.ts + Deno cert-hmac.ts byte-for-byte identical (format `${certId}:${userId}:${courseId}:${issuedAt}`, base64url replace-chain)

## Requirements satisfied (code-complete; UAT verify pending)

| REQ-ID | Status |
|--------|--------|
| COURSE-01 (schema; course→module→lesson hierarchy) | code-complete |
| COURSE-02 (Mux video integration + adaptive HLS) | code-complete |
| COURSE-03 (lesson_progress + resume + anti-skip ≥95%) | code-complete |
| COURSE-04 (PDF certificates + verification URL) | code-complete |
| COURSE-05 (Course landing pages via PageBuilder A/B) | code-complete (reuses Phase 15 PageBuilder; no Phase 46 net-new for this REQ) |
| COURSE-06 (Lesson resources + Pro-gated download) | code-complete |

## Memory references honored

- `feedback_autonomous_false_close_out_partial_execution` — Tasks 1+4 inline, Tasks 2+3 deferred
- `feedback_milestone_uat_deferral_consolidation` — 6 UAT signals roll into v1.3 milestone UAT
- `feedback_phase_close_out_db_push_verification` — per-plan push-status matrix in CARRY-OVER.md
- `feedback_fn_deploy_before_cron_db_push` — N/A for Phase 46 (no cron migrations); but mux PAIR-deploy ordering documented separately
- `feedback_vendor_secret_preflight_surface` — 3 new + ~3 inherited Mux secrets surfaced for operator
- `reference_mux_signed_playback_jwt_pattern` — RS256 aud='v' sub=playback_id exp=now+4h
- `reference_mux_video_view_event_for_antiskip` — client-side accumulate + server complete_lesson double-check
- `reference_base64url_postgres_vercel_mint_verify` — replace-chain alignment locked across browser + Deno + Node
- `reference_supabase_migration_filename_regex` — 6 real migrations valid + 1 fixture deliberately silently skipped
- `feedback_stub_then_replace_sibling_collision` — 46-08 LessonPlayerView shipped as stub in Task 2, replaced in Task 3
- `reference_state_complete_phase_writes_wrong_counters` — STATE.md updated manually (NOT via SDK verb)

## Architectural decisions surfaced

- **46-07 + 46-10 HMAC secret-sharing:** 46-10 chose path (b) — `CERT_VERIFICATION_SECRET` stays server-side; browser fetches stored `certificates.verification_token` via anon SELECT (Plan 46-01 RLS) and constant-time-compares against URL `?t=`. NO secret in browser bundle, NO new cert-verify Edge Fn. Cleaner than original options (a) and (b) flagged by 46-07.

## Carry-over

See 46-CARRY-OVER.md for full re-attempt operator runbook.
