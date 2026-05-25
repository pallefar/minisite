---
phase: 46
slug: m4-courses-classroom
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-23
---

# Phase 46 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (unit + integration); Playwright (e2e); Deno test (Edge Fn) |
| **Config file** | `vitest.config.ts`, `vitest-e2e.config.ts`, `playwright.config.ts`, per-fn `deno.json` |
| **Quick run command** | `cd leanshot && npm test -- --run src/components/course src/lib/course` |
| **Full suite command** | `cd leanshot && npm test -- --run && PLAYWRIGHT_RUN_COURSES=1 npx playwright test --project=courses --grep '@phase46' && $HOME/.deno/bin/deno test --no-check --allow-env supabase/functions/{mux-sign-playback,generate-course-certificate,lesson-progress-beacon,complete-lesson}/index.test.ts` |
| **Estimated runtime** | ~260 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick suite scoped to plan path
- **After every plan wave:** Run full suite
- **Before `/gsd:verify-work`:** Full suite green + `course-player` chunk ≤ 30 kB gz (per ROADMAP success criterion #2)
- **Max feedback latency:** ≤30s quick; ≤260s full

---

## Per-Task Verification Map

> **Placeholder — planner populates this table from per-plan `<verify><automated>` blocks.** Every task ⇒ one row.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 46-01-T1 | 01 | 0 | COURSE-01 | T-46-01,07 | 5 tables created with FK + indexes + CHECK | grep | grep schema migration for 5 `create table` + no forbidden strings | ⬜ Wave 0 | ⬜ pending |
| 46-01-T2 | 01 | 0 | COURSE-01,02,03 | T-46-01,07 | RLS policies gate on tier_effective.has_active + is_staff() | grep | grep RLS migration for tier_effective + is_staff() ≥3x + no staff_users | ⬜ Wave 0 | ⬜ pending |
| 46-01-T3 | 01 | 0 | COURSE-03,04 | T-46-02 | SECDEF RPCs use GREATEST UPSERT + 0.95 anti-skip gate | grep | grep SECDEF migration for GREATEST + 0.95 + 3 funcs + no ON CONFLICT DO DELETE | ⬜ Wave 0 | ⬜ pending |
| 46-01-T4 | 01 | 0 | COURSE-01,03 | T-46-01,02,07 | 4 cross-tenant proof tests in letter-suffix file (skipped by push) | grep | grep test fixture for set local request.jwt.claim.sub + max_position 940/95 | ⬜ Wave 0 | ⬜ pending |
| 46-02-T1 | 02 | 0 | COURSE-04 | T-46-06,08 | certificates bucket private + own-folder SELECT only | grep | grep storage migration for storage.foldername + no auth INSERT | ⬜ Wave 0 | ⬜ pending |
| 46-02-T2 | 02 | 0 | COURSE-06 | T-46-06 | course-resources bucket tier-gated + is_staff INSERT + MIME whitelist | grep | grep storage migration for has_active + is_staff + MIME types | ⬜ Wave 0 | ⬜ pending |
| 46-03-T1 | 03 | 0 | COURSE-01 | T-46-05 | course-types.ts exports 5 interfaces + MuxStatus + Input type; dompurify re-export only | grep+tsc | grep type exports + npx tsc --noEmit | ⬜ Wave 0 | ⬜ pending |
| 46-03-T2 | 03 | 0 | COURSE-04 | T-46-03 | Browser HMAC mint/verify round-trip + 5-test mutation matrix | vitest | npm test --run src/lib/course/cert-verify-token.test.ts | ⬜ Wave 0 | ⬜ pending |
| 46-03-T3 | 03 | 0 | COURSE-06 | T-46-01 | tier-gate isResourceAllowed pro/lifetime/trial=true; free=false | vitest | npm test --run src/lib/community/tier-gate.test.ts | ⬜ Wave 0 | ⬜ pending |
| 46-04-T1 | 04 | 1 | COURSE-02 | T-46-01,04 | mux-sign-playback signs JWT with explicit keyId/keySecret + 4h exp + tier gate | grep | grep keyId/keySecret + 4h + MUX_SIGNING_KEY_ID + no video.view | ⬜ Wave 1 | ⬜ pending |
| 46-04-T2 | 04 | 1 | COURSE-02 | T-46-01,04 | 8 Deno tests cover bearer/tier/free-preview/signing-key paths | deno test | deno test --no-check --allow-env --allow-net mux-sign-playback/ | ⬜ Wave 1 | ⬜ pending |
| 46-05-T1 | 05 | 1 | COURSE-01,02 | T-46-01,07 | mux-create-upload course-lesson branch admin-only + signed policy + 30 min | grep+deno | grep playback_policies signed + 1800 + ADMIN_REQUIRED; deno test passes | ⬜ Wave 1 | ⬜ pending |
| 46-05-T2 | 05 | 1 | COURSE-02 | T-46-01 | mux-webhook course_lessons branch handles ready/errored/upload — NO video.view | grep+deno | grep course_lessons + no video.view; deno test passes | ⬜ Wave 1 | ⬜ pending |
| 46-06-T1 | 06 | 1 | COURSE-03 | T-46-02 | lesson-progress-beacon uses req.text() NOT req.json(); rpc update_lesson_position | grep | grep req.text + no req.json + rpc('update_lesson_position' | ⬜ Wave 1 | ⬜ pending |
| 46-06-T2 | 06 | 1 | COURSE-03 | T-46-02 | 10 Deno tests cover text/plain + auth-from-body + rounding | deno test | deno test --no-check --allow-env --allow-net lesson-progress-beacon/ | ⬜ Wave 1 | ⬜ pending |
| 46-07-T1 | 07 | 1 | COURSE-04 | T-46-04 | qrcode esm.sh smoke test verdict (PNG_OK or SVG_FALLBACK) | runtime probe | deno run qr-smoke-test.ts ⇒ verdict in tee output | ⬜ Wave 1 | ⬜ pending |
| 46-07-T2 | 07 | 1 | COURSE-04 | T-46-03 | cert-hmac.ts payload format matches browser byte-for-byte + cross-runtime vector | grep+deno | grep `${certId}:${userId}:${courseId}:${issuedAt}` + timingSafeEqual + deno test | ⬜ Wave 1 | ⬜ pending |
| 46-07-T3 | 07 | 1 | COURSE-04 | T-46-04,06 | cert-render.ts uses jsPDF v3 esm.sh + landscape 11x8.5 + qrcode | grep | grep jspdf@3 + qrcode@1.5.4 + landscape + no jspdf@4 | ⬜ Wave 1 | ⬜ pending |
| 46-07-T4 | 07 | 1 | COURSE-04 | T-46-03,04,06,08 | Edge Fn invokes complete_course RPC + 60-min signed URL + 8 Deno tests | grep+deno | grep rpc(complete_course) + createSignedUrl(.*3600) + deno test | ⬜ Wave 1 | ⬜ pending |
| 46-08-T1 | 08 | 2 | COURSE-01,03,06 | T-46-05 | TabId+store+helpers+nav-entries; course-progress vitest + tsc | grep+vitest+tsc | grep classroom TabId + setActiveCourse + sendBeacon; vitest passes | ⬜ Wave 2 | ⬜ pending |
| 46-08-T2 | 08 | 2 | COURSE-01,05 | T-46-05 | ClassroomTabShell+ListView+DetailView+Sidebar wired to App.tsx; dompurify reuse | grep+tsc | grep ClassroomTabShell in App.tsx + no new DOMPurify | ⬜ Wave 2 | ⬜ pending |
| 46-08-T3 | 08 | 2 | COURSE-02,03,06 | T-46-01,02,06 | LessonPlayerView mux-sign-playback + /lazy import + sendBeacon + 30 kB chunk | grep+bundle | grep @mux/mux-player-react/lazy + assert-bundle-budget.sh passes | ⬜ Wave 2 | ⬜ pending |
| 46-09-T1 | 09 | 2 | COURSE-01 | T-46-07 | ADMIN_MODULES courses entry + pathname routing (no React Router) | grep+tsc | grep key: 'courses' + window.location.pathname + no react-router | ⬜ Wave 2 | ⬜ pending |
| 46-09-T2 | 09 | 2 | COURSE-01 | T-46-07 | ModuleEdit+LessonEdit reuse SortableTreePanel for dnd-kit reorder | grep+tsc | grep SortableTreePanel + no @dnd-kit/core direct import | ⬜ Wave 2 | ⬜ pending |
| 46-09-T3 | 09 | 2 | COURSE-02,06 | T-46-07 | LessonVideoUploader posts kind=course-lesson admin-only + maxDuration 1800 | grep+tsc | grep kind: 'course-lesson' + maxDuration={1800} + COURSE_RESOURCES_BUCKET | ⬜ Wave 2 | ⬜ pending |
| 46-10-T1 | 10 | 3 | COURSE-04 | T-46-03 | compareCertToken constant-time string equal (no secret needed) | vitest | npm test --run src/lib/course/cert-verify-token.test.ts (compare cases) | ⬜ Wave 3 | ⬜ pending |
| 46-10-T2 | 10 | 3 | COURSE-04 | T-46-03 | CertVerifyPage public route + App.tsx pathname pre-check + noindex meta | grep+tsc | grep startsWith('/verify/') + compareCertToken + noindex; tsc clean | ⬜ Wave 3 | ⬜ pending |
| 46-11-T1 | 11 | 3 | — | T-46-04 | Vendor secrets (MUX_SIGNING_KEY_ID, MUX_SIGNING_KEY_PRIVATE, CERT_VERIFICATION_SECRET) set | checkpoint:human-action | supabase secrets list `\| grep -E '<3 names>'` | ⬜ Wave 3 | ⬜ pending |
| 46-11-T2 | 11 | 3 | COURSE-01,03,04,06 | T-46-01,02,06,07 | Migrations applied + proof tests PASS via psql | live-db | supabase db push --linked + psql -f letter-suffix test | ⬜ Wave 3 | ⬜ pending |
| 46-11-T3 | 11 | 3 | COURSE-02,03,04 | T-46-01,04 | 5 Edge Fns deployed; 401 smoke + 200 text/plain smoke green | curl | curl smoke 3 endpoints (no --linked/--import-map flags) | ⬜ Wave 3 | ⬜ pending |
| 46-11-T4 | 11 | 3 | COURSE-01..06 | T-46-01..08 | Deno sweep + bundle gate + vitest + tsc all green | composite | deno test all 5 fns + assert-bundle-budget + vitest + tsc | ⬜ Wave 3 | ⬜ pending |
| 46-11-T5 | 11 | 3 | COURSE-04,05 | T-46-03 | Playwright @phase46 4 scenarios pass against deployed infra | playwright | PLAYWRIGHT_RUN_COURSES=1 npx playwright test --grep '@phase46' | ⬜ Wave 3 | ⬜ pending |
| 46-11-T6 | 11 | 3 | COURSE-01..06 | T-46-01..08 | 6-signal HUMAN-UAT each individually approved or deferred | checkpoint:human-verify | operator resume signals | ⬜ Wave 3 | ⬜ pending |
| 46-11-T7 | 11 | 3 | — | — | CARRY-OVER.md + SUMMARY.md + ROADMAP toggled + nyquist_compliant=true | grep | grep CARRY-OVER + nyquist_compliant: true | ⬜ Wave 3 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/migrations/<ts>_p46_course_schema.sql` — `courses`, `course_modules`, `course_lessons`, `lesson_progress`, `certificates` tables + `course_lessons.is_free_preview boolean default false` + `course_lessons.is_required boolean default true`
- [ ] `supabase/migrations/<ts>_p46_course_rls.sql` — RLS: Pro/Lifetime gating on lesson SELECT (free-preview lessons readable by all); admin INSERT/UPDATE/DELETE via `public.is_staff()` (NOT `staff_users`); lesson_progress per-user RLS
- [ ] `supabase/migrations/<ts>_p46_course_secdef_rpcs.sql` — `complete_lesson(lesson_id)` SECDEF RPC reading `lesson_progress.max_position_reached_seconds` and validating ≥95%; `complete_course(course_id)` SECDEF triggering cert gen via Edge Fn; `update_lesson_position(lesson_id, position_seconds)` SECDEF with `GREATEST(max_position_reached_seconds, $1)` so scrub-back doesn't regress max
- [ ] `supabase/migrations/<ts>_p46_certificates_bucket.sql` — `certificates` Storage bucket (private; signed-only SELECT 60-min TTL; INSERT by `complete_course` RPC only)
- [ ] `src/lib/course/dompurify-config.ts` — REUSE Phase 44's; no new policy
- [ ] `src/lib/course/cert-verify-token.ts` — HMAC base64url helper (RESEARCH cite NPS-token pattern; same replace-chain per memory `reference_base64url_postgres_vercel_mint_verify`)
- [ ] Vendor secrets — operator action: (a) Mux signing key creation (Mux Dashboard → Settings → Signing Keys → save `MUX_SIGNING_KEY` id + `MUX_PRIVATE_KEY` base64 PEM); (b) `CERT_VERIFICATION_SECRET` (`openssl rand -hex 32` + `npx supabase secrets set --project-ref ytnsipxxmzgaebkqmokp CERT_VERIFICATION_SECRET=...`)
- [ ] QR code library smoke test in Deno Edge Fn (esm.sh/qrcode@1.5.4?target=denonext) — confirm canvas behavior; SVG fallback path documented. **NOTE:** smoke test runs as Plan 46-07 Task 1 (Wave 1, NOT Wave 0). This Wave-0-Requirements row is documentation only — the actual test executes within Plan 46-07's Wave 1 dispatch and produces a PNG_OK / SVG_FALLBACK verdict before Plan 46-07 Tasks 2-4 run.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Mux video lesson playback + adaptive HLS scrubbing on real device | COURSE-02 | Mux upload + transcoding + playback requires real video asset + browser | (1) Admin uploads test-lesson.mp4 (30 min); (2) Mux processes to `mux_status='ready'`; (3) User views lesson; (4) Player scrubs without buffering >2s |
| ≥95% watching anti-skip enforcement | COURSE-03 | Cannot reliably mock Mux Player onTimeUpdate cadence | (1) User watches 50% of lesson; (2) Try "Mark complete" → 403; (3) Watch to 95%; (4) "Mark complete" succeeds |
| Cross-device resume via last_position_seconds | COURSE-03 | Two-device observation can't be automated | (1) User watches first 5 min on device A → tab close (beacon fires); (2) Open same lesson on device B; (3) Player auto-resumes at ~5:00 |
| Certificate PDF generation + download + verification | COURSE-04 | Real Edge Fn execution + PDF rendering + signed URL | (1) User completes 100% of course; (2) Cert PDF generates in ≤30s; (3) Download signed URL works; (4) PDF contains user name + course title + completion date + verification URL + QR code; (5) Visit `/verify/<cert_id>?t=<hmac>` → page shows "Verified" |
| Pro-gated lesson resource download | COURSE-06 | Tier RLS + signed URL needs real tier_effective | (1) Sign in as Free user; (2) Open course lesson with Pro-gated resource; (3) Click download → 403 with upgrade CTA |
| Course landing page renders via PageBuilder (Phase 15 reuse) | COURSE-05 | PageBuilder integration | (1) Admin selects template from 3 admin options; (2) Public `/courses/<slug>` route renders the landing page; (3) Phase 39 PAGEAB-06 retrofit later |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (Mux signing key + cert HMAC secret surfaced in Plan 46-11 vendor-secret pre-flight; qrcode Deno smoke test runs as Plan 46-07 Task 1 in Wave 1 — earliest possible deployment-environment test of esm.sh/qrcode)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s quick / < 260s full
- [ ] `nyquist_compliant: true` set in frontmatter (planner toggles after map populated)

**Approval:** pending
