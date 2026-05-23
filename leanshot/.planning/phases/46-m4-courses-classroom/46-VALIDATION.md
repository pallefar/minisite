---
phase: 46
slug: m4-courses-classroom
status: draft
nyquist_compliant: false
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
| 46-01-01 | 01 | 0 | — | — | Wave 0 schema | migration | (via Wave 3 push) | ⬜ Wave 0 | ⬜ pending |

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
- [ ] QR code library smoke test in Deno Edge Fn (esm.sh/qrcode@1.5.4?target=denonext) — confirm canvas behavior; SVG fallback path documented

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
- [ ] Wave 0 covers all MISSING references (Mux signing key, cert HMAC secret, qrcode Deno smoke test)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s quick / < 260s full
- [ ] `nyquist_compliant: true` set in frontmatter (planner toggles after map populated)

**Approval:** pending
